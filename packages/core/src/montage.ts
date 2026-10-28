// Editing a film made of clips on tracks, as pure functions of the document:
// each takes the document and an intent and returns the operations that carry
// it out. The timeline's gestures, the keyboard and the assistant's tools all
// call these, so a ripple is the same ripple wherever it comes from.

import { pointer, type Op } from './ops.ts';
import { staticValue } from './props.ts';
import { round6, shiftLayerOps, subtree } from './timing.ts';
import type { Composition, TrammeDoc } from './types.ts';

/** where a clip sits on its track: its id, its in point and its out point (the composition's end when it has none) */
export interface Footprint { id: string; in: number; out: number }

/** the clips of a track, by in point */
export function trackClips(c: Composition, trackId: string): Footprint[] {
  const out: Footprint[] = [];
  for (const [id, l] of Object.entries(c.layers)) if (l.track === trackId) out.push({ id, in: l.in ?? 0, out: l.out ?? c.duration });
  return out.sort((a, b) => a.in - b.in || a.id.localeCompare(b.id));
}

/**
 * The cuts of a track: two neighbouring clips that touch or overlap. Where a
 * transition makes them overlap, the cut is the centre of the overlap; a gap
 * between them is not a cut.
 */
export function cutsOf(c: Composition, trackId: string): { left: string; right: string; at: number }[] {
  const clips = trackClips(c, trackId), half = 0.5 / c.fps, out: { left: string; right: string; at: number }[] = [];
  for (let i = 1; i < clips.length; i++) {
    const a = clips[i - 1], b = clips[i];
    if (b.in <= a.out + half) out.push({ left: a.id, right: b.id, at: b.in < a.out ? (b.in + a.out) / 2 : b.in });
  }
  return out;
}

/** the clips that share a link with `id`, itself included (just itself when it is not linked) */
export function linkedIds(c: Composition, id: string): string[] {
  const link = c.layers[id]?.link;
  return link ? Object.keys(c.layers).filter((k) => c.layers[k].link === link) : [id];
}

/** a clip that cannot be edited: its track is locked, or so is the track of a clip linked to it */
export function isLocked(c: Composition, id: string): boolean {
  return linkedIds(c, id).some((k) => {
    const t = c.layers[k]?.track;
    return !!t && !!c.tracks?.find((x) => x.id === t)?.locked;
  });
}

/**
 * Removes layers (and their descendants) in one go: each list that held them
 * is written once, so indexes never go stale; clips that were clipped by them
 * lose the clip, and a transition coming from one of them is taken off the
 * clip that carried it.
 */
export function removeLayersOps(doc: TrammeDoc, compId: string, ids: Iterable<string>): Op[] {
  const c = doc.compositions[compId], gone = new Set<string>();
  for (const id of ids) if (c.layers[id]) for (const x of subtree(c, id)) gone.add(x);
  if (!gone.size) return [];
  const ops: Op[] = [];
  const lists: [string[], string[]][] = [[['order'], c.order]];
  for (const [id, l] of Object.entries(c.layers)) if (l.children && !gone.has(id)) lists.push([['layers', id, 'children'], l.children]);
  for (const [path, list] of lists) {
    if (list.some((x) => gone.has(x))) ops.push({ op: 'replace', path: pointer('compositions', compId, ...path), value: list.filter((x) => !gone.has(x)) });
  }
  for (const [id, l] of Object.entries(c.layers)) {
    if (gone.has(id)) continue;
    const lp = pointer('compositions', compId, 'layers', id);
    if (l.clip && gone.has(l.clip)) ops.push({ op: 'remove', path: `${lp}/clip` });
    const fx = l.effects ?? [];
    for (let i = fx.length - 1; i >= 0; i--) {
      const from = fx[i].type === 'fx.transition' ? staticValue(fx[i].props?.from) : undefined;
      if (typeof from === 'string' && gone.has(from)) ops.push({ op: 'remove', path: `${lp}/effects/${i}` });
    }
  }
  for (const id of gone) ops.push({ op: 'remove', path: pointer('compositions', compId, 'layers', id) });
  return ops;
}

const trackLocked = (c: Composition, trackId: string) => !!c.tracks?.find((t) => t.id === trackId)?.locked;

/** the operations moving each of these clips by its own shift, or none when one of them cannot move (locked) */
function shiftAll(doc: TrammeDoc, compId: string, shifts: Map<string, number>): Op[] | null {
  const c = doc.compositions[compId], ops: Op[] = [];
  for (const [id, dt] of shifts) {
    if (isLocked(c, id)) return null;
    ops.push(...shiftLayerOps(doc, compId, id, dt));
  }
  return ops;
}

/**
 * Clips removed and the track closed behind them: on each track that held a
 * removed clip, what follows moves left by the span removed (less the part a
 * transition had already overlapped; a gap that followed stays). A clip
 * removed with the clips linked to it. Nothing happens when any of them, or
 * any clip that would move, is locked.
 */
export function rippleDeleteOps(doc: TrammeDoc, compId: string, ids: string[]): Op[] {
  const c = doc.compositions[compId], half = 0.5 / c.fps;
  const gone = new Set(ids.filter((id) => c.layers[id]).flatMap((id) => linkedIds(c, id)));
  if (!gone.size || [...gone].some((id) => isLocked(c, id))) return [];
  const byTrack = new Map<string, [number, number][]>();
  for (const id of gone) {
    const l = c.layers[id];
    if (l.track) byTrack.set(l.track, [...(byTrack.get(l.track) ?? []), [l.in ?? 0, l.out ?? c.duration]]);
  }
  const shifts = new Map<string, number>();
  for (const [track, spans] of byTrack) {
    const merged: [number, number][] = [];
    for (const [a, b] of spans.sort((x, y) => x[0] - y[0])) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]);
    }
    const kept = trackClips(c, track).filter((f) => !gone.has(f.id));
    for (const [s, e] of merged) {
      const next = kept.find((k) => k.in >= s - half);
      if (!next) continue;
      const d = round6(next.in >= e ? e - s : next.in - s);
      if (d <= 0) continue;
      for (const k of kept) if (k.in >= next.in - 1e-9) shifts.set(k.id, (shifts.get(k.id) ?? 0) - d);
    }
  }
  const moved = shiftAll(doc, compId, shifts);
  return moved ? [...removeLayersOps(doc, compId, gone), ...moved] : [];
}

/** the gap of a track around `at` closed: the clips after it move left by its length. Nothing where `at` is not in a gap, or when the track is locked */
export function closeGapOps(doc: TrammeDoc, compId: string, trackId: string, at: number): Op[] {
  const c = doc.compositions[compId], half = 0.5 / c.fps;
  if (trackLocked(c, trackId)) return [];
  const clips = trackClips(c, trackId);
  let prevOut = 0;
  for (let i = 0; i < clips.length; i++) {
    const gap = clips[i].in - prevOut;
    if (gap > half && at >= prevOut && at < clips[i].in) {
      const shifts = new Map(clips.slice(i).map((k) => [k.id, -round6(gap)] as [string, number]));
      return shiftAll(doc, compId, shifts) ?? [];
    }
    prevOut = Math.max(prevOut, clips[i].out);
  }
  return [];
}
