// The reading of a Lottie given as a reference: its making read exactly from
// its layers and keyframes, without a model. Scenes are its precomps laid one
// after the other, or the moments most of its layers change; each layer
// showing content is a slot (its box at the scene's start, its entrance from
// its first keyframes), the keyframes after the entrance are its moves, its
// fills are the palette and its fonts the type. What a Lottie cannot say (the
// kind of picture in the film plan's words) is a guess the user corrects.

import { hex } from './lottie-import.ts';
import { type Entrance, type Move, type MoveKind, type Reading, type ReadingScene, type Slot, type SlotRole } from '@tramme/core';

type L = Record<string, any>;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** a property's keyframes as [time (frames), value] pairs; one pair for a static value */
function keysOf(p: L | undefined): { t: number; v: number[] }[] {
  if (!p) return [];
  const k = p.k;
  const asList = (v: unknown) => (Array.isArray(v) ? (v as number[]) : [Number(v)]);
  const animated = p.a === 1 || (Array.isArray(k) && k.length > 0 && typeof k[0] === 'object' && k[0] !== null && 't' in k[0]);
  if (!animated) return [{ t: -Infinity, v: asList(k) }];
  const out: { t: number; v: number[] }[] = [];
  let prev: L | null = null;
  for (const key of k as L[]) {
    const s = key.s ?? prev?.e;
    if (s !== undefined) out.push({ t: key.t, v: asList(s) });
    prev = key;
  }
  return out;
}

/** a property's value at a frame (keys held between, no easing: enough for a box) */
function valueAt(p: L | undefined, frame: number, fallback: number[]): number[] {
  const keys = keysOf(p);
  if (!keys.length) return fallback;
  let v = keys[0].v;
  for (const k of keys) if (k.t <= frame) v = k.v;
  return v;
}

/** a colour of the file as #RRGGBB: channels 0..1, or 0..255 in older files */
const hexOf = (c: number[]) => hex(c.slice(0, 3).map((x) => (x > 1 ? x / 255 : x)));

/** the colours a layer fills with: solids, shape fills and text colours */
function coloursOf(layer: L, out: Map<string, number>, weight: number) {
  const add = (c: unknown) => { if (Array.isArray(c) && c.length >= 3 && c.every((x) => typeof x === 'number')) { const h = hexOf(c as number[]); out.set(h, (out.get(h) ?? 0) + weight); } };
  if (layer.ty === 1 && typeof layer.sc === 'string') { const h = layer.sc.toUpperCase(); if (/^#[0-9A-F]{6}$/.test(h)) out.set(h, (out.get(h) ?? 0) + weight * 2); }
  const walk = (items: L[] | undefined) => { for (const it of items ?? []) { if (it.ty === 'fl' || it.ty === 'st') add(keysOf(it.c)[0]?.v); if (it.ty === 'gr') walk(it.it); } };
  walk(layer.shapes);
  for (const d of layer.t?.d?.k ?? []) add(d.s?.fc);
}

/** the size of a shape layer: the largest rectangle or ellipse it draws, else a guess */
function shapeSize(layer: L): [number, number] | null {
  let best: [number, number] | null = null;
  const walk = (items: L[] | undefined) => {
    for (const it of items ?? []) {
      if (it.ty === 'rc' || it.ty === 'el') { const s = keysOf(it.s)[0]?.v; if (s && s.length >= 2 && (!best || s[0] * s[1] > best[0] * best[1])) best = [s[0], s[1]]; }
      if (it.ty === 'gr') walk(it.it);
    }
  };
  walk(layer.shapes);
  return best;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const textOf = (layer: L): string => String(layer.t?.d?.k?.[0]?.s?.t ?? '').replace(/\r/g, ' ').trim();

/** what a layer shows, as a slot's role; null for what is no content (a null, a full-frame solid, a matte) */
function roleOf(layer: L, w: number, h: number): SlotRole | null {
  const name = String(layer.nm ?? '');
  if (layer.td) return null;
  if (/logo|brand|mark/i.test(name)) return 'logo';
  switch (layer.ty) {
    case 5: { const size = Number(layer.t?.d?.k?.[0]?.s?.s ?? 0); return size >= h * 0.06 ? 'headline' : 'text'; }
    case 2: return /screen|ui|app/i.test(name) ? 'screenshot' : 'photo';
    case 1: return (layer.sw ?? 0) >= w * 0.95 && (layer.sh ?? 0) >= h * 0.95 ? null : 'shape';
    case 0: return 'figure';
    case 4: return 'shape';
    default: return null;
  }
}

/** a layer's box in 0..1 of the frame at a frame: its position, anchor and scale over its size */
function boxOf(layer: L, frame: number, w: number, h: number, size: [number, number]): Slot['box'] {
  const ks = layer.ks ?? {};
  const [px, py] = valueAt(ks.p, frame, [w / 2, h / 2]), [ax, ay] = valueAt(ks.a, frame, [0, 0]), [sx = 100, sy = 100] = valueAt(ks.s, frame, [100, 100]);
  const kx = Math.abs(sx) / 100, ky = Math.abs(sy) / 100;
  // a shape's or a text's anchor is its centre by default; a sized layer's is its top left
  const centred = layer.ty === 4 || layer.ty === 5;
  const x0 = centred ? px - ax * kx - (size[0] * kx) / 2 : px - ax * kx, y0 = centred ? py - ay * ky - (size[1] * ky) / 2 : py - ay * ky;
  const bw = (size[0] * kx) / w, bh = (size[1] * ky) / h;
  return [r3(clamp01(x0 / w)), r3(clamp01(y0 / h)), r3(clamp01(bw)), r3(clamp01(bh))];
}

/** how a layer comes on screen, read from its keyframes in the second after its in-point */
function entranceOf(layer: L, fps: number): Entrance {
  const ks = layer.ks ?? {}, from = layer.ip ?? 0, until = from + fps;
  const early = (p: L | undefined) => keysOf(p).filter((k) => k.t >= from - 1 && k.t <= until);
  const span = (p: L | undefined, i: number) => { const k = early(p); return k.length >= 2 ? k.at(-1)!.v[i] - k[0].v[i] : 0; };
  if (layer.ty === 5 && (layer.t?.a ?? []).length) return 'type-on';
  if (layer.masksProperties?.some((m: L) => keysOf(m.pt).length > 1)) return 'mask';
  const scaleKeys = early(ks.s);
  if (scaleKeys.length >= 2 && scaleKeys[0].v[0] < 80) return scaleKeys.some((k) => k.v[0] > 102) ? 'pop' : 'scale';
  const dy = span(ks.p, 1), dx = span(ks.p, 0);
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 4) return dy < 0 ? 'rise' : 'fall';
  if (Math.abs(dx) > 4) return 'slide';
  if (early(ks.o).length >= 2 && early(ks.o)[0].v[0] < 50) return 'fade';
  return 'none';
}

/** what a layer does after its entrance, within a scene: its moves */
function movesOf(layer: L, subject: string, scene: { from: number; to: number }, fps: number): Move[] {
  // the camera has no entrance: all its keyframes in the scene are moves; a slot's begin after its entrance
  const ks = layer.ks ?? {}, settled = subject === 'camera' ? scene.from : (layer.ip ?? 0) + fps, out: Move[] = [];
  const later = (p: L | undefined) => keysOf(p).filter((k) => k.t >= Math.max(settled, scene.from) && k.t <= scene.to);
  const add = (kind: MoveKind, keys: { t: number }[], direction?: Move['direction']) => {
    if (keys.length < 2) return;
    out.push({ subject, kind, start: r3((keys[0].t - scene.from) / fps), end: r3((keys.at(-1)!.t - scene.from) / fps), ...(direction ? { direction } : {}) });
  };
  const s = later(ks.s);
  if (s.length >= 2 && Math.abs(s.at(-1)!.v[0] - s[0].v[0]) > 2) add(s.at(-1)!.v[0] > s[0].v[0] ? 'push-in' : 'pull-out', s, s.at(-1)!.v[0] > s[0].v[0] ? 'in' : 'out');
  const p = later(ks.p);
  if (p.length >= 2) {
    const dx = p.at(-1)!.v[0] - p[0].v[0], dy = p.at(-1)!.v[1] - p[0].v[1];
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) add(Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'rise' : 'fall') : 'slide', p, Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'up' : 'down') : dx < 0 ? 'left' : 'right');
  }
  const r = later(ks.r);
  if (r.length >= 2 && Math.abs(r.at(-1)!.v[0] - r[0].v[0]) > 2) add('rotate', r);
  // the scale of a slot is its push-in only for the camera; a slot's own scale is a scale
  return out.map((m) => (subject !== 'camera' && (m.kind === 'push-in' || m.kind === 'pull-out') ? { ...m, kind: 'scale' as const } : m));
}

/** the frames where the film changes scene: its precomps laid one after the other, else the in-points where most layers change */
function boundaries(layers: L[], ip: number, op: number): number[] {
  const top = layers.filter((l) => !l.td && l.ty !== 3);
  const pre = top.filter((l) => l.ty === 0).sort((a, b) => (a.ip ?? 0) - (b.ip ?? 0));
  // precomps that follow each other and cover most of the film: each is a scene
  if (pre.length >= 2 && pre.every((l, i) => i === 0 || Math.abs((l.ip ?? 0) - (pre[i - 1].op ?? 0)) <= 2)) return [...new Set(pre.slice(1).map((l) => l.ip as number))];
  const cuts: number[] = [];
  const starts = [...new Set(top.map((l) => l.ip ?? ip).filter((f: number) => f > ip + 2 && f < op - 2))].sort((a, b) => a - b);
  for (const f of starts) {
    const before = top.filter((l) => (l.ip ?? ip) < f - 1 && (l.op ?? op) > f - 3);
    const ending = before.filter((l) => Math.abs((l.op ?? op) - f) <= 2);
    if (before.length && ending.length * 2 >= before.length && (!cuts.length || f - cuts.at(-1)! > 6)) cuts.push(f);
  }
  return cuts;
}

const KIND_OF: Partial<Record<SlotRole, string>> = { headline: 'type', text: 'type', photo: 'photo', screenshot: 'interface', video: 'photo', logo: 'type', product: 'object', person: 'character', figure: 'object', shape: 'diagram' };

/** the reading of a Lottie, as the reference `source` named `name` */
export function readingFromLottie(json: L, source: string, name: string): Reading {
  const fps = Number(json.fr) || 30, ip = Number(json.ip) || 0, op = Number(json.op) || ip + fps, w = Number(json.w) || 1920, h = Number(json.h) || 1080;
  const layers: L[] = Array.isArray(json.layers) ? json.layers : [];
  const assets = new Map<string, L>((json.assets ?? []).map((a: L) => [a.id, a]));
  const cuts = boundaries(layers, ip, op), bounds = [ip, ...cuts, op];
  const colours = new Map<string, number>(), texts: string[] = [];
  for (const l of layers) coloursOf(l, colours, 1);
  for (const a of assets.values()) for (const l of a.layers ?? []) coloursOf(l, colours, 0.5);
  const seconds = (f: number) => r3((f - ip) / fps);

  const scenes: ReadingScene[] = bounds.slice(1).map((to, i) => {
    const from = bounds[i], slots: Slot[] = [], moves: Move[] = [];
    const visible = layers.filter((l) => (l.ip ?? ip) < to - 1 && (l.op ?? op) > from + 1).reverse();
    for (const l of visible) {
      const role = roleOf(l, w, h);
      if (l.ty === 3 && (l.ks?.s || l.ks?.p) && layers.some((c) => c.parent === l.ind)) moves.push(...movesOf(l, 'camera', { from, to }, fps).map((m) => (m.kind === 'slide' ? { ...m, kind: 'pan' as const } : m)));
      if (!role || slots.length >= 16) continue;
      const text = l.ty === 5 ? textOf(l) : '';
      if (text) texts.push(text);
      const size: [number, number] = l.ty === 2 ? [assets.get(l.refId)?.w ?? w / 3, assets.get(l.refId)?.h ?? h / 3]
        : l.ty === 1 ? [l.sw ?? w, l.sh ?? h]
          : l.ty === 0 ? [l.w ?? w, l.h ?? h]
            : l.ty === 5 ? [Math.min(w, text.length * Number(l.t?.d?.k?.[0]?.s?.s ?? 40) * 0.55), Number(l.t?.d?.k?.[0]?.s?.s ?? 40) * 1.2]
              : shapeSize(l) ?? [w / 5, h / 5];
      const id = `${role}${slots.filter((s) => s.role === role).length + 1}`;
      const start = Math.max(from, l.ip ?? ip);
      slots.push({ id, role, box: boxOf(l, start + 1, w, h, size), enter: (l.ip ?? ip) > from + 1 || entranceOf(l, fps) !== 'none' ? entranceOf(l, fps) : 'none', at: r3((start - from) / fps), ...(text ? { words: words(text) } : {}), ...(l.nm ? { note: String(l.nm).slice(0, 200) } : {}) });
      moves.push(...movesOf(l, id, { from, to }, fps));
    }
    const main = slots.find((s) => s.role !== 'shape' && s.role !== 'text') ?? slots[0];
    const kind = (main && KIND_OF[main.role]) ?? 'type';
    const typed = slots.filter((s) => s.role === 'headline' || s.role === 'text');
    const rhythm = visible.some((l) => l.ty === 5 && (l.t?.a ?? []).some((a: L) => a.s?.b === 3)) ? 'word-by-word' : visible.some((l) => l.ty === 5 && (l.t?.a ?? []).length) ? 'letter-by-letter' : typed.length > 1 && new Set(typed.map((s) => s.at)).size > 1 ? 'line-by-line' : typed.length ? 'held' : 'none';
    const what = slots.length ? `${slots.length} element(s): ${slots.slice(0, 6).map((s) => `${s.role} entering by ${s.enter}`).join(', ')}${moves.length ? `; ${moves.map((m) => `${m.subject} ${m.kind}`).slice(0, 4).join(', ')}` : ''}` : 'a ground alone';
    return { id: `s${i + 1}`, start: seconds(from), end: seconds(to), kind, what, slots, moves: moves.slice(0, 16), transition: 'cut', text: rhythm };
  });

  const fonts: L[] = json.fonts?.list ?? [];
  const font = fonts[0];
  const style = String(font?.fStyle ?? '');
  const weight = /black|heavy|extra ?bold/i.test(style) ? 'heavy' : /bold|semi/i.test(style) ? 'bold' : /medium/i.test(style) ? 'medium' : /light|thin/i.test(style) ? 'light' : font ? 'regular' : undefined;
  const upper = texts.length > 0 && texts.every((t) => t === t.toUpperCase());
  const palette = [...colours.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 8);
  const reading: Reading = {
    version: 1, kind: 'reference-reading', source, name, from: 'lottie', duration: seconds(op), width: w, height: h, scenes, palette,
    type: { description: font ? `${font.fFamily ?? font.fName}${style ? ` ${style}` : ''}${upper ? ', capitals' : ''}` : 'no text', ...(weight ? { weight } : {}), ...(texts.length ? { case: upper ? 'upper' : 'mixed' } : {}), ...(font ? { serif: /serif/i.test(String(font.fFamily)) && !/sans/i.test(String(font.fFamily)) } : {}) },
    texts: [...new Set(texts)].slice(0, 200),
  };
  return reading;
}
