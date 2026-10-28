// Editing a film made of clips on tracks, as pure functions of the document:
// each takes the document and an intent and returns the operations that carry
// it out. The timeline's gestures, the keyboard and the assistant's tools all
// call these, so a ripple is the same ripple wherever it comes from.

import type { Composition } from './types.ts';

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
