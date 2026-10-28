// What the lanes of a sequence do, as operations on the document: the order
// they show in, what a track header changes, adding and removing a track, a
// clip moved to another track, the sound tracks the preview plays alone.

import { applyOps, isLocked, pointer, syncOrderOps, trackClips, type Composition, type Op, type SequenceTrack, type TrammeDoc } from '@tramme/core';

/** the lanes as the timeline stacks them: the video tracks top first (the highest track on top), then the sound tracks */
export function laneOrder(c: Composition): SequenceTrack[] {
  const tracks = c.tracks ?? [];
  return [...tracks.filter((t) => t.kind === 'video').reverse(), ...tracks.filter((t) => t.kind === 'audio')];
}

/** the track a clip of this kind goes on by default: that of the clip selected, else the first one of its kind that is not locked */
export function defaultTrackOf(c: Composition, audio: boolean, selected?: string): string | undefined {
  const fits = (x: SequenceTrack) => (x.kind === 'audio') === audio && !x.locked;
  return (c.tracks?.find((x) => x.id === (selected ? c.layers[selected]?.track : undefined) && fits(x)) ?? c.tracks?.find(fits))?.id;
}

/** the clips of a track, by their in point */
export const clipsOn = (c: Composition, trackId: string): string[] => trackClips(c, trackId).map((k) => k.id);

export type TrackChange = Partial<Pick<SequenceTrack, 'name' | 'locked' | 'hidden' | 'muted' | 'magnetic' | 'height'>>;

/** a track's fields set or taken off (false, an empty name and no height take a field off); nothing when it is already so */
export function trackChangeOps(c: Composition, compId: string, trackId: string, change: TrackChange): Op[] {
  const i = (c.tracks ?? []).findIndex((t) => t.id === trackId);
  if (i < 0) return [];
  const track = c.tracks![i] as unknown as Record<string, unknown>, ops: Op[] = [];
  for (const [key, raw] of Object.entries(change)) {
    const value = typeof raw === 'string' ? raw.trim() : raw;
    const off = value === false || value === '' || value === undefined || value === null;
    if (off) { if (track[key] !== undefined) ops.push({ op: 'remove', path: pointer('compositions', compId, 'tracks', i, key) }); }
    else if (track[key] !== value) ops.push({ op: 'add', path: pointer('compositions', compId, 'tracks', i, key), value });
  }
  return ops;
}

/** a new track: a video one above the others, a sound one after them, numbered after the last of its kind; the first one makes the composition a sequence */
export function addTrackOps(c: Composition, compId: string, kind: 'video' | 'audio'): { ops: Op[]; id: string } {
  const tracks = c.tracks ?? [], prefix = kind === 'video' ? 'V' : 'A';
  let n = tracks.filter((t) => t.kind === kind).length + 1;
  while (tracks.some((t) => t.id === `${prefix}${n}`)) n++;
  const track: SequenceTrack = { id: `${prefix}${n}`, kind };
  const at = kind === 'video' ? tracks.filter((t) => t.kind === 'video').length : tracks.length;
  const next = [...tracks.slice(0, at), track, ...tracks.slice(at)];
  return {
    id: track.id,
    ops: [
      ...(c.kind === 'sequence' ? [] : [{ op: 'add', path: pointer('compositions', compId, 'kind'), value: 'sequence' } as Op]),
      { op: 'add', path: pointer('compositions', compId, 'tracks'), value: next },
    ],
  };
}

/** a track taken away; nothing while clips sit on it */
export function removeTrackOps(doc: TrammeDoc, compId: string, trackId: string): Op[] {
  const c = doc.compositions[compId], i = (c.tracks ?? []).findIndex((t) => t.id === trackId);
  if (i < 0 || trackClips(c, trackId).length) return [];
  return [{ op: 'remove', path: pointer('compositions', compId, 'tracks', i) }];
}

/**
 * A clip put on another track, where it already is in time. Nothing when the
 * track is of the other kind (a sound on a picture track), when it or the
 * clip's own track is locked, or when the clip would overlap one already there.
 */
export function moveToTrackOps(doc: TrammeDoc, compId: string, id: string, trackId: string): Op[] {
  const c = doc.compositions[compId], l = c.layers[id], to = c.tracks?.find((t) => t.id === trackId);
  if (!l || !to || l.track === trackId || isLocked(c, id) || to.locked) return [];
  if ((l.type === 'audio') !== (to.kind === 'audio')) return [];
  const tin = l.in ?? 0, tout = l.out ?? c.duration, half = 0.5 / c.fps;
  if (trackClips(c, trackId).some((k) => k.id !== id && Math.min(k.out, tout) - Math.max(k.in, tin) > half)) return [];
  const set: Op = { op: 'add', path: pointer('compositions', compId, 'layers', id, 'track'), value: trackId };
  return [set, ...syncOrderOps(applyOps(doc, [set]).doc, compId)];
}

/** the layers the preview plays alone once a sound track is soloed (or no longer): the sounds of that track added to, or taken from, the ones already soloed */
export function soloOf(c: Composition, trackId: string, current: Set<string>): Set<string> {
  const mine = clipsOn(c, trackId), all = mine.every((id) => current.has(id));
  const next = new Set(current);
  for (const id of mine) all ? next.delete(id) : next.add(id);
  return next;
}
