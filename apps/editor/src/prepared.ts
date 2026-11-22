// Prepared passages: the frames of the preview too heavy to play live, drawn
// ahead while nothing moves and played back as pictures (the smart cache of
// the big editors). Which frames: where two videos or more show at once
// (cross-fades, overlapping shots), and every frame a playback drew late (a
// video frame not decoded in time, an effect slower than the frame's span).
//
// A prepared frame is good as long as what it shows is unchanged: its key
// reads the layers present at that moment, the layers they name (parents,
// mattes, layer inputs, expressions), the other compositions, the assets and
// the plugins. An edit elsewhere in the film leaves it prepared; an edit there
// prepares it again. Pictures are kept at the preview's size while it plays,
// within a memory budget.

import type { Layer, TrammeDoc } from '@tramme/core';

/** 32-bit FNV-1a, twice (two seeds): a key short enough to compare at every frame */
function fnv(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
export const digest = (text: string) => fnv(text, 0x811c9dc5).toString(36) + fnv(text, 0x9747b28c).toString(36);

const layerDigests = new WeakMap<Layer, string>();
const layerDigest = (layer: Layer) => {
  let d = layerDigests.get(layer);
  if (d === undefined) { d = digest(JSON.stringify(layer)); layerDigests.set(layer, d); }
  return d;
};

interface CompFacts {
  /** everything the frame reads besides the layers of this composition */
  rest: string;
  /** each layer and the layers it names, transitively (itself included) */
  reach: Map<string, string[]>;
}
const facts = new WeakMap<TrammeDoc, Map<string, CompFacts>>();

function factsOf(doc: TrammeDoc, compId: string): CompFacts {
  let byComp = facts.get(doc);
  if (!byComp) { byComp = new Map(); facts.set(doc, byComp); }
  let f = byComp.get(compId);
  if (f) return f;
  const comp = doc.compositions[compId];
  const { layers, ...settings } = comp;
  const others = Object.entries(doc.compositions).filter(([id]) => id !== compId).map(([id, c]) => [id, c]);
  const rest = digest(JSON.stringify([settings, others, doc.assets, doc.plugins ?? []]));
  // a layer names another by its id or its name, anywhere in its text (props, expressions, parent)
  const ids = Object.keys(layers);
  const named = new Map<string, string[]>();
  for (const id of ids) {
    const text = JSON.stringify(layers[id]);
    named.set(id, ids.filter((other) => other !== id && (text.includes(JSON.stringify(other)) || (!!layers[other].name && text.includes(JSON.stringify(layers[other].name))))));
  }
  const reach = new Map<string, string[]>();
  for (const id of ids) {
    const seen = new Set([id]), todo = [id];
    for (let x = todo.pop(); x !== undefined; x = todo.pop()) for (const y of named.get(x) ?? []) if (!seen.has(y)) { seen.add(y); todo.push(y); }
    reach.set(id, [...seen].sort());
  }
  f = { rest, reach };
  byComp.set(compId, f);
  return f;
}

/** what frame `frame` of the composition shows, as a short key: equal keys, equal pictures */
export function frameKey(doc: TrammeDoc, compId: string, frame: number): string {
  const comp = doc.compositions[compId];
  if (!comp) return '';
  const { rest, reach } = factsOf(doc, compId);
  const t = frame / comp.fps;
  const shown = new Set<string>();
  for (const [id, l] of Object.entries(comp.layers)) {
    if ((l.in ?? 0) <= t && t < (l.out ?? comp.duration)) for (const r of reach.get(id) ?? [id]) shown.add(r);
  }
  return digest([rest, frame, ...[...shown].sort().map((id) => `${id}:${layerDigest(comp.layers[id])}`)].join('|'));
}

/** the frames where two visible videos or more show at once, in order */
export function overlapFrames(doc: TrammeDoc, compId: string): number[] {
  const comp = doc.compositions[compId];
  if (!comp) return [];
  const spans = Object.values(comp.layers)
    .filter((l) => l.type === 'video' && l.visible !== false && l.props?.video)
    .map((l) => [Math.max(0, l.in ?? 0), Math.min(comp.duration, l.out ?? comp.duration)] as const)
    .filter(([a, b]) => b > a);
  const out: number[] = [];
  const last = Math.ceil(comp.duration * comp.fps);
  for (let f = 0; f < last; f++) {
    const t = f / comp.fps;
    let n = 0;
    for (const [a, b] of spans) if (a <= t && t < b && ++n >= 2) break;
    if (n >= 2) out.push(f);
  }
  return out;
}

/** frames to prepare, nearest the playhead first and those ahead of it before those behind */
export function prepareOrder(frames: Iterable<number>, from: number): number[] {
  return [...new Set(frames)].sort((a, b) => {
    const da = a >= from ? a - from : 1e9 + from - a, db = b >= from ? b - from : 1e9 + from - b;
    return da - db;
  });
}

interface Prepared { key: string; scale: number; picture: ImageBitmap; bytes: number }

/** the memory the prepared pictures may hold: a sixteenth of the machine's, between 192 and 768 MB */
export function preparedBudget(deviceGb = (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory ?? 4): number {
  return Math.min(768, Math.max(192, (deviceGb * 1024) / 16)) * 1024 * 1024;
}

/** the prepared pictures of one composition, by frame */
export class PreparedFrames {
  private frames = new Map<string, Map<number, Prepared>>();
  private bytes = 0;
  /** frames a playback drew late, by composition */
  private late = new Map<string, Set<number>>();
  readonly budget: number;
  constructor(budget = preparedBudget()) { this.budget = budget; }

  /** the picture of `frame` when it is prepared for what the document shows there, at this size */
  get(doc: TrammeDoc, compId: string, frame: number, scale: number): ImageBitmap | null {
    const p = this.frames.get(compId)?.get(frame);
    return p && Math.abs(p.scale - scale) < 1e-6 && p.key === frameKey(doc, compId, frame) ? p.picture : null;
  }

  /** prepared up to how many frames ahead of `frame` (0: this one is not) */
  ahead(doc: TrammeDoc, compId: string, frame: number, scale: number, limit: number): number {
    let n = 0;
    while (n < limit && this.get(doc, compId, frame + n, scale)) n++;
    return n;
  }

  /** room for one more picture of this many bytes */
  hasRoom(bytes: number) { return this.bytes + bytes <= this.budget; }

  put(compId: string, frame: number, key: string, scale: number, picture: ImageBitmap) {
    let m = this.frames.get(compId);
    if (!m) { m = new Map(); this.frames.set(compId, m); }
    const old = m.get(frame);
    if (old) { this.bytes -= old.bytes; old.picture.close(); }
    const bytes = picture.width * picture.height * 4;
    m.set(frame, { key, scale, picture, bytes });
    this.bytes += bytes;
  }

  /** prepared and still good: nothing to draw again */
  holds(doc: TrammeDoc, compId: string, frame: number, scale: number) { return !!this.get(doc, compId, frame, scale); }

  /** pictures that no longer match the document or the size let go, making room */
  prune(doc: TrammeDoc, scale: number) {
    for (const [compId, m] of this.frames) for (const [frame, p] of m) {
      if (!doc.compositions[compId] || Math.abs(p.scale - scale) > 1e-6 || p.key !== frameKey(doc, compId, frame)) { p.picture.close(); this.bytes -= p.bytes; m.delete(frame); }
    }
  }

  noteLate(compId: string, frame: number) {
    let s = this.late.get(compId);
    if (!s) { s = new Set(); this.late.set(compId, s); }
    if (s.size < 20_000) s.add(frame);
  }

  lateFrames(compId: string): Iterable<number> { return this.late.get(compId) ?? []; }

  clear() {
    for (const m of this.frames.values()) for (const p of m.values()) p.picture.close();
    this.frames.clear(); this.late.clear(); this.bytes = 0;
  }

  get used() { return this.bytes; }
}
