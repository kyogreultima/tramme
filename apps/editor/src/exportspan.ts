// The span of an export: the film between an in mark and an out mark (two
// markers of the composition, kinds `in` and `out`), counted in frames. No mark,
// or marks the wrong way round: the whole film.

import { pointer, type Composition, type Marker, type Op } from '@tramme/core';

const snapTo = (t: number, fps: number) => +(Math.round(t * fps) / fps).toFixed(4);

/** [from, to] in seconds, on frames, when the composition has an in mark before an out mark */
export function exportRangeOf(c: Composition): [number, number] | undefined {
  const a = c.markers?.find((m) => m.kind === 'in'), b = c.markers?.find((m) => m.kind === 'out');
  if (!a || !b) return undefined;
  const from = snapTo(a.t, c.fps), to = snapTo(b.t, c.fps);
  return to > from ? [from, to] : undefined;
}

/** the frames an export renders: [f0, f1) of a film of `duration` s, the span clamped to the film */
export function frameSpan(fps: number, duration: number, range?: [number, number]): { f0: number; f1: number; from: number; to: number } {
  const f0 = Math.max(0, Math.round((range?.[0] ?? 0) * fps)), f1 = Math.min(Math.round(duration * fps), Math.round((range?.[1] ?? duration) * fps));
  return { f0, f1, from: f0 / fps, to: f1 / fps };
}

/** the in mark or the out mark put at `t`, the one there was moved */
export function setRangeOps(c: Composition, compId: string, which: 'in' | 'out', t: number): Op[] {
  const others = (c.markers ?? []).filter((m) => m.kind !== which);
  let id: string = which;
  for (let n = 2; others.some((m) => m.id === id); n++) id = `${which}-${n}`;
  const mark: Marker = { id, t: snapTo(t, c.fps), kind: which };
  return [{ op: 'add', path: pointer('compositions', compId, 'markers'), value: [...others, mark].sort((a, b) => a.t - b.t) }];
}

/** both marks taken off, the other markers kept */
export function clearRangeOps(c: Composition, compId: string): Op[] {
  const list = c.markers ?? [], kept = list.filter((m) => m.kind !== 'in' && m.kind !== 'out');
  return kept.length === list.length ? [] : [{ op: 'replace', path: pointer('compositions', compId, 'markers'), value: kept }];
}
