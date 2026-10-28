// Quality checks: what makes a video hard to read or clumsy, found from the
// document itself. The composition is sampled a few times a second, each
// layer placed in composition space (box, cumulative opacity, effective text
// size); each check reads those samples and reports issues with the times and
// layers involved. The assistant runs them before summing up its work, the
// user from the / menu. Plugins add their own (`checks` export).

import { instanceTime, type Instance, type Placement } from './components.ts';
import { Evaluator, nestedTime, type EvaluatedLayer, type NestedTiming } from './evaluate.ts';
import { asKeyframed, modsOf, propKind } from './props.ts';
import { animatedSlots, motionFigures, motionStretches, pathDeviation, sampleAddress, spanOf } from './motion.ts';
import { layerMatrix, matMul, type Mat2D } from './math.ts';
import { mediaTime, pictureRect } from './track.ts';
import type { Host, NodeType, Rect, Registry } from './registry.ts';
import { sequenceCheck } from './montage-checks.ts';
import type { Composition, Layer, TrammeDoc, Vec2 } from './types.ts';

export interface QualityIssue {
  /** the check that found it */
  check: string;
  severity: 'warning' | 'info';
  /** in English, for the assistant */
  message: string;
  /** the same message for the interface: an English template ({name} placeholders) and its values, translated where shown */
  say?: { text: string; params?: Record<string, string | number> };
  /** when it happens (s) */
  t?: number;
  layers?: string[];
}

/** a layer at one instant, in composition space */
export interface PlacedLayer {
  id: string;
  layer: Layer;
  node: NodeType;
  props: Record<string, unknown>;
  /** opacity times its parents' */
  opacity: number;
  /** axis-aligned box in composition pixels, or null when the node has no bounds */
  box: Rect | null;
  /** text layers: their text and the height of their type on screen (px) */
  text?: string;
  textSize?: number;
}

export interface Sample { t: number; layers: PlacedLayer[] }

export interface CheckContext {
  doc: TrammeDoc;
  compId: string;
  comp: Composition;
  registry: Registry;
  evaluator: Evaluator;
  /** the composition every `step` seconds */
  samples: Sample[];
  step: number;
  /** the content of a JSON asset (analyses such as subjects-<media>), when loaded */
  data(assetId: string): unknown;
}

export interface CheckType {
  name: string;
  title?: string;
  description: string;
  /** the message templates it reports (translations of the interface) */
  texts?: string[];
  run(ctx: CheckContext): QualityIssue[] | Promise<QualityIssue[]>;
}

// ── placing layers ───────────────────────────────────────────
function boxOf(m: Mat2D, r: Rect): Rect {
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

const TEXT_NODES = new Set(['text', 'text.counter', 'captions']);
export const isTextLayer = (L: { node: NodeType }) => TEXT_NODES.has(L.node.type);

/** a host good enough to measure: fonts by their family, as the asset store registers them */
function measureHost(doc: TrammeDoc, comp: Composition, t: number, layerId: string): Host {
  return {
    layerId, t, frame: Math.round(t * comp.fps), fps: comp.fps, width: comp.width, height: comp.height, duration: comp.duration,
    asset: <T>(id: string) => (doc.assets[id]?.type === 'font' ? (doc.assets[id].family || id) : null) as T,
    assetInfo: (id: string) => doc.assets[id],
    assetUrl: (id: string) => doc.assets[id]?.src ?? '',
  };
}

/** a text's box without a canvas to measure it (command line, tests): average glyph widths */
function estimateText(p: Record<string, unknown>): Rect {
  const size = Number(p.size) || 64, lines = String(p.text ?? '').split('\n');
  const w = Math.max(...lines.map((l) => l.length)) * size * 0.56, h = size * (1 + (lines.length - 1) * (Number(p.lineHeight) || 1.2));
  const x = p.align === 'center' ? -w / 2 : p.align === 'right' ? -w : 0;
  const y = p.baseline === 'top' ? 0 : p.baseline === 'middle' ? -size / 2 : p.baseline === 'bottom' ? -size : -size * 0.8;
  return { x, y, w, h };
}

/**
 * The layers of a frame placed on screen, the children of groups and the
 * layers of nested compositions included (at their own time, where the layer
 * draws their frame, named after it: `scene-01/headline`), so the checks and
 * the cues see what is drawn.
 */
function place(ev: Evaluator, comp: Composition, t: number, layers: EvaluatedLayer[], parent: Mat2D, alpha: number, out: PlacedLayer[], prefix = '', depth = 0) {
  const doc = ev.doc;
  for (const L of layers) {
    const m = matMul(parent, layerMatrix(L.transform)), opacity = alpha * L.transform.opacity;
    let r: Rect | null = null;
    try { r = L.node.bounds?.(L.props, measureHost(doc, comp, t, L.id)) ?? null; } catch { r = null; }
    const text = isTextLayer(L);
    if (!r && L.node.type === 'text') r = estimateText(L.props);
    // the height of the type on screen: its size times the vertical scale of the layer
    const textSize = text ? Math.abs(Number(L.props.size) || 0) * Math.hypot(m[2], m[3]) : undefined;
    out.push({ id: prefix + L.id, layer: L.layer, node: L.node, props: L.props, opacity, box: r ? boxOf(m, r) : null, ...(text ? { text: String(L.props.text ?? ''), textSize } : {}) });
    place(ev, comp, t, L.children, m, opacity, out, prefix, depth);
    // a nested composition, its frame centred on the layer's origin
    const inner = L.node.type === 'comp' && typeof L.props.comp === 'string' && depth < 8 ? doc.compositions[L.props.comp] : undefined;
    if (inner) {
      const lt = nestedTime(L.props as unknown as NestedTiming, t, L.layer.in ?? 0, inner.duration);
      if (lt >= 0 && lt < inner.duration) {
        // one frame, or each instance of a distribution at its place (named after its rank: `cards#3/title`)
        const many = L.props.$instances as ({ instance: Instance } & Placement)[] | undefined;
        for (const [k, one] of (many ?? [{ instance: L.props.$instance as Instance | undefined, at: [0, 0] as Vec2, rotation: 0 }]).entries()) {
          const a = (one.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
          const at = matMul(m, [c, s, -s, c, one.at[0], one.at[1]]);
          const lti = instanceTime(lt, one, inner.duration);
          place(ev, inner, lti, ev.frame(lti, L.props.comp as string, one.instance).layers, matMul(at, [1, 0, 0, 1, -inner.width / 2, -inner.height / 2]), opacity, out, `${prefix}${L.id}${many ? `#${k}` : ''}/`, depth + 1);
        }
      }
    }
  }
}

/** the composition every `step` seconds, its layers placed */
export function sampleComposition(evaluator: Evaluator, compId: string, step = 0.25): Sample[] {
  const comp = evaluator.comp(compId), out: Sample[] = [];
  // times counted, not added up: a step of 1/30 lands on its frames
  for (let i = 0; i * step < comp.duration - 1e-6; i++) {
    const t = +(i * step).toFixed(6), f = evaluator.frame(t, compId), layers: PlacedLayer[] = [];
    place(evaluator, comp, t, f.layers, [1, 0, 0, 1, 0, 0], 1, layers);
    out.push({ t: +t.toFixed(4), layers });
  }
  return out;
}

// ── the built-in checks ──────────────────────────────────────
const u = (c: Composition) => Math.min(c.width, c.height);
const name = (p: PlacedLayer) => p.layer.name ?? p.id;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const s2 = (t: number) => +t.toFixed(2);

const textSize: CheckType = {
  name: 'text-size', title: 'Text size', description: 'text too small to read on a phone',
  texts: ['"{name}" is about {px} px high: too small to read on a phone (at least {min} px)'],
  run({ comp, samples }) {
    const min = Math.round(u(comp) * 0.03), seen = new Map<string, { px: number; t: number; p: PlacedLayer }>();
    for (const s of samples) for (const p of s.layers) {
      if (p.textSize === undefined || p.opacity < 0.5 || !p.text?.trim() || p.textSize >= min) continue;
      if (!seen.has(p.id) || seen.get(p.id)!.px > p.textSize) seen.set(p.id, { px: p.textSize, t: s.t, p });
    }
    return [...seen.values()].map(({ px, t, p }) => ({
      check: 'text-size', severity: 'warning', t, layers: [p.id],
      message: `"${name(p)}" is about ${Math.round(px)} px high at ${s2(t)} s: too small to read on a phone (at least ${min} px).`,
      say: { text: '"{name}" is about {px} px high: too small to read on a phone (at least {min} px)', params: { name: name(p), px: Math.round(px), min } },
    }));
  },
};

const textTime: CheckType = {
  name: 'text-time', title: 'Reading time', description: 'text on screen too briefly to be read',
  texts: ['"{name}" is readable for {time} s: {need} s are needed for {words} word(s)'],
  run({ samples, step }) {
    const shown = new Map<string, { time: number; first: number; p: PlacedLayer }>();
    for (const s of samples) for (const p of s.layers) {
      if (p.node.type !== 'text' || p.opacity < 0.6 || !p.text?.trim()) continue;
      const e = shown.get(p.id) ?? { time: 0, first: s.t, p };
      e.time += step;
      shown.set(p.id, e);
    }
    const out: QualityIssue[] = [];
    for (const { time, first, p } of shown.values()) {
      const n = words(p.text!), need = 0.5 + 0.25 * n;
      if (time + step / 2 >= need) continue;
      out.push({
        check: 'text-time', severity: 'warning', t: first, layers: [p.id],
        message: `"${name(p)}" is readable for about ${s2(time)} s from ${s2(first)} s: ${s2(need)} s are needed for ${n} word(s).`,
        say: { text: '"{name}" is readable for {time} s: {need} s are needed for {words} word(s)', params: { name: name(p), time: s2(time), need: s2(need), words: n } },
      });
    }
    return out;
  },
};

const safeZone: CheckType = {
  name: 'safe-zone', title: 'Safe zone', description: 'text too close to the edges of the frame',
  texts: ['"{name}" goes past the safe zone (5 % from the edges) at {t} s'],
  run({ comp, samples }) {
    const mx = comp.width * 0.05, my = comp.height * 0.05, out = new Map<string, QualityIssue>();
    for (const s of samples) for (const p of s.layers) {
      if (!p.box || p.textSize === undefined || p.node.type === 'captions' || p.opacity < 0.5 || out.has(p.id)) continue;
      const b = p.box;
      if (b.x >= mx && b.y >= my && b.x + b.w <= comp.width - mx && b.y + b.h <= comp.height - my) continue;
      out.set(p.id, {
        check: 'safe-zone', severity: 'warning', t: s.t, layers: [p.id],
        message: `"${name(p)}" goes past the safe zone (5 % from the edges) at ${s2(s.t)} s: box x ${Math.round(b.x)}..${Math.round(b.x + b.w)}, y ${Math.round(b.y)}..${Math.round(b.y + b.h)} in a ${comp.width}x${comp.height} frame.`,
        say: { text: '"{name}" goes past the safe zone (5 % from the edges) at {t} s', params: { name: name(p), t: s2(s.t) } },
      });
    }
    return [...out.values()];
  },
};

const overlap: CheckType = {
  name: 'text-overlap', title: 'Overlapping text', description: 'two texts on top of each other',
  texts: ['"{a}" and "{b}" overlap at {t} s'],
  run({ samples }) {
    const out = new Map<string, QualityIssue>();
    for (const s of samples) {
      const texts = s.layers.filter((p) => p.box && p.textSize !== undefined && p.opacity > 0.5 && p.text?.trim());
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i].box!, b = texts[j].box!, key = `${texts[i].id}|${texts[j].id}`;
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ix <= 0 || iy <= 0 || out.has(key) || ix * iy < 0.15 * Math.min(a.w * a.h, b.w * b.h)) continue;
        out.set(key, {
          check: 'text-overlap', severity: 'warning', t: s.t, layers: [texts[i].id, texts[j].id],
          message: `"${name(texts[i])}" and "${name(texts[j])}" overlap at ${s2(s.t)} s.`,
          say: { text: '"{a}" and "{b}" overlap at {t} s', params: { a: name(texts[i]), b: name(texts[j]), t: s2(s.t) } },
        });
      }
    }
    return [...out.values()];
  },
};

const crossing: CheckType = {
  name: 'text-crossing', title: 'Text crossing', description: 'text passing over another element, which may hurt its reading',
  texts: ['"{name}" passes over "{other}" around {t} s: check that it stays readable'],
  run({ comp, samples }) {
    // a background (half the frame or more) is not an element to avoid
    const frame = comp.width * comp.height, out = new Map<string, QualityIssue>();
    for (const s of samples) {
      for (const p of s.layers) {
        if (!p.box || p.textSize === undefined || p.opacity < 0.5 || !p.text?.trim()) continue;
        for (const q of s.layers) {
          if (q === p || !q.box || q.textSize !== undefined || q.opacity < 0.3 || q.box.w * q.box.h > frame * 0.5 || q.node.container) continue;
          const a = p.box, b = q.box, key = `${p.id}|${q.id}`;
          // a shape the whole text sits on (its card, its button) is its ground, not an element it crosses
          if (b.x <= a.x + 1 && b.y <= a.y + 1 && b.x + b.w >= a.x + a.w - 1 && b.y + b.h >= a.y + a.h - 1) continue;
          const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ix <= 0 || iy <= 0 || out.has(key) || ix * iy < 0.1 * a.w * a.h) continue;
          out.set(key, {
            check: 'text-crossing', severity: 'info', t: s.t, layers: [p.id, q.id],
            message: `"${name(p)}" passes over "${name(q)}" around ${s2(s.t)} s: check that it stays readable, or move one of them.`,
            say: { text: '"{name}" passes over "{other}" around {t} s: check that it stays readable', params: { name: name(p), other: name(q), t: s2(s.t) } },
          });
        }
      }
    }
    return [...out.values()];
  },
};

/** people found in a video or an image (the subjects tool), boxes 0..1 of the picture */
export interface Subjects {
  version: 1;
  kind: 'subjects';
  source?: string;
  width: number;
  height: number;
  frames: { t: number; boxes: { x: number; y: number; w: number; h: number; label: string; score: number }[] }[];
}
export const isSubjects = (x: unknown): x is Subjects => !!x && typeof x === 'object' && (x as Subjects).kind === 'subjects' && Array.isArray((x as Subjects).frames);

/** the time in its file a media layer shows at composition time t: the video node's clock (a picture: 0) */
const fileTime = (p: PlacedLayer, t: number): number => (p.node.type === 'video' ? mediaTime(p.props, t, p.layer.in ?? 0) : 0);

/** the picture of a media layer in its frame, as the node draws it (cover crops around its focus, contain fits, fill stretches) */
const pictureOf = (p: PlacedLayer, f: Rect, picW: number, picH: number): Rect =>
  pictureRect(String(p.props.fit ?? 'cover'), f.w, f.h, picW, picH, Array.isArray(p.props.focus) ? p.props.focus as number[] : undefined);

/** the people of a media layer at one instant, in composition space: their box and their head (the top quarter) */
export function subjectsOn(p: PlacedLayer, t: number, data: (id: string) => unknown): { box: Rect; head: Rect }[] {
  if ((p.node.type !== 'video' && p.node.type !== 'image') || !p.box) return [];
  const asset = String(p.props[p.node.type] ?? ''), s = data(`subjects-${asset}`.slice(0, 64));
  if (!isSubjects(s) || !s.frames.length) return [];
  const ft = fileTime(p, t);
  const frame = s.frames.reduce((a, b) => (Math.abs(b.t - ft) < Math.abs(a.t - ft) ? b : a));
  // the picture in its frame: cover crops around its focus, contain fits, fill stretches (an image's zoom left aside)
  const f = p.box, r = pictureOf(p, f, s.width, s.height);
  const sx = r.w, sy = r.h, ox = f.x + f.w / 2 + r.x, oy = f.y + f.h / 2 + r.y;
  return frame.boxes.filter((b) => b.label === 'person').map((b) => {
    const box = { x: ox + b.x * sx, y: oy + b.y * sy, w: b.w * sx, h: b.h * sy };
    return { box, head: { x: box.x + box.w * 0.15, y: box.y, w: box.w * 0.7, h: Math.min(box.h, box.w * 1.1) * 0.9 } };
  });
}

/** the free space of a media's frame (the space tool): a grid of how busy each cell is, 0 clear to 1 crowded */
export interface Space {
  version: 1;
  kind: 'space';
  source?: string;
  /** the frame the grid was read at (s, in the media's own time) */
  t: number;
  /** the media's own pixel size, so the grid maps onto a layer's picture */
  width?: number;
  height?: number;
  cols: number;
  rows: number;
  busy: number[];
  /** the mean luminance of each cell, 0 black to 1 white (for the contrast check) */
  luma?: number[];
  /** fractions of the frame: the clear sides and the largest clear rectangle */
  sides?: { left: number; right: number; top: number; bottom: number };
  rect?: Rect;
}
export const isSpace = (x: unknown): x is Space => !!x && typeof x === 'object' && (x as Space).kind === 'space' && typeof (x as Space).cols === 'number' && Array.isArray((x as Space).busy);

/** the busy cells of a media layer's free-space grid, in composition space (the picture only: cover crops, contain fits, fill stretches) */
export function spaceOn(p: PlacedLayer, t: number, data: (id: string) => unknown): { busy: number; box: Rect }[] {
  if ((p.node.type !== 'video' && p.node.type !== 'image') || !p.box) return [];
  const asset = String(p.props[p.node.type] ?? ''), s = data(`space-${asset}`.slice(0, 64));
  if (!isSpace(s) || !s.busy.length || !s.width || !s.height) return [];
  const ft = fileTime(p, t);
  // one frame was read: too far from this one, the grid would describe another shot
  if (p.node.type === 'video' && Math.abs(s.t - ft) > 0.6) return [];
  const f = p.box, r = pictureOf(p, f, s.width, s.height);
  const cw = r.w / s.cols, ch = r.h / s.rows, ox = f.x + f.w / 2 + r.x, oy = f.y + f.h / 2 + r.y;
  const cells: { busy: number; box: Rect }[] = [];
  for (let i = 0; i < s.busy.length; i++) if (s.busy[i] >= 0.6) cells.push({ busy: s.busy[i], box: { x: ox + (i % s.cols) * cw, y: oy + Math.floor(i / s.cols) * ch, w: cw, h: ch } });
  return cells;
}

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** a paint's luminance, 0 black to 1 white: hex and rgb()/rgba() colours and their @tokens; null for gradients and unknown names */
export function paintLuma(paint: unknown, tokens?: Record<string, { type: string; value: unknown }>): number | null {
  let c = paint;
  if (typeof c === 'string' && c.startsWith('@')) {
    const tk = tokens?.[c.slice(1)];
    if (!tk || tk.type !== 'color' || typeof tk.value !== 'string') return null;
    c = tk.value;
  }
  if (typeof c !== 'string') return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
    return 0.2126 * (parseInt(h.slice(0, 2), 16) / 255) + 0.7152 * (parseInt(h.slice(2, 4), 16) / 255) + 0.0722 * (parseInt(h.slice(4, 6), 16) / 255);
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c);
  return rgb ? 0.2126 * (Number(rgb[1]) / 255) + 0.7152 * (Number(rgb[2]) / 255) + 0.0722 * (Number(rgb[3]) / 255) : null;
}

/** the mean luminance under a box of a media layer's picture, from its free-space grid (null without one): a cheap stand-in for real pixels */
export function lumaUnder(p: PlacedLayer, t: number, tb: Rect, data: (id: string) => unknown): number | null {
  if ((p.node.type !== 'video' && p.node.type !== 'image') || !p.box) return null;
  const asset = String(p.props[p.node.type] ?? ''), s = data(`space-${asset}`.slice(0, 64));
  if (!isSpace(s) || !s.luma || s.luma.length !== s.cols * s.rows || !s.width || !s.height) return null;
  const ft = fileTime(p, t);
  if (p.node.type === 'video' && Math.abs(s.t - ft) > 0.6) return null;
  const f = p.box, r = pictureOf(p, f, s.width, s.height);
  const cw = r.w / s.cols, ch = r.h / s.rows, ox = f.x + f.w / 2 + r.x, oy = f.y + f.h / 2 + r.y;
  let sum = 0, area = 0;
  for (let i = 0; i < s.luma.length; i++) {
    const a = overlapArea(tb, { x: ox + (i % s.cols) * cw, y: oy + Math.floor(i / s.cols) * ch, w: cw, h: ch });
    if (a > 0) { sum += s.luma[i] * a; area += a; }
  }
  return area > 0 ? sum / area : null;
}

const textContrast: CheckType = {
  name: 'text-contrast', title: 'Low contrast', description: 'text whose colour sits too close to what is behind it (against a picture after the space tool, or the composition background)',
  texts: ['"{name}" is hard to read at {t} s: its colour is too close to what is behind it (contrast {cr}:1)'],
  run({ samples, data, comp, doc }) {
    const out = new Map<string, QualityIssue>();
    for (const s of samples) {
      for (const p of s.layers) {
        if (out.has(p.id) || !p.box || p.textSize === undefined || p.opacity < 0.5 || !p.text?.trim()) continue;
        const ink = paintLuma(p.props.color, doc.tokens);
        if (ink === null) continue;
        // what is under: the picture with a free-space analysis that covers most of the text, else the composition's own background
        let bgL: number | null = null, bg = '';
        let cover = 0;
        for (const q of s.layers) {
          if (q.id === p.id || (q.node.type !== 'video' && q.node.type !== 'image') || !q.box) continue;
          const l = lumaUnder(q, s.t, p.box, data);
          if (l === null) continue;
          const cov = overlapArea(p.box, q.box) / (p.box.w * p.box.h || 1);
          if (cov > cover) { cover = cov; bgL = l; bg = q.node.type === 'video' ? 'footage' : 'a picture'; }
        }
        if (cover < 0.6) { bgL = paintLuma(comp.background, doc.tokens); bg = 'the background'; }
        if (bgL === null) continue;
        // half-transparent ink sinks into its ground
        const mixed = ink * p.opacity + bgL * (1 - p.opacity);
        const cr = (Math.max(mixed, bgL) + 0.05) / (Math.min(mixed, bgL) + 0.05);
        if (cr >= 2.5) continue;
        out.set(p.id, {
          check: 'text-contrast', severity: 'warning', t: s.t, layers: [p.id],
          message: `"${name(p)}" is hard to read at ${s2(s.t)} s: its colour is too close to ${bg} (contrast ${cr.toFixed(1)}:1). A colour further from it, or a soft shadow, would hold.`,
          say: { text: '"{name}" is hard to read at {t} s: its colour is too close to what is behind it (contrast {cr}:1)', params: { name: name(p), t: s2(s.t), cr: cr.toFixed(1) } },
        });
      }
    }
    return [...out.values()];
  },
};

const overSubject: CheckType = {
  name: 'text-over-subject', title: 'Text over a person', description: 'text covering the face or the body of someone filmed (after the subjects tool)',
  texts: ['"{name}" covers a face at {t} s', '"{name}" covers someone at {t} s'],
  run({ samples, data }) {
    const out = new Map<string, QualityIssue>();
    for (const s of samples) {
      const people = s.layers.flatMap((p) => subjectsOn(p, s.t, data));
      if (!people.length) continue;
      for (const p of s.layers) {
        if (!p.box || p.textSize === undefined || p.opacity < 0.5 || !p.text?.trim() || out.has(p.id)) continue;
        const area = p.box.w * p.box.h;
        const face = people.find((x) => overlapArea(p.box!, x.head) > 0.12 * Math.min(area, x.head.w * x.head.h));
        const body = !face && people.find((x) => overlapArea(p.box!, x.box) > 0.35 * area);
        if (!face && !body) continue;
        out.set(p.id, {
          check: 'text-over-subject', severity: face ? 'warning' : 'info', t: s.t, layers: [p.id],
          message: face ? `"${name(p)}" covers a face at ${s2(s.t)} s: move it above or below the head, or to the free side of the frame.` : `"${name(p)}" covers someone at ${s2(s.t)} s: the free side of the frame would read better.`,
          say: { text: face ? '"{name}" covers a face at {t} s' : '"{name}" covers someone at {t} s', params: { name: name(p), t: s2(s.t) } },
        });
      }
    }
    return [...out.values()];
  },
};

const overDetail: CheckType = {
  name: 'text-over-detail', title: 'Text over detail', description: 'text landing where the picture is busy (after the space tool)',
  texts: ['"{name}" sits on a busy part of the footage at {t} s: the free-space analysis points at clearer ground'],
  run({ samples, data }) {
    const out = new Map<string, QualityIssue>();
    for (const s of samples) {
      // the busy cells of each picture on screen (like the people of text-over-subject): the texts are tested against them
      const pictures = s.layers.map((q) => ({ q, cells: spaceOn(q, s.t, data) })).filter((m) => m.cells.length);
      if (!pictures.length) continue;
      for (const p of s.layers) {
        if (!p.box || p.textSize === undefined || p.opacity < 0.5 || !p.text?.trim() || out.has(p.id)) continue;
        const tb = p.box, area = tb.w * tb.h || 1;
        // within one picture the cells do not overlap, so the clipped areas add up: the share of the text on its busiest picture
        let hit = 0, under: PlacedLayer | null = null;
        for (const m of pictures) {
          let h = 0;
          for (const c of m.cells) h += overlapArea(tb, c.box);
          if (h > hit) { hit = h; under = m.q; }
        }
        if (!under || hit < 0.35 * area) continue;
        const pct = (x: number) => `${Math.round(x * 100)} %`;
        const sp = data(`space-${String(under.props[under.node.type] ?? '')}`.slice(0, 64));
        const rect = isSpace(sp) && sp.rect ? ` The analysis points at clearer ground at x ${pct(sp.rect.x)}–${pct(sp.rect.x + sp.rect.w)}, y ${pct(sp.rect.y)}–${pct(sp.rect.y + sp.rect.h)} of the frame.` : ' The analysis points at clearer ground.';
        out.set(p.id, {
          check: 'text-over-detail', severity: 'warning', t: s.t, layers: [p.id],
          message: `"${name(p)}" sits on a busy part of the footage at ${s2(s.t)} s (about ${Math.round((100 * hit) / area)} % of its area).${rect}`,
          say: { text: '"{name}" sits on a busy part of the footage at {t} s: the free-space analysis points at clearer ground', params: { name: name(p), t: s2(s.t) } },
        });
      }
    }
    return [...out.values()];
  },
};

const crowd: CheckType = {
  name: 'crowd', title: 'Crowded entrances', description: 'many elements appearing at the same moment',
  texts: ['{n} elements appear together around {t} s: stagger them so the eye can follow'],
  run({ samples }) {
    // when each layer appears: its first sample with some opacity
    const first = new Map<string, number>();
    for (const s of samples) for (const p of s.layers) if (p.opacity > 0.05 && p.box && !first.has(p.id)) first.set(p.id, s.t);
    const times = [...first.entries()].filter(([, t]) => t > 0).sort((a, b) => a[1] - b[1]);
    const out: QualityIssue[] = [];
    for (let i = 0; i < times.length;) {
      let j = i;
      while (j + 1 < times.length && times[j + 1][1] - times[i][1] <= 0.25) j++;
      const group = times.slice(i, j + 1);
      if (group.length >= 4) out.push({
        check: 'crowd', severity: 'info', t: group[0][1], layers: group.map(([id]) => id),
        message: `${group.length} elements appear together around ${s2(group[0][1])} s (${group.map(([id]) => id).slice(0, 6).join(', ')}${group.length > 6 ? '…' : ''}): stagger them so the eye can follow.`,
        say: { text: '{n} elements appear together around {t} s: stagger them so the eye can follow', params: { n: group.length, t: s2(group[0][1]) } },
      });
      i = j + 1;
    }
    return out;
  },
};

const stillness: CheckType = {
  name: 'stillness', title: 'Still stretches', description: 'long moments where nothing moves',
  texts: ['nothing moves from {from} to {to} s'],
  run({ samples, comp, step }) {
    // a video, a sequence or a nested composition plays by itself (a composition's own stretches are found when it is checked); otherwise compare the placed layers between samples
    const sig = (s: Sample) => s.layers.map((p) => (p.node.type === 'video' || p.node.type === 'sequence' || p.node.type === 'particles' || p.node.type === 'shader' || p.node.type === 'comp' ? `${p.id}:${s.t}` : `${p.id}:${p.opacity.toFixed(2)}:${p.box ? [p.box.x, p.box.y, p.box.w, p.box.h].map((v) => v.toFixed(0)).join(',') : ''}:${JSON.stringify(p.props)}`)).join('|');
    const out: QualityIssue[] = [];
    let from = 0;
    for (let i = 1; i <= samples.length; i++) {
      const same = i < samples.length && sig(samples[i]) === sig(samples[i - 1]);
      if (same) continue;
      const to = i < samples.length ? samples[i].t : comp.duration;
      if (to - from >= Math.max(2.5, step * 4) && from < comp.duration - 0.5) out.push({
        check: 'stillness', severity: 'info', t: s2(from),
        message: `Nothing moves from ${s2(from)} to ${s2(to)} s: a slow drift, a scale breathing or a new element would keep the eye busy.`,
        say: { text: 'nothing moves from {from} to {to} s', params: { from: s2(from), to: s2(to) } },
      });
      from = i < samples.length ? samples[i].t : comp.duration;
    }
    return out;
  },
};

// ── the movement, measured (motion.ts: the figures of the sampled series) ──
const NM = (comp: Composition, id: string) => comp.layers[id]?.name ?? id;

const linearTravel: CheckType = {
  name: 'linear-travel', title: 'Linear travel', description: 'a position or a scale moving at a constant speed, the tell of a missing ease',
  texts: ['"{name}" moves at a constant speed: ease it (ease out on an entrance, ease in on an exit)'],
  run(ctx) {
    const min = 0.08 * u(ctx.comp), out: QualityIssue[] = [];
    for (const { address, layerId, raw } of animatedSlots(ctx.doc, ctx.registry, ctx.compId)) {
      if (!layerId || (!address.endsWith('.transform.position') && !address.endsWith('.transform.scale'))) continue;
      const [from, to] = spanOf(ctx.comp, layerId);
      if (to - from < 0.3) continue;
      // the keyframes on the grid, so each segment reads true (a half-step at the ends would dilute the evenness),
      // and points inside each segment: a short move in a long-lived layer is sampled where it happens, not jumped over
      const kt = propKind(raw) === 'keyframes' ? asKeyframed(raw).$k.map((k) => k.t) : [];
      const keys = kt.flatMap((t, i) => (i === 0 ? [t] : Array.from({ length: 8 }, (_, j) => kt[i - 1] + ((t - kt[i - 1]) * (j + 1)) / 8)));
      const s = sampleAddress(ctx.evaluator, address, ctx.compId, from, to, 32, keys);
      if (!s) continue;
      // the move itself, holds left out: a layer that lives longer than its move is judged on the move
      const stretch = motionStretches(s.times, s.values).find((st) => st.to - st.from >= 0.3 && st.figures.evenness >= 0.92 && st.figures.turns === 0);
      if (!stretch) continue;
      const isPosition = address.endsWith('.transform.position');
      if (isPosition ? stretch.figures.travel < min : stretch.figures.change < 0.08) continue;
      const nm = NM(ctx.comp, layerId);
      out.push({
        check: 'linear-travel', severity: 'warning', t: s2(stretch.from), layers: [layerId],
        message: `"${nm}" moves at a constant speed from ${s2(stretch.from)} to ${s2(stretch.to)} s (${address}): ease it (ease out on an entrance, ease in on an exit).`,
        say: { text: '"{name}" moves at a constant speed: ease it (ease out on an entrance, ease in on an exit)', params: { name: nm } },
      });
    }
    return out;
  },
};

const springSettle: CheckType = {
  name: 'spring-settle', title: 'Spring settle', description: 'a spring still moving when its layer leaves, or bouncing too far past its mark',
  texts: ['"{name}" is still moving when it leaves: more damping, or more time', '"{name}" overshoots its mark by {pct}%: one bounce is lively, more is nervous'],
  run(ctx) {
    const out: QualityIssue[] = [];
    for (const { address, layerId, raw } of animatedSlots(ctx.doc, ctx.registry, ctx.compId)) {
      if (!layerId || !modsOf(raw)?.some((m) => m.type === 'spring')) continue;
      const [from, to] = spanOf(ctx.comp, layerId);
      if (to - from < 0.2) continue;
      const s = sampleAddress(ctx.evaluator, address, ctx.compId, from, to, 48);
      const f = s && motionFigures(s.times, s.values);
      if (!f || f.travel < 0.002 * u(ctx.comp)) continue;
      const nm = NM(ctx.comp, layerId);
      if (f.settle === undefined && f.turns >= 1) {
        out.push({
          check: 'spring-settle', severity: 'warning', t: s2(to - 0.05), layers: [layerId],
          message: `"${nm}" is still moving when it leaves at ${s2(to)} s (${address}): more damping, or more time.`,
          say: { text: '"{name}" is still moving when it leaves: more damping, or more time', params: { name: nm } },
        });
      } else if (f.settle !== undefined && f.turns >= 1 && Math.abs(f.change) > 1e-9 && f.overshoot > 0.3 * Math.abs(f.change)) {
        const pct = Math.round((100 * f.overshoot) / Math.abs(f.change));
        out.push({
          check: 'spring-settle', severity: 'info', t: s2(from + f.peakAt), layers: [layerId],
          message: `"${nm}" overshoots its mark by ${pct}% (${address}): one bounce is lively, more is nervous.`,
          say: { text: '"{name}" overshoots its mark by {pct}%: one bounce is lively, more is nervous', params: { name: nm, pct } },
        });
      }
    }
    return out;
  },
};

const twinMotion: CheckType = {
  name: 'twin-motion', title: 'Twin motions', description: 'two layers whose positions follow the same series, which reads as a copy',
  texts: ['"{a}" and "{b}" move identically: offset, stagger or vary one'],
  run(ctx) {
    const ids = [...new Set(animatedSlots(ctx.doc, ctx.registry, ctx.compId).filter((s) => s.layerId && s.address.endsWith('.transform.position')).map((s) => s.layerId))];
    const out: QualityIssue[] = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = spanOf(ctx.comp, ids[i]), b = spanOf(ctx.comp, ids[j]);
      const from = Math.max(a[0], b[0]), to = Math.min(a[1], b[1]);
      if (to - from < 0.4) continue;
      const A = sampleAddress(ctx.evaluator, `${ids[i]}.transform.position`, ctx.compId, from, to, 24);
      const B = sampleAddress(ctx.evaluator, `${ids[j]}.transform.position`, ctx.compId, from, to, 24);
      if (!A || !B) continue;
      const fa = motionFigures(A.times, A.values), fb = motionFigures(B.times, B.values);
      if (!fa || !fb || Math.max(fa.travel, fb.travel) < 0.06 * u(ctx.comp)) continue;
      if (Math.abs(fa.travel - fb.travel) > 0.1 * Math.max(fa.travel, fb.travel)) continue;
      // the same series: each reduced to its own start, close at every sample (2 % of the travel)
      const rel = (s: { values: (number | number[])[] }): [number, number][] => {
        const p0 = s.values[0], x0 = Array.isArray(p0) ? p0[0] : p0 as number, y0 = Array.isArray(p0) ? p0[1] ?? 0 : 0;
        return s.values.map((v) => { const p = Array.isArray(v) ? v : [v as number, 0]; return [p[0] - x0, p[1] - y0]; });
      };
      const ra = rel(A), rb = rel(B);
      let drift = 0;
      for (let k = 0; k < Math.min(ra.length, rb.length); k++) drift = Math.max(drift, Math.hypot(ra[k][0] - rb[k][0], ra[k][1] - rb[k][1]));
      if (drift > 0.02 * Math.max(fa.travel, fb.travel)) continue;
      out.push({
        check: 'twin-motion', severity: 'info', t: s2(from), layers: [ids[i], ids[j]],
        message: `"${NM(ctx.comp, ids[i])}" and "${NM(ctx.comp, ids[j])}" move identically from ${s2(from)} to ${s2(to)} s: offset, stagger or vary one.`,
        say: { text: '"{a}" and "{b}" move identically: offset, stagger or vary one', params: { a: NM(ctx.comp, ids[i]), b: NM(ctx.comp, ids[j]) } },
      });
    }
    return out;
  },
};

const abruptEntrance: CheckType = {
  name: 'abrupt-entrance', title: 'Abrupt entrance', description: 'an entrance at full speed, the tell of a missing ease out',
  texts: ['"{name}" enters at full speed: ease it in (start gently, land softly), about 300 ms'],
  run(ctx) {
    const seen = new Map<string, QualityIssue>();
    for (const { address, layerId, raw } of animatedSlots(ctx.doc, ctx.registry, ctx.compId)) {
      // a spinner spins linearly on purpose, as in linear-travel
      if (!layerId || seen.has(layerId) || address.endsWith('.transform.rotation')) continue;
      const at = ctx.comp.layers[layerId]?.in ?? 0;
      const [from, to] = spanOf(ctx.comp, layerId);
      if (to - at < 0.25) continue;
      // the first move after the layer appears is its entrance; a move that starts later is judged by linear-travel instead
      const keys = propKind(raw) === 'keyframes' ? asKeyframed(raw).$k.map((k) => k.t) : [];
      const s = sampleAddress(ctx.evaluator, address, ctx.compId, at, Math.min(to, at + 1.2), 24, keys);
      if (!s) continue;
      const st = motionStretches(s.times, s.values).find((x) => x.from <= at + 0.25 && x.to - x.from >= 0.25 && x.figures.evenness >= 0.92 && x.figures.turns === 0);
      if (!st) continue;
      const isPosition = address.endsWith('.transform.position'), isScale = address.endsWith('.transform.scale'), isOpacity = address.endsWith('.transform.opacity');
      if (isPosition ? st.figures.travel < 0.06 * u(ctx.comp) : isScale ? st.figures.change < 0.08 : isOpacity ? st.figures.change < 0.6 : st.figures.travel < 0.03 * u(ctx.comp)) continue;
      const nm = NM(ctx.comp, layerId);
      seen.set(layerId, {
        check: 'abrupt-entrance', severity: 'warning', t: s2(st.from), layers: [layerId],
        message: `"${nm}" enters at full speed at ${s2(st.from)} s (${address}): ease it in (start gently, land softly), about 300 ms.`,
        say: { text: '"{name}" enters at full speed: ease it in (start gently, land softly), about 300 ms', params: { name: nm } },
      });
    }
    return [...seen.values()];
  },
};

const straightTravel: CheckType = {
  name: 'straight-travel', title: 'Straight travel', description: 'a big diagonal travel in a straight line, where an arc would read better',
  texts: ['"{name}" travels in a straight line: bend the move (a mid keyframe off the line, or x then y)'],
  run(ctx) {
    const out: QualityIssue[] = [];
    for (const { address, layerId, raw } of animatedSlots(ctx.doc, ctx.registry, ctx.compId)) {
      if (!layerId || !address.endsWith('.transform.position')) continue;
      const [from, to] = spanOf(ctx.comp, layerId);
      if (to - from < 0.4) continue;
      const keys = propKind(raw) === 'keyframes' ? asKeyframed(raw).$k.map((k) => k.t) : [];
      const s = sampleAddress(ctx.evaluator, address, ctx.compId, from, to, 32, keys);
      if (!s) continue;
      const st = motionStretches(s.times, s.values).find((x) => x.to - x.from >= 0.4 && x.figures.turns === 0 && x.figures.travel >= 0.12 * u(ctx.comp));
      if (!st) continue;
      const path = s.times.map((t, i) => ({ t, p: Array.isArray(s.values[i]) ? (s.values[i] as number[]) : null })).filter((x) => x.p && x.t >= st.from - 1e-6 && x.t <= st.to + 1e-6);
      const [a, b] = [path[0].p!, path[path.length - 1].p!];
      const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
      // a slide along one axis is straight on purpose; a diagonal that stays straight is the missing arc
      if (Math.min(dx, dy) < 0.2 * Math.max(dx, dy)) continue;
      const dev = pathDeviation(path.map((x) => x.p!));
      // already bent: nothing to say
      if (dev === null || dev > 0.02) continue;
      const nm = NM(ctx.comp, layerId);
      out.push({
        check: 'straight-travel', severity: 'info', t: s2(st.from), layers: [layerId],
        message: `"${nm}" travels in a straight line from ${s2(st.from)} to ${s2(st.to)} s: bend the move (a mid keyframe off the line, or x then y).`,
        say: { text: '"{name}" travels in a straight line: bend the move (a mid keyframe off the line, or x then y)', params: { name: nm } },
      });
    }
    return out;
  },
};

const uniformStagger: CheckType = {
  name: 'uniform-stagger', title: 'Metronomic stagger', description: 'a group entering with even offsets, which reads as mechanical',
  texts: ['{n} elements enter with even offsets of about {ms} ms: vary the gaps'],
  run(ctx) {
    const lists: string[][] = [];
    for (const l of Object.values(ctx.comp.layers)) if (l.type === 'group' && (l.children?.length ?? 0) >= 3) lists.push(l.children!);
    lists.push(ctx.comp.order.filter((id) => ctx.comp.layers[id]?.type !== 'group'));
    const out: QualityIssue[] = [];
    for (const list of lists) {
      const ins = list.map((id) => ({ id, at: ctx.comp.layers[id]?.in ?? 0 })).filter((x) => x.at > 0).sort((a, b) => a.at - b.at);
      if (ins.length < 3) continue;
      const gaps: number[] = [];
      for (let i = 1; i < ins.length; i++) gaps.push(+(ins[i].at - ins[i - 1].at).toFixed(4));
      if (gaps.some((g) => g < 0.04 || g > 0.4) || Math.max(...gaps) - Math.min(...gaps) > 0.03) continue;
      const ms = Math.round((gaps.reduce((a, b) => a + b, 0)) / gaps.length * 1000);
      out.push({
        check: 'uniform-stagger', severity: 'info', t: s2(ins[0].at), layers: ins.map((x) => x.id),
        message: `${ins.length} elements enter with even offsets of about ${ms} ms from ${s2(ins[0].at)} s: vary the gaps (30 to 60 ms, uneven).`,
        say: { text: '{n} elements enter with even offsets of about {ms} ms: vary the gaps', params: { n: ins.length, ms } },
      });
    }
    return out;
  },
};

/**
 * The values of a layer and its subtree, flattened ('props.fill', 'children.1.transform.scale'),
 * its own timing and place left out (what instances differ by), keyframe
 * times counted from its in point
 */
function leaves(comp: Composition, id: string, depth = 0): Map<string, string> {
  const out = new Map<string, string>(), l = comp.layers[id];
  if (!l || depth > 8) return out;
  const from = l.in ?? 0;
  const walk = (x: unknown, path: string) => {
    if (Array.isArray(x)) { x.forEach((y, i) => walk(y, `${path}.${i}`)); return; }
    if (x && typeof x === 'object') {
      for (const [k, v] of Object.entries(x)) {
        if (k === 't' && typeof v === 'number' && /\$k\.\d+$/.test(path)) out.set(`${path}.t`, String(+(v - from).toFixed(3)));
        else walk(v, `${path}.${k}`);
      }
      return;
    }
    out.set(path, JSON.stringify(x));
  };
  const { in: _in, out: _out, name: _name, children, transform, ...rest } = l;
  walk(rest, '');
  if (transform) { const { position: _p, ...tr } = transform; walk(tr, '.transform'); }
  (children ?? []).forEach((c, i) => { for (const [k, v] of leaves(comp, c, depth + 1)) out.set(`.children.${i}${k}`, v); });
  return out;
}

const repeated: CheckType = {
  name: 'repeated', title: 'Repeated elements', description: 'layers or groups written several times nearly the same: one component and its instances say it once',
  texts: ['{n} nearly identical elements ({type}): define one component and place instances of it'],
  run(ctx) {
    const out: QualityIssue[] = [];
    const lists = [ctx.comp.order, ...Object.values(ctx.comp.layers).filter((l) => l.children?.length).map((l) => l.children!)];
    for (const list of lists) {
      // the same paths (structure) and few values apart: at most 4 of them, and fewer than a third
      const groups = new Map<string, { ids: string[]; first: Map<string, string> }>();
      for (const id of list) {
        const l = ctx.comp.layers[id];
        if (!l || l.type === 'comp') continue;
        const lv = leaves(ctx.comp, id), key = `${l.type}|${[...lv.keys()].sort().join(',')}`;
        const g = groups.get(key);
        if (!g) { groups.set(key, { ids: [id], first: lv }); continue; }
        let diff = 0;
        for (const [k, v] of lv) if (g.first.get(k) !== v) diff++;
        if (diff <= Math.min(4, Math.max(1, Math.floor(lv.size / 3)))) g.ids.push(id);
      }
      for (const [key, g] of groups) {
        const type = key.split('|')[0], subtree = [...g.first.keys()].some((k) => k.startsWith('.children.'));
        if (g.ids.length < (subtree ? 2 : 3)) continue;
        out.push({
          check: 'repeated', severity: 'info', layers: g.ids,
          message: `${g.ids.length} nearly identical ${type} ${subtree ? 'groups' : 'layers'} (${g.ids.slice(0, 6).join(', ')}${g.ids.length > 6 ? '…' : ''}): define one component (use_tool "define_component" with them) and place instances of it ("instantiate", a distribution for many), so a change is made once.`,
          say: { text: '{n} nearly identical elements ({type}): define one component and place instances of it', params: { n: g.ids.length, type } },
        });
      }
    }
    return out;
  },
};

export const BUILTIN_CHECKS: CheckType[] = [textSize, textTime, safeZone, overlap, crossing, overSubject, overDetail, textContrast, crowd, stillness, linearTravel, springSettle, twinMotion, abruptEntrance, straightTravel, uniformStagger, repeated, sequenceCheck];

/** every check of the registry on one composition, the failures of a check reported as issues */
export async function runChecks(doc: TrammeDoc, registry: Registry, compId = doc.root, { step = 0.25, only, data = () => undefined }: { step?: number; only?: string[]; data?: (assetId: string) => unknown } = {}): Promise<QualityIssue[]> {
  const evaluator = new Evaluator(doc, registry, { data });
  const comp = evaluator.comp(compId);
  const ctx: CheckContext = { doc, compId, comp, registry, evaluator, samples: sampleComposition(evaluator, compId, step), step, data };
  const out: QualityIssue[] = [];
  for (const { check } of registry.listChecks()) {
    if (only && !only.includes(check.name)) continue;
    try { out.push(...(await check.run(ctx)).map((i) => ({ ...i, check: i.check || check.name }))); }
    catch (e) { out.push({ check: check.name, severity: 'info', message: `the check "${check.name}" failed: ${(e as Error).message}` }); }
  }
  return out.sort((a, b) => (a.severity === b.severity ? (a.t ?? 0) - (b.t ?? 0) : a.severity === 'warning' ? -1 : 1));
}

