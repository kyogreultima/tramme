// Layers in time, as pure functions of the document: the tree (parents,
// descendants), a property's address, what moves a layer in time (its in and
// out points, its keyframes, the source it plays), and the cut of a layer in
// two. The editor's timeline, the montage operations and the assistant all
// build their operations from these.

import { getAt, pointer, type Op } from './ops.ts';
import { propKind, staticValue } from './props.ts';
import { shiftProp } from './components.ts';
import type { Composition, Keyframe, KeyframedProp, Layer, Prop, TrammeDoc } from './types.ts';

export const snap = (t: number, fps: number) => Math.round(t * fps) / fps;

/** time written the way the timeline writes it: a millionth of a second */
export const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const r4 = (x: number) => +x.toFixed(4);

export function parentOf(comp: Composition, id: string): string | null {
  for (const [pid, l] of Object.entries(comp.layers)) if (l.children?.includes(id)) return pid;
  return null;
}

/** ids of a layer and all its descendants */
export function subtree(comp: Composition, id: string): string[] {
  const out = [id];
  for (const c of comp.layers[id]?.children || []) out.push(...subtree(comp, c));
  return out;
}

// ── properties ───────────────────────────────────────────────
/** 'size' -> props.size, 'transform.position' -> transform.position */
export function propPath(compId: string, id: string, name: string): string {
  return name.startsWith('transform.')
    ? pointer('compositions', compId, 'layers', id, 'transform', name.slice(10))
    : pointer('compositions', compId, 'layers', id, 'props', name);
}

export function rawProp(doc: TrammeDoc, compId: string, id: string, name: string): Prop | undefined {
  return getAt(doc, propPath(compId, id, name));
}

export function keysOf(p: Prop | undefined): Keyframe[] | null {
  return p !== undefined && propKind(p) === 'keyframes' ? (p as KeyframedProp).$k : null;
}

/** every animated property of a layer: [name, keys] (transform first) */
export function animatedProps(layer: Layer): [string, Keyframe[]][] {
  const out: [string, Keyframe[]][] = [];
  for (const [k, v] of Object.entries(layer.transform || {})) { const ks = keysOf(v as Prop); if (ks) out.push([`transform.${k}`, ks]); }
  for (const [k, v] of Object.entries(layer.props || {})) { const ks = keysOf(v as Prop); if (ks) out.push([k, ks]); }
  return out;
}

/** move a layer and its descendants in time: in/out and every keyframe */
export function shiftLayerOps(doc: TrammeDoc, compId: string, id: string, dt: number): Op[] {
  const comp = doc.compositions[compId];
  const ops: Op[] = [];
  for (const lid of subtree(comp, id)) {
    const l = comp.layers[lid];
    if (l.in !== undefined || lid === id) ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', lid, 'in'), value: round6(Math.max(0, (l.in ?? 0) + dt)) });
    if (l.out !== undefined || lid === id) ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', lid, 'out'), value: round6((l.out ?? comp.duration) + dt) });
    for (const [name] of animatedProps(l)) ops.push({ op: 'replace', path: propPath(compId, lid, name), value: shiftProp(rawProp(doc, compId, lid, name)!, dt) });
  }
  return ops;
}

/**
 * Where a layer's source starts once its in point moves by `din`, so what
 * plays stays where it was in time: a video goes further in its file, a sound
 * too at its rate, a composition further in its time at its speed. Null when
 * nothing carries (no source, a start animated or written as an expression, a
 * composition remapped).
 */
export function carriedStart(l: Layer, din: number): number | null {
  if (!din || !l.props) return null;
  const p = l.props, raw = staticValue(p.start);
  if (p.start !== undefined && typeof raw !== 'number') return null;
  const s0 = (raw as number | undefined) ?? 0;
  const factor = (v: unknown) => Number(staticValue(v) ?? 1) || 1;
  if (l.type === 'video') return Math.max(0, s0 + din * factor(p.rate));
  if (l.type === 'audio') return Math.max(0, s0 + din * factor(p.rate));
  if (l.type === 'comp' && (p.remap ?? null) === null) return s0 + din * factor(p.speed);
  return null;
}

/** the in point of a layer moved to `at`, what it plays staying in place (the head cut off, or brought back) */
export function trimInOps(doc: TrammeDoc, compId: string, id: string, at: number): Op[] {
  const l = doc.compositions[compId].layers[id], lp = pointer('compositions', compId, 'layers', id);
  const ops: Op[] = [{ op: 'add', path: `${lp}/in`, value: r4(at) }];
  const s = carriedStart(l, at - (l.in ?? 0));
  if (s !== null) ops.push({ op: 'add', path: `${lp}/props/start`, value: r4(s) });
  return ops;
}

/**
 * A layer cut in two at `at`: it ends there, and a copy of it plays on from
 * there to its old end (its source carried, its keyframes the same, just
 * above it in the stack). Null when `at` is not inside it, or for a group.
 */
export function splitLayerOps(doc: TrammeDoc, compId: string, id: string, at: number): { ops: Op[]; id: string } | null {
  const c = doc.compositions[compId], l = c.layers[id];
  if (!l || l.children) return null;
  const tin = l.in ?? 0, tout = l.out ?? c.duration;
  if (at <= tin || at >= tout) return null;
  const stem = id.replace(/-\d+$/, '');
  let n = 2;
  while (c.layers[`${stem}-${n}`]) n++;
  const nid = `${stem}-${n}`;
  const rest: Layer = { ...structuredClone(l), in: r4(at) };
  const s = carriedStart(l, at - tin);
  if (s !== null) rest.props = { ...rest.props, start: r4(s) };
  const parent = parentOf(c, id), list = parent ? c.layers[parent].children! : c.order, i = list.indexOf(id);
  const ops: Op[] = [
    { op: 'add', path: pointer('compositions', compId, 'layers', id, 'out'), value: r4(at) },
    { op: 'add', path: pointer('compositions', compId, 'layers', nid), value: rest },
    { op: 'replace', path: parent ? pointer('compositions', compId, 'layers', parent, 'children') : pointer('compositions', compId, 'order'), value: [...list.slice(0, i + 1), nid, ...list.slice(i + 1)] },
  ];
  return { ops, id: nid };
}
