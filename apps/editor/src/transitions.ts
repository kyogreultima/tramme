// A transition put on a cut (docs/editing-roadmap.md, step 3): the shot that
// ends where this one starts is found, the two are made to overlap by the
// transition's length (centred on the cut, from the handles of their files:
// what the incoming file holds before its start, the outgoing file after its
// end), the incoming shot goes above the outgoing one and gets fx.transition.
// A file without enough handle says so instead.

import { pointer, staticValue, type Composition, type Layer, type Op, type TrammeDoc } from '@tramme/core';

export const TRANSITION_KINDS = ['crossfade', 'dip', 'push', 'slide', 'zoom', 'whip', 'luma', 'glitch'] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** the array a layer is stacked in: the composition's order or its group's children */
function stackOf(c: Composition, id: string): { path: string[]; ids: string[] } {
  for (const [gid, g] of Object.entries(c.layers)) if (g.children?.includes(id)) return { path: ['layers', gid, 'children'], ids: g.children };
  return { path: ['order'], ids: c.order };
}

/** the transition a layer carries, if any */
export const transitionOf = (l: Layer) => (l.effects ?? []).find((e) => e.type === 'fx.transition');

/**
 * The shot a transition on `id` comes from: an existing transition's `from`,
 * or the sibling that ends where it starts (within half a frame), or the one
 * it already overlaps at its start.
 */
export function outgoingOf(doc: TrammeDoc, compId: string, id: string): string | null {
  const c = doc.compositions[compId], l = c.layers[id];
  if (!l) return null;
  const had = staticValue(transitionOf(l)?.props?.from);
  if (typeof had === 'string' && c.layers[had]) return had;
  const tin = l.in ?? 0, half = 0.5 / c.fps;
  let best: string | null = null, gap = Infinity;
  for (const o of stackOf(c, id).ids) {
    if (o === id) continue;
    const ol = c.layers[o];
    if (!ol || (ol.in ?? 0) >= tin) continue;
    const out = ol.out ?? c.duration;
    if (out < tin - half) continue;
    const g = Math.abs(out - tin);
    if (g < gap) { gap = g; best = o; }
  }
  return best;
}

export interface TransitionPlan { ops: Op[]; from: string; duration: number }

/**
 * The operations that put a transition of `duration` seconds on the cut into
 * `id`: the overlap made from the handles (centred on the cut, the other side
 * taking what one lacks), the stack, the effect. `fileLength(asset)` gives a
 * video's length when known; unknown, its end is taken as long enough.
 * Returns an error to show when the files have no handle left.
 */
export function transitionPlan(doc: TrammeDoc, compId: string, id: string, kind: TransitionKind, duration: number, fileLength: (asset: string) => number | undefined = () => undefined): TransitionPlan | { error: 'no-cut' | 'no-handle'; missing?: number } {
  const c = doc.compositions[compId], l = c.layers[id], from = outgoingOf(doc, compId, id);
  if (!l || !from) return { error: 'no-cut' };
  const o = c.layers[from];
  // in whole frames, like every time the timeline writes
  const frame = (x: number) => Math.round(x * c.fps) / c.fps;
  const tin = l.in ?? 0, oout = o.out ?? c.duration, d = Math.max(1, Math.round(duration * c.fps)) / c.fps;
  // a transition already there: its cut is the middle of its window; otherwise the middle of the overlap (a plain cut: the cut)
  const had = transitionOf(l), hadD = Number(staticValue(had?.props?.duration)) || 0;
  const cut = had ? tin + hadD / 2 : (tin + Math.max(tin, oout)) / 2;
  const rateOf = (x: Layer) => { const v = Number(staticValue(x.props?.rate)); return Number.isFinite(v) && v > 0 ? v : 1; };
  const startOf = (x: Layer) => Number(staticValue(x.props?.start)) || 0;
  // the handles: how much earlier the incoming shot can start (its file before its start), how much later the outgoing can end
  const preIn = l.type === 'video' || l.type === 'audio' ? startOf(l) / rateOf(l) : Infinity;
  const len = o.type === 'video' ? fileLength(String(staticValue(o.props?.video) ?? '')) : undefined;
  const postOut = len === undefined ? Infinity : Math.max(0, (len - (startOf(o) + (oout - (o.in ?? 0)) * rateOf(o))) / rateOf(o));
  // the window [a, a + d]: centred on the cut, moved to what the handles allow
  const lo = tin - preIn, hi = oout + postOut - d;
  if (lo > hi + 0.5 / c.fps) return { error: 'no-handle', missing: r4(lo - hi) };
  let a = Math.min(Math.max(cut - d / 2, lo), Math.max(lo, hi));
  a = r4(Math.min(Math.max(frame(a), Math.ceil(lo * c.fps - 1e-6) / c.fps), Math.max(lo, Math.floor(hi * c.fps + 1e-6) / c.fps)));
  const lp = pointer('compositions', compId, 'layers', id), op = pointer('compositions', compId, 'layers', from);
  const ops: Op[] = [];
  if (Math.abs(a - tin) > 1e-6) {
    ops.push({ op: 'add', path: `${lp}/in`, value: a });
    if (l.type === 'video' || l.type === 'audio') ops.push({ op: 'add', path: `${lp}/props/start`, value: r4(Math.max(0, (Number(staticValue(l.props?.start)) || 0) - (tin - a) * rateOf(l))) });
  }
  if (oout < a + d - 1e-6) ops.push({ op: 'add', path: `${op}/out`, value: r4(a + d) });
  // the incoming shot drawn above the outgoing one
  const stack = stackOf(c, id), i = stack.ids.indexOf(id), j = stack.ids.indexOf(from);
  if (i >= 0 && j >= 0 && i < j) {
    const next = stack.ids.filter((x) => x !== id);
    next.splice(next.indexOf(from) + 1, 0, id);
    ops.push({ op: 'replace', path: pointer('compositions', compId, ...stack.path), value: next });
  }
  const effect = { id: had?.id ?? 'transition', type: 'fx.transition', props: { ...(had?.props ?? {}), from, kind, duration: r4(d) } };
  const effects = l.effects ?? [];
  ops.push(had
    ? { op: 'replace', path: `${lp}/effects/${effects.indexOf(had)}`, value: effect }
    : { op: 'add', path: `${lp}/effects`, value: [...effects, effect] });
  return { ops, from, duration: r4(d) };
}
