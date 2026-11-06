// What the mixer's strips write to the document: a track's volume (still, or
// automated by moving the fader while the film plays), its pan, the bus it
// feeds, a new bus. Pure; the strips themselves are Mixer.tsx.

import { AudioEffectSchema, pointer, volumeBlockKeys, type AudioEffect, type Composition, type Keyframe, type Op } from '@tramme/core';

const VOLUME: [number, number] = [-60, 12];
/** a reading closer than this (dB) to the line between its neighbours is dropped */
const SLACK = 0.25;

const soundTrack = (c: Composition, id: string) => { const i = (c.tracks ?? []).findIndex((t) => t.id === id); return i >= 0 && c.tracks![i].kind === 'audio' && !c.tracks![i].locked ? i : -1; };
const round = (x: number, d: number) => +x.toFixed(d);

/** Draw one dip as an editable group of four keys over the existing track fader. */
export function addVolumeBlockOps(c: Composition, compId: string, trackId: string, from: number, to: number, depth: number, attack: number, release: number): Op[] {
  const i = soundTrack(c, trackId), keys = volumeBlockKeys(from, to, depth, attack, release, c.duration);
  if (i < 0 || !keys) return [];
  const before = c.tracks![i].volumeBlocks ?? [];
  let n = 1;
  while (before.some((block) => block.id === `dip-${n}`)) n++;
  return [{ op: 'add', path: pointer('compositions', compId, 'tracks', i, 'volumeBlocks'), value: [...before, { id: `dip-${n}`, keys }] }];
}

/** Resize or move one saved dip without touching its neighbours or the fader. */
export function resizeVolumeBlockOps(c: Composition, compId: string, trackId: string, id: string, from: number, to: number, depth: number, attack: number, release: number): Op[] {
  const i = soundTrack(c, trackId), keys = volumeBlockKeys(from, to, depth, attack, release, c.duration);
  if (i < 0 || !keys) return [];
  const before = c.tracks![i].volumeBlocks ?? [];
  if (!before.some((block) => block.id === id)) return [];
  return [{ op: 'add', path: pointer('compositions', compId, 'tracks', i, 'volumeBlocks'), value: before.map((block) => block.id === id ? { ...block, keys } : block) }];
}

export function removeVolumeBlockOps(c: Composition, compId: string, trackId: string, id: string): Op[] {
  const i = soundTrack(c, trackId);
  if (i < 0) return [];
  const before = c.tracks![i].volumeBlocks ?? [];
  if (!before.some((block) => block.id === id)) return [];
  const after = before.filter((block) => block.id !== id);
  const path = pointer('compositions', compId, 'tracks', i, 'volumeBlocks');
  return after.length ? [{ op: 'add', path, value: after }] : [{ op: 'remove', path }];
}

/** the readings of a fader reduced to the points that shape the move (Ramer-Douglas-Peucker on the dB) */
function thin(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]), stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1, worst = SLACK;
    for (let i = a + 1; i < b; i++) {
      const [ta, va] = points[a], [tb, vb] = points[b], [t, v] = points[i];
      const line = tb === ta ? va : va + ((vb - va) * (t - ta)) / (tb - ta), off = Math.abs(v - line);
      if (off > worst) { worst = off; far = i; }
    }
    if (far >= 0) { keep.add(far); stack.push([a, far], [far, b]); }
  }
  return points.filter((_, i) => keep.has(i));
}

/**
 * A fader moved over time, written as the automation of the track's volume:
 * the readings [time, dB] thinned to what shapes the move, laid over the
 * automation already there only where they were taken (the keys before and
 * after stay). One reading on a track with no automation is a still volume.
 */
export function faderMoveOps(c: Composition, compId: string, trackId: string, readings: [number, number][]): Op[] {
  const i = soundTrack(c, trackId);
  if (i < 0 || !readings.length) return [];
  const pts = thin([...readings].sort((a, b) => a[0] - b[0]).map(([t, v]) => [round(t, 4), round(Math.min(VOLUME[1], Math.max(VOLUME[0], v)), 2)] as [number, number]));
  const path = pointer('compositions', compId, 'tracks', i, 'volume'), had = c.tracks![i].volume;
  const old: Keyframe[] = had && typeof had === 'object' && '$k' in had ? (had as { $k: Keyframe[] }).$k : [];
  if (pts.length === 1 && !old.length) return [{ op: 'add', path, value: pts[0][1] }];
  const from = pts[0][0], to = pts[pts.length - 1][0];
  const keys = [...old.filter((k) => k.t < from - 1e-6), ...pts.map(([t, v]): Keyframe => ({ t, v })), ...old.filter((k) => k.t > to + 1e-6)];
  return [{ op: 'add', path, value: { $k: keys } }];
}

/** a track's volume made still (dB, kept between -60 and +12): the automation goes, and 0 takes the field off */
export function trackVolumeOps(c: Composition, compId: string, trackId: string, db: number): Op[] {
  const i = soundTrack(c, trackId);
  if (i < 0) return [];
  const v = round(Math.min(VOLUME[1], Math.max(VOLUME[0], db)), 1), path = pointer('compositions', compId, 'tracks', i, 'volume'), had = c.tracks![i].volume;
  if (v === 0) return had === undefined ? [] : [{ op: 'remove', path }];
  return had === v ? [] : [{ op: 'add', path, value: v }];
}

/** a track's pan, between left (-1) and right (1); centred takes the field off */
export function trackPanOps(c: Composition, compId: string, trackId: string, pan: number): Op[] {
  const i = soundTrack(c, trackId);
  if (i < 0) return [];
  const v = round(Math.min(1, Math.max(-1, pan)), 2), path = pointer('compositions', compId, 'tracks', i, 'pan'), had = c.tracks![i].pan;
  if (v === 0) return had === undefined ? [] : [{ op: 'remove', path }];
  return had === v ? [] : [{ op: 'add', path, value: v }];
}

/** the bus a track feeds (or none); only a sound track that is no bus feeds one, and only a bus can be fed */
export function trackBusOps(c: Composition, compId: string, trackId: string, to: string | null): Op[] {
  const i = soundTrack(c, trackId);
  if (i < 0 || c.tracks![i].bus) return [];
  const path = pointer('compositions', compId, 'tracks', i, 'to'), had = c.tracks![i].to;
  if (to === null) return had === undefined ? [] : [{ op: 'remove', path }];
  return c.tracks!.some((t) => t.id === to && t.bus) && had !== to ? [{ op: 'add', path, value: to }] : [];
}

/** a new bus: a sound track that holds none, collecting the tracks that feed it (the first track makes the composition a sequence) */
export function addBusOps(c: Composition, compId: string): { ops: Op[]; id: string } {
  const tracks = c.tracks ?? [];
  let n = tracks.filter((t) => t.bus).length + 1;
  while (tracks.some((t) => t.id === `B${n}`)) n++;
  const bus = { id: `B${n}`, kind: 'audio' as const, bus: true, name: `Bus ${n}` };
  return { id: bus.id, ops: [...(c.kind === 'sequence' ? [] : [{ op: 'add', path: pointer('compositions', compId, 'kind'), value: 'sequence' } as Op]), { op: 'add', path: pointer('compositions', compId, 'tracks'), value: [...tracks, bus] }] };
}

/** Replace a chain in one history entry; an empty chain removes its field. */
function effectsOps(c: Composition, compId: string, trackId: string, update: (effects: AudioEffect[]) => AudioEffect[] | null): Op[] {
  const i = soundTrack(c, trackId);
  if (i < 0) return [];
  const before = c.tracks![i].effects ?? [], after = update(before);
  if (!after) return [];
  const same = before.length === after.length && before.every((effect, index) => {
    const a = effect as unknown as Record<string, unknown>, b = after[index] as unknown as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) => key === 'bypass' ? !!a[key] === !!b[key] : a[key] === b[key]);
  });
  if (same) return [];
  const path = pointer('compositions', compId, 'tracks', i, 'effects');
  return after.length ? [{ op: 'add', path, value: after }] : [{ op: 'remove', path }];
}

const effectIndex = (effects: AudioEffect[], index: number) => Number.isInteger(index) && index >= 0 && index < effects.length;

export function addTrackEffectOps(c: Composition, compId: string, trackId: string, effect: AudioEffect, at?: number): Op[] {
  const parsed = AudioEffectSchema.safeParse(effect);
  if (!parsed.success) return [];
  return effectsOps(c, compId, trackId, (before) => {
    const index = at ?? before.length;
    if (!Number.isInteger(index) || index < 0 || index > before.length) return null;
    return [...before.slice(0, index), parsed.data, ...before.slice(index)];
  });
}

export function removeTrackEffectOps(c: Composition, compId: string, trackId: string, index: number): Op[] {
  return effectsOps(c, compId, trackId, (before) => effectIndex(before, index) ? before.filter((_, i) => i !== index) : null);
}

export function moveTrackEffectOps(c: Composition, compId: string, trackId: string, from: number, to: number): Op[] {
  return effectsOps(c, compId, trackId, (before) => {
    if (!effectIndex(before, from) || !effectIndex(before, to) || from === to) return null;
    const after = [...before], [effect] = after.splice(from, 1);
    after.splice(to, 0, effect);
    return after;
  });
}

export function bypassTrackEffectOps(c: Composition, compId: string, trackId: string, index: number, bypass: boolean): Op[] {
  return effectsOps(c, compId, trackId, (before) => effectIndex(before, index) && !!before[index].bypass !== bypass
    ? before.map((effect, i) => i === index ? { ...effect, bypass } : effect) : null);
}

export function setTrackEffectOps(c: Composition, compId: string, trackId: string, index: number, effect: AudioEffect): Op[] {
  const parsed = AudioEffectSchema.safeParse(effect);
  if (!parsed.success) return [];
  return effectsOps(c, compId, trackId, (before) => effectIndex(before, index) ? before.map((old, i) => i === index ? parsed.data : old) : null);
}

/** Add a whole preset in one history step, retaining the existing chain. */
export function appendTrackEffectsOps(c: Composition, compId: string, trackId: string, effects: readonly AudioEffect[]): Op[] {
  const parsed = effects.map((effect) => AudioEffectSchema.safeParse(effect));
  if (!effects.length || parsed.some((result) => !result.success)) return [];
  return effectsOps(c, compId, trackId, (before) => [...before, ...parsed.map((result) => result.data!)]);
}
