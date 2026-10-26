// Made by hand: warmth for explainers. Strokes that boil (a GLSL effect that
// redraws the layer a little off every 2 or 3 frames), motion on twos (a
// modifier that holds every value for n frames with a small seeded jitter),
// rough shapes drawn as two seeded passes that overshoot their corners, and
// the annotate tool: a circle, an underline, a box, a highlight, a strike or
// a bracket around a layer, drawn on a beat after it lands and following it
// when it moves. The sketchbook kit brings the paper, the graphite and the
// handwritten face (Caveat, OFL, shipped beside the pack).

// ── seeded marks ─────────────────────────────────────────────
const hash2 = (x, y) => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * The time a hold lands on: the nearest block of n frames (counted from 0),
 * so the same block gives the same value whatever instant of it is asked.
 */
export function held(t, fps, n = 2) {
  const f = Math.round(t * fps);
  return (Math.ceil(f / Math.max(1, n) - 0.5) * Math.max(1, n)) / fps;
}

/** a deterministic nudge for one step of a hold: the same seed and step, the same pair */
export function jitter(seed, step, amount) {
  return [(hash2(seed, step * 2 + 1) - 0.5) * 2 * amount, (hash2(seed + 1, step * 2 + 2) - 0.5) * 2 * amount];
}

/** where the boil stands at a frame: one offset per block of `every` frames, held between */
export function boilAt(frame, seed = 0, amount = 1.5, every = 2) {
  const tick = Math.floor(frame / Math.max(1, every));
  return [(hash2(seed + 101, tick) - 0.5) * 2 * amount, (hash2(seed + 607, tick) - 0.5) * 2 * amount];
}

// ── rough paths ──────────────────────────────────────────────
const R = (seed, k) => (hash2(seed, k) - 0.5) * 2;
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * A shape drawn as a hand would: two passes, each wobbling off the true
 * geometry and overshooting its corners a little, deterministic per seed.
 * `kind`: 'line', 'arrow', 'rect', 'ellipse' or 'bracket'; the contours are
 * plain polylines ({ v, closed }) the node draws smoothed.
 */
export function roughPath(kind, box, seed = 1) {
  const { x, y, w, h } = box;
  const line = (x0, y0, x1, y1, s, k) => {
    const pts = [];
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const u = i / n, e = i === 0 || i === n ? 0 : 1;
      pts.push([r2(x0 + (x1 - x0) * u + R(s, k * 31 + i) * e * Math.min(14, Math.hypot(x1 - x0, y1 - y0) * 0.03)), r2(y0 + (y1 - y0) * u + R(s, k * 57 + i) * e * Math.min(14, Math.hypot(x1 - x0, y1 - y0) * 0.03))]);
    }
    // the overshoot: a little past each end, along the line
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, over = 0.03 + Math.abs(R(s, k * 7)) * 0.05;
    pts[0] = [r2(x0 - dx / len * len * over), r2(y0 - dy / len * len * over)];
    pts[pts.length - 1] = [r2(x1 + dx / len * len * over), r2(y1 + dy / len * len * over)];
    return { v: pts, closed: false };
  };
  const passes = (make) => [make(0), make(1)];
  if (kind === 'line') return passes((p) => line(x, y, x + w, y + h, seed + p * 977, p));
  if (kind === 'arrow') {
    const out = [];
    for (let p = 0; p < 2; p++) {
      out.push(line(x, y, x + w, y + h, seed + p * 977, p));
      const a = Math.atan2(h, w), head = Math.min(26, Math.hypot(w, h) * 0.28) * (0.9 + Math.abs(R(seed + p * 977, 91)) * 0.2);
      out.push(line(x + w - Math.cos(a - 0.5) * head, y + h - Math.sin(a - 0.5) * head, x + w, y + h, seed + p * 977, p + 5));
      out.push(line(x + w - Math.cos(a + 0.5) * head, y + h - Math.sin(a + 0.5) * head, x + w, y + h, seed + p * 977, p + 9));
    }
    return out;
  }
  if (kind === 'rect' || kind === 'bracket') {
    if (kind === 'bracket') {
      // an opening bracket: down, across, up — three strokes that overshoot their corners
      const bx = x + w, cx = x + w * 0.45;
      return passes((p) => [
        line(bx, y, cx, y, seed + p * 977, p * 3 + 1),
        line(cx, y, cx, y + h, seed + p * 977, p * 3 + 2),
        line(cx, y + h, bx, y + h, seed + p * 977, p * 3 + 3),
      ]).flat();
    }
    const out = [];
    for (let p = 0; p < 2; p++) {
      const s = seed + p * 977, j = (k) => R(s, k) * Math.min(8, Math.min(w, h) * 0.06);
      // the corners, overshot: each turn runs a little past before it comes back
      const over = Math.min(w, h) * (0.04 + Math.abs(R(s, 5)) * 0.05);
      const pts = [
        [r2(x + over * (0.6 + R(s, 11) * 0.4)), r2(y + j(1))],
        [r2(x + w + over), r2(y + j(2))],
        [r2(x + w + j(3)), r2(y + h + over)],
        [r2(x - over * 0.4), r2(y + h + j(4))],
        [r2(x + j(5)), r2(y - over)],
        [r2(x + w * 0.3 * (0.8 + R(s, 13) * 0.4)), r2(y + j(6) * 0.6)],
      ];
      out.push({ v: pts, closed: false });
    }
    return out;
  }
  // the ellipse: around the ring, the two passes ending past their start
  const out = [];
  for (let p = 0; p < 2; p++) {
    const s = seed + p * 977, n = 14, extra = 2;
    const pts = [];
    for (let i = 0; i <= n + extra; i++) {
      const a = (i / n) * Math.PI * 2;
      const wob = 1 + R(s, i) * 0.045;
      pts.push([r2(x + w / 2 + Math.cos(a) * w * 0.5 * wob), r2(y + h / 2 + Math.sin(a) * h * 0.5 * wob)]);
    }
    out.push({ v: pts, closed: false });
  }
  return out;
}

/** the fill of a sketch: straightish strokes at an angle, a gap apart, wobbling a little (deterministic per seed) */
export function hachure(box, angle = -41, gap = 8, seed = 1) {
  const { x, y, w, h } = box;
  const out = [];
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const len = Math.hypot(w, h) + gap;
  const cx = x + w / 2, cy = y + h / 2;
  for (let d = -len / 2; d <= len / 2; d += gap) {
    // the stroke across the box, offset along the normal
    const ox = -dy * d, oy = dx * d;
    const half = len / 2;
    let p0 = [cx + ox - dx * half, cy + oy - dy * half], p1 = [cx + ox + dx * half, cy + oy + dy * half];
    // clipped to the box by shaving to its bounds (an axis-aligned clip of a slanted line)
    const clip = (p) => [Math.min(Math.max(p[0], x), x + w), Math.min(Math.max(p[1], y), y + h)];
    p0 = clip(p0); p1 = clip(p1);
    if (Math.abs(p0[0] - p1[0]) < 0.5 && Math.abs(p0[0] - (x + w / 2)) > w / 2 - 1) continue;
    const j = R(seed, Math.round(d * 100)) * gap * 0.35;
    out.push({ v: [[r2(p0[0] + dy * j), r2(p0[1] - dx * j)], [r2(p1[0] + dy * j), r2(p1[1] - dx * j)]], closed: false });
  }
  return out;
}

// ── the boil ─────────────────────────────────────────────────
const boil = {
  type: 'fx.boil', title: 'Boil', category: 'Hand',
  description: 'the layer redrawn a little off every few frames, like a line drawn by hand on camera',
  stage: 'layer',
  ai: { when: 'a film in the sketchbook look: on the layers that draw (shapes, strokes, annotations), so the lines tremble like pencil; a little goes a long way', avoid: 'on text or on footage (it reads as a bad projector), an amount over 3 px, and on more than the hero layers of a scene' },
  props: {
    amount: { type: 'number', default: 1.5, min: 0, max: 6, step: 0.1, unit: 'px', label: 'Amount' },
    every: { type: 'integer', default: 2, min: 1, max: 6, label: 'Every', description: 'the redraw holds for this many frames, then moves' },
    fps: { type: 'number', default: 30, min: 1, label: 'Frame rate', description: 'the composition\'s, to hold the boil to whole frames' },
    seed: { type: 'integer', default: 0, min: 0, label: 'Seed' },
  },
  gl: {
    code: `
      float bhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed * 17.31) * 43758.5453); }
      float bnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(bhash(i), bhash(i + vec2(1.0, 0.0)), u.x), mix(bhash(i + vec2(0.0, 1.0)), bhash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      vec4 effect(vec2 uv) {
        float hold = u_every / max(1.0, u_fps);
        float tick = floor(uTime / max(0.001, hold));
        vec2 amp = u_amount * uScale / uRes;
        vec2 off = vec2(bnoise(vec2(tick * 3.71, u_seed + 1.0)), bnoise(vec2(u_seed + 9.13, tick * 3.71))) - 0.5;
        return texture(uImage, clamp(uv + off * 2.0 * amp, vec2(0.0), vec2(1.0)));
      }
    `,
  },
};

// ── the twos ─────────────────────────────────────────────────
const twos = {
  type: 'twos', title: 'Twos', description: 'any value held for n frames, a small seeded jitter at each change: stop motion and cut-out paper',
  ai: { when: 'a stop-motion or paper feel: on the positions of a cut-out, on a bounce, on anything that should move the way hand-drawn animation moves', avoid: 'on type (it shivers instead of settling), on slow drifts (the holds read as stalls), over n of 3' },
  params: {
    n: { type: 'integer', default: 2, min: 1, max: 6, label: 'Hold' },
    jitter: { type: 'number', default: 0.6, min: 0, max: 8, step: 0.1, unit: 'px', label: 'Jitter' },
  },
  apply(value, p, ctx) {
    const n = Math.max(1, Math.round(p.n ?? 2));
    const f = Math.round(ctx.t * (ctx.fps || 30));
    const block = Math.floor(f / n) * n;
    const v = ctx.base(block / (ctx.fps || 30));
    const amt = p.jitter ?? 0.6;
    if (!amt || !Number.isFinite(amt)) return v;
    const [dx, dy] = jitter(ctx.seed, block, amt);
    // the jitter is in px on a position; on a factor (a scale, an opacity: every value within 4) it is a hundredth of that
    const k = (xs) => (xs.every((x) => Math.abs(x) <= 4) ? 0.01 : 1);
    if (typeof v === 'number') return v + dx * k([v]);
    if (Array.isArray(v) && v.every((x) => typeof x === 'number')) { const f = k(v); return v.map((x, i) => x + (i % 2 === 0 ? dx : dy) * f); }
    return v;
  },
};

// ── the sketch node ──────────────────────────────────────────
function drawSmooth(ctx, pts, upTo) {
  // the polyline smoothed through the midpoints of its segments, drawn to a share of its length
  if (pts.length < 2) return;
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lens[lens.length - 1] || 1;
  const stop = total * upTo;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    if (lens[i] <= stop) { ctx.lineTo(pts[i][0], pts[i][1]); continue; }
    const u = (stop - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
    ctx.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u);
    break;
  }
  ctx.stroke();
}

const sketchShape = {
  type: 'sketch.shape', title: 'Sketch', category: 'Hand',
  description: 'a rough line, arrow, rectangle, ellipse or bracket, drawn as two passes that overshoot their corners, revealing with progress',
  ai: { when: 'the marks an explainer draws around its point: a circle on the key number, an arrow from cause to effect, a bracket gathering a list; in the sketchbook kit\'s colours', avoid: 'more than three marks on screen, marks as decoration around everything, a sketch look on a corporate film that never asked for one' },
  props: {
    kind: { type: 'enum', default: 'ellipse', options: ['line', 'arrow', 'rect', 'ellipse', 'bracket'], label: 'Shape', animatable: false },
    w: { type: 'number', default: 300, min: 2, unit: 'px', label: 'Width' },
    h: { type: 'number', default: 160, min: 2, unit: 'px', label: 'Height' },
    fill: { type: 'enum', default: 'none', options: ['none', 'hachure'], label: 'Fill', animatable: false },
    angle: { type: 'number', default: -41, min: -180, max: 180, unit: '°', label: 'Hachure angle' },
    gap: { type: 'number', default: 8, min: 2, unit: 'px', label: 'Hachure gap' },
    seed: { type: 'integer', default: 1, min: 0, label: 'Seed', description: 'another seed, another hand' },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: 'the marks draw themselves on' },
    stroke: { type: 'paint', default: '@text', label: 'Stroke' },
    strokeWidth: { type: 'number', default: 4, min: 0.5, unit: 'px', label: 'Stroke width' },
    fillPaint: { type: 'paint', default: '@accent', label: 'Fill colour' },
  },
  bounds: (p) => ({ x: -p.w / 2 - 6, y: -p.h / 2 - 6, w: p.w + 12, h: p.h + 12 }),
  render: {
    canvas2d(ctx, p) {
      const box = { x: -p.w / 2, y: -p.h / 2, w: p.w, h: p.h };
      const strokes = p.fill === 'hachure' ? hachure(box, p.angle, p.gap, p.seed + 13) : [];
      const contours = roughPath(p.kind, box, p.seed);
      // the marks draw on in order, the fill under the strokes
      const lines = [...strokes, ...contours];
      const counts = lines.map((c) => c.v.length);
      const total = counts.reduce((a, b) => a + b, 0) || 1;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      let budget = p.progress * total;
      lines.forEach((c, k) => {
        if (budget <= 0) return;
        ctx.strokeStyle = k < strokes.length ? p.fillPaint : p.stroke;
        ctx.lineWidth = k < strokes.length ? p.strokeWidth * 1.1 : p.strokeWidth;
        if (k < strokes.length) ctx.globalAlpha = 0.8;
        drawSmooth(ctx, c.v, Math.min(1, budget / counts[k]));
        ctx.globalAlpha = 1;
        budget -= counts[k];
      });
    },
  },
};

// ── the annotate tool ────────────────────────────────────────
/** a property's value at t: its key at or before t when it is keyed, else itself */
function keyedAt(prop, t) {
  const k = prop?.$k;
  if (!Array.isArray(k) || !k.length) return prop;
  let v = k[0].v;
  for (const key of k) if (key.t <= (t ?? 0) + 1e-6) v = key.v;
  return v;
}

/** the value of a position at t: its key at or before, else its static value, else the frame's centre */
function positionAt(transform, comp, t) {
  const v = keyedAt(transform?.position, t);
  return Array.isArray(v) ? v : [comp.width / 2, comp.height / 2];
}

/** the box of a layer, from its own props and its node's bounds (a text's box estimated as the checks do) */
function boxOf(ctx, layerId, t) {
  const comp = ctx.doc.compositions[ctx.compId];
  const layer = comp.layers[layerId];
  if (!layer) return null;
  const node = ctx.registry.node(layer.type);
  const host = {
    layerId, t: t ?? 0, frame: Math.round((t ?? 0) * comp.fps), fps: comp.fps, width: comp.width, height: comp.height, duration: comp.duration,
    asset: (id) => (ctx.doc.assets[id]?.type === 'font' ? ctx.doc.assets[id].family || id : null),
    assetInfo: (id) => ctx.doc.assets[id], assetUrl: (id) => ctx.doc.assets[id]?.src ?? '',
  };
  let r = null;
  // the props as they stand at t: a keyed one read at its key at or before t
  const props = Object.fromEntries(Object.entries(layer.props ?? {}).map(([k, v]) => [k, keyedAt(v, t)]));
  const defaults = Object.fromEntries(Object.entries(node?.props ?? {}).map(([k, d]) => [k, d.default]));
  try { r = node?.bounds?.({ ...defaults, ...props }, host) ?? null; } catch { r = null; }
  if (!r && layer.type === 'text') {
    const size = Number(layer.props?.size) || 64, lines = String(layer.props?.text ?? '').split('\n');
    const w = Math.max(...lines.map((l) => l.length)) * size * 0.56, h = size * (1 + (lines.length - 1) * (Number(layer.props?.lineHeight) || 1.2));
    const x = layer.props?.align === 'center' ? -w / 2 : layer.props?.align === 'right' ? -w : 0;
    const y = layer.props?.baseline === 'top' ? 0 : layer.props?.baseline === 'middle' ? -size / 2 : -size * 0.8;
    r = { x, y, w, h };
  }
  if (!r) return null;
  const pos = positionAt(layer.transform, comp, t), s = keyedAt(layer.transform?.scale, t);
  const sx = Array.isArray(s) ? s[0] : 1, sy = Array.isArray(s) ? s[1] : 1;
  return { x: pos[0] + r.x * sx, y: pos[1] + r.y * sy, w: r.w * sx, h: r.h * sy };
}

/** the annotation drawn around a box, by kind */
function planOf(kind, box, inset) {
  const g = Math.max(6, Math.min(box.w, box.h) * inset);
  switch (kind) {
    case 'circle': return { kind: 'ellipse', box: { x: box.x - g, y: box.y - g * 0.8, w: box.w + g * 2, h: box.h + g * 1.6 } };
    case 'box': return { kind: 'rect', box: { x: box.x - g * 0.6, y: box.y - g * 0.6, w: box.w + g * 1.2, h: box.h + g * 1.2 } };
    case 'underline': return { kind: 'line', box: { x: box.x, y: box.y + box.h + g * 0.5, w: box.w, h: 0 } };
    case 'strike': return { kind: 'line', box: { x: box.x - g * 0.2, y: box.y + box.h / 2, w: box.w + g * 0.4, h: 0 } };
    case 'bracket': return { kind: 'bracket', box: { x: box.x - g * 1.4, y: box.y - g * 0.4, w: g * 1.2, h: box.h + g * 0.8 } };
    default: return { kind: 'rect', box: { x: box.x - g * 0.25, y: box.y - g * 0.1, w: box.w + g * 0.5, h: box.h + g * 0.2 }, fill: 'hachure', gap: Math.max(4, Math.min(box.w, box.h) * 0.09) };
  }
}

const annotate = {
  name: 'annotate', title: 'Annotate a layer',
  description: 'a rough circle, underline, box, highlight, strike or bracket around a layer, drawn on a beat after it lands, following it when it moves',
  input: {
    type: 'object',
    properties: {
      kind: { enum: ['circle', 'underline', 'box', 'highlight', 'strike', 'bracket'], title: 'Annotation', description: 'circle around, underline under, box around, highlight over, strike through, bracket at the left' },
      layer: { type: 'string', format: 'layer', title: 'Layer', description: 'the layer to annotate; the selected one, or the only one' },
      inset: { type: 'number', title: 'Inset', description: 'how far the mark sits from the layer, as a share of its size (0.12 by default)' },
      seed: { type: 'integer', title: 'Seed', description: 'another hand, another seed' },
      color: { type: 'string', title: 'Colour', description: 'a token reference (@accent) or a colour; the accent by default' },
    },
    required: ['kind'],
  },
  ai: { when: 'the one thing that matters on screen gets its mark, a beat after it lands: a circle on the number, an underline on the sentence, a bracket gathering the list', avoid: 'annotating every layer (the marks argue with each other), a mark on a layer that rotates or scales as it moves (the mark follows the position, not the spin), marks without a beat of air after the layer lands' },
  async run(a, ctx) {
    const comp = ctx.doc.compositions[ctx.compId];
    const layers = Object.entries(comp.layers);
    const id = a.layer && comp.layers[a.layer] ? a.layer : ctx.selection.find((s) => comp.layers[s]) ?? (layers.length === 1 ? layers[0][0] : null);
    if (!id) throw new Error('say which layer to annotate, or select it');
    const target = comp.layers[id];
    const t0 = ctx.time ?? 0;
    const box = boxOf(ctx, id, Math.max(t0, target.in ?? 0));
    if (!box) throw new Error(`the layer "${target.name ?? id}" has no box to annotate`);
    const inset = a.inset ?? 0.12;
    const plan = planOf(a.kind, box, inset);
    const tokens = ctx.doc.tokens ?? {};
    const colorOf = (name, fallback) => (tokens[name]?.type === 'color' ? `@${name}` : fallback);
    const accent = typeof a.color === 'string' && a.color ? a.color : colorOf('accent', '#2EC4B6');
    // the mark drawn on a beat after the layer lands, on the kit's draw-on
    const at = +Math.max(0, (target.in ?? 0) + 0.25).toFixed(3);
    const draw = 0.55;
    // the mark follows the layer: its keys are the layer's, one offset away
    const centre = { x: plan.box.x + plan.box.w / 2, y: plan.box.y + plan.box.h / 2 };
    const off = { x: centre.x - box.x - box.w / 2, y: centre.y - box.y - box.h / 2 };
    const posKeys = target.transform?.position?.$k;
    const position = Array.isArray(posKeys) && posKeys.length
      ? { $k: posKeys.map((k) => ({ t: k.t, v: [+((k.v?.[0] ?? 0) + off.x).toFixed(2), +((k.v?.[1] ?? 0) + off.y).toFixed(2)] })) }
      : [centre.x, centre.y];
    const nid = `annotate-${id}-${a.kind}`;
    const ops = [{ op: 'add', path: `/compositions/${ctx.compId}/layers/${nid}`, value: {
      type: 'sketch.shape', name: `${a.kind} on ${target.name ?? id}`, in: at, out: target.out ?? comp.duration,
      transform: { position },
      props: {
        kind: plan.kind, w: Math.round(plan.box.w), h: Math.round(plan.box.h), seed: a.seed ?? 1,
        ...(plan.fill ? { fill: plan.fill, gap: plan.gap } : {}),
        stroke: accent, fillPaint: accent,
        progress: { $k: [{ t: at, v: 0, ease: tokens.enter?.type === 'ease' ? '@enter' : [0.16, 1, 0.3, 1] }, { t: +(at + draw).toFixed(3), v: 1 }] },
      },
    } }];
    if (!(comp.order ?? []).includes(nid)) ops.push({ op: 'add', path: `/compositions/${ctx.compId}/order/-`, value: nid });
    return {
      ops, label: `${a.kind} on ${target.name ?? id}`,
      text: `A ${a.kind} around "${target.name ?? id}" (${Math.round(plan.box.w)}×${Math.round(plan.box.h)} at ${Math.round(centre.x)}, ${Math.round(centre.y)}), drawing on at ${at} s over ${draw} s in the accent. It follows the layer's position keys; its rough passes and its seed are editable in the inspector.`,
    };
  },
};

// ── the module ───────────────────────────────────────────────

export const meta = { id: 'tramme/handmade', name: 'handmade', version: '1.0.0', description: 'Made by hand: strokes that boil, motion on twos, rough sketches and annotations drawn around what matters', api: 1 };
export const effects = [boil];
export const modifiers = [twos];
export const nodes = [sketchShape];
export const tools = [annotate];
export const kits = [{
  name: 'sketchbook', title: 'Sketchbook', description: 'a paper plate, a graphite ink, a hand-red accent and slower curves: the made-by-hand look',
  tokens: {
    plate: { type: 'color', value: '#F6F1E6' },
    ink: { type: 'color', value: '#3A3530' },
    text: { type: 'color', value: '#3A3530' },
    background: { type: 'color', value: '#F6F1E6' },
    accent: { type: 'color', value: '#C2503C' },
    accent2: { type: 'color', value: '#3E6B8A' },
    enter: { type: 'ease', value: [0.33, 0, 0.2, 1] },
    pace: { type: 'ease', value: [0.42, 0, 0.25, 1] },
  },
}];
export const messages = {
  fr: {
    'Boil': 'Tremblé', 'Twos': 'Par deux', 'Sketch': 'Croquis', 'Annotate a layer': 'Annoter une couche', 'Sketchbook': 'Carnet de croquis',
    'Amount': 'Ampleur', 'Every': 'Toutes les', 'Frame rate': 'Images par seconde', 'Seed': 'Graine',
    'Hold': 'Tenue', 'Jitter': 'Frémissement',
    'Shape': 'Forme', 'Width': 'Largeur', 'Height': 'Hauteur', 'Fill': 'Remplissage', 'Hachure angle': 'Angle des hachures', 'Hachure gap': 'Écart des hachures',
    'Progress': 'Progression', 'Stroke': 'Trait', 'Stroke width': 'Épaisseur du trait', 'Fill colour': 'Couleur du remplissage',
    'Annotation': 'Annotation', 'Layer': 'Couche', 'Inset': 'Écart', 'Colour': 'Couleur',
    'the layer redrawn a little off every few frames, like a line drawn by hand on camera': 'la couche redessinée un peu à côté toutes les quelques images, comme un trait passé sous la caméra',
    'the composition\'s, to hold the boil to whole frames': 'celle de la composition, pour tenir le tremblé à des images entières',
    'the redraw holds for this many frames, then moves': 'le redessin tient ce nombre d’images, puis bouge',
    'any value held for n frames, a small seeded jitter at each change: stop motion and cut-out paper': 'toute valeur tenue n images, un léger frémissement semé à chaque changement : animation en volume et papier découpé',
    'a rough line, arrow, rectangle, ellipse or bracket, drawn as two passes that overshoot their corners, revealing with progress': 'un trait, une flèche, un rectangle, une ellipse ou un crochet dessinés à main levée, deux passes qui débordent des coins, révélés par la progression',
    'the marks an explainer draws around its point: a circle on the key number, an arrow from cause to effect, a bracket gathering a list; in the sketchbook kit\'s colours': 'les marques qu’un explicateur dessine autour de son propos : un cercle sur le chiffre clé, une flèche de la cause à l’effet, un crochet qui rassemble une liste ; dans les couleurs de la trousse carnet',
    'more than three marks on screen, marks as decoration around everything, a sketch look on a corporate film that never asked for one': 'plus de trois marques à l’écran, des marques par décoration autour de tout, un look croquis sur un film d’entreprise qui ne l’a pas demandé',
    'a film in the sketchbook look: on the layers that draw (shapes, strokes, annotations), so the lines tremble like pencil; a little goes a long way': 'un film au look carnet : sur les couches qui se tracent (formes, traits, annotations), pour que les lignes tremblent comme au crayon ; peu suffit',
    'on text or on footage (it reads as a bad projector), an amount over 3 px, and on more than the hero layers of a scene': 'sur du texte ou des rushes (on croit à un mauvais projecteur), une ampleur au-delà de 3 px, et sur plus que les couches fortes d’une scène',
    'a stop-motion or paper feel: on the positions of a cut-out, on a bounce, on anything that should move the way hand-drawn animation moves': 'un feel volume ou papier : sur les positions d’un personnage découpé, sur un rebond, sur tout ce qui doit bouger comme l’animation dessinée',
    'on type (it shivers instead of settling), on slow drifts (the holds read as stalls), over n of 3': 'sur du texte (il frissonne au lieu de se poser), sur des dérives lentes (les tenues se lisent comme des arrêts), au-delà de n = 3',
    'a rough circle, underline, box, highlight, strike or bracket around a layer, drawn on a beat after it lands, following it when it moves': 'un cercle, un souligné, un cadre, un surlignage, une rature ou un crochet dessinés autour d’une couche, tracés un temps après qu’elle est posée, qui la suivent quand elle bouge',
    'circle around, underline under, box around, highlight over, strike through, bracket at the left': 'cercle autour, souligné dessous, cadre autour, surlignage par-dessus, rature en travers, crochet à gauche',
    'the layer to annotate; the selected one, or the only one': 'la couche à annoter ; la sélection, ou la seule',
    'how far the mark sits from the layer, as a share of its size (0.12 by default)': 'à quelle distance la marque tient de la couche, en part de sa taille (0,12 par défaut)',
    'another hand, another seed': 'une autre main, une autre graine',
    'another seed, another hand': 'une autre graine, une autre main',
    'the marks draw themselves on': 'les marques se tracent seules',
    'a token reference (@accent) or a colour; the accent by default': 'une référence de token (@accent) ou une couleur ; l’accent par défaut',
    'the one thing that matters on screen gets its mark, a beat after it lands: a circle on the number, an underline on the sentence, a bracket gathering the list': 'la seule chose qui compte à l’écran reçoit sa marque, un temps après qu’elle est posée : un cercle sur le chiffre, un souligné sur la phrase, un crochet qui rassemble la liste',
    'annotating every layer (the marks argue with each other), a mark on a layer that rotates or scales as it moves (the mark follows the position, not the spin), marks without a beat of air after the layer lands': 'annoter chaque couche (les marques se disputent), une marque sur une couche qui tourne ou change d’échelle en bougeant (la marque suit la position, pas la rotation), des marques sans un temps d’air après la pose de la couche',
    'a paper plate, a graphite ink, a hand-red accent and slower curves: the made-by-hand look': 'un fond papier, une encre graphite, un rouge à la main et des courbes plus lentes : le look fait main',
  },
};
