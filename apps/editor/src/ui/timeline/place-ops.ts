// A clip made from the project's media put on a track: a video with a sound
// comes as a picture and its own sound, linked, the picture muted. Pure: what
// the drop on a lane, the keys and the assistant use (place.ts reads the file
// and commits).

import { applyOps, detachAudioOps, insertOps, overwriteOps, pointer, type Layer, type Op, type TrammeDoc } from '@tramme/core';
import { freshId } from '../../model.ts';
import { addTrackOps } from './tracks.ts';

/** how long a picture stays on a track when nothing says, s */
export const STILL_LENGTH = 5;

export interface Placement {
  /** the layer the asset becomes (a video as long as its file) */
  layer: Layer;
  /** the video has a sound of its own */
  withSound: boolean;
  /** a clip with no length of its own (a sound), s */
  length?: number;
}

/**
 * The operations that put the clip on `trackId` at `at` (`insert`: the track
 * makes room, `overwrite`: it lies over what is there), and for a video with a
 * sound its own sound on a sound track (made when there is none). Null when the
 * track is of the wrong kind or cannot be edited.
 */
export function placeClipOps(doc: TrammeDoc, compId: string, base: string, p: Placement, at: number, trackId: string, mode: 'insert' | 'overwrite'): { ops: Op[]; id: string } | null {
  const c = doc.compositions[compId], track = c.tracks?.find((x) => x.id === trackId);
  if (!track || track.locked || (p.layer.type === 'audio') !== (track.kind === 'audio')) return null;
  const id = freshId(c.layers, base), from = p.layer.in ?? 0;
  const len = p.layer.out !== undefined ? p.layer.out - from : p.length ?? Math.min(STILL_LENGTH, c.duration);
  const clip: Layer = { ...p.layer, in: from, out: from + len };
  const ops = (mode === 'insert' ? insertOps : overwriteOps)(doc, compId, id, clip, trackId, at);
  if (!ops.length) return null;
  if (!(p.withSound && clip.type === 'video')) return { ops, id };
  let after = applyOps(doc, ops).doc;
  const more: Op[] = [];
  let sound = after.compositions[compId].tracks?.find((x) => x.kind === 'audio' && !x.locked)?.id;
  if (!sound) {
    const add = addTrackOps(after.compositions[compId], compId, 'audio');
    more.push(...add.ops);
    sound = add.id;
    after = applyOps(after, add.ops).doc;
  }
  const detached = detachAudioOps(after, compId, id, sound);
  return { ops: [...ops, ...more, ...(detached?.ops ?? [])], id };
}

/** whether `host` holds `inner` somewhere inside it, through comp layers: nesting it there would make it hold itself */
function holds(doc: TrammeDoc, host: string, inner: string, seen = new Set<string>()): boolean {
  if (host === inner) return true;
  if (seen.has(host)) return false;
  seen.add(host);
  return Object.values(doc.compositions[host]?.layers ?? {}).some((l) => l.type === 'comp' && typeof l.props?.comp === 'string' && holds(doc, l.props.comp, inner, seen));
}

/** a composition put on a track as one clip, as long as it is: null when it would hold itself, or the track cannot take it */
export function nestOps(doc: TrammeDoc, compId: string, innerId: string, at: number, trackId: string, mode: 'insert' | 'overwrite'): { ops: Op[]; id: string } | null {
  const inner = doc.compositions[innerId];
  if (!inner || holds(doc, innerId, compId)) return null;
  const c = doc.compositions[compId], pos = [c.width / 2, c.height / 2];
  return placeClipOps(doc, compId, inner.name, { layer: { type: 'comp', name: inner.name, transform: { position: pos as [number, number] }, in: 0, out: inner.duration, props: { comp: innerId } }, withSound: false }, at, trackId, mode);
}

/**
 * A new sequence made of clips, end to end on a magnetic V1 (their sounds on
 * A1), the size and the rate of the composition it is made from. Null with no
 * clip, or when none of them fits.
 */
export function newSequenceOps(doc: TrammeDoc, fromComp: string, id: string, name: string, clips: { base: string; placement: Placement }[]): { ops: Op[]; id: string } | null {
  if (!clips.length) return null;
  const from = doc.compositions[fromComp];
  const make: Op = { op: 'add', path: pointer('compositions', id), value: { name, kind: 'sequence', width: from.width, height: from.height, fps: from.fps, duration: 1, background: null, tracks: [{ id: 'V1', kind: 'video', magnetic: true }, { id: 'A1', kind: 'audio' }], layers: {}, order: [] } };
  const ops: Op[] = [make];
  let d = applyOps(doc, [make]).doc, at = 0;
  for (const { base, placement } of clips) {
    const r = placeClipOps(d, id, base, placement, at, placement.layer.type === 'audio' ? 'A1' : 'V1', 'overwrite');
    if (!r) continue;
    ops.push(...r.ops);
    d = applyOps(d, r.ops).doc;
    at = Math.max(at, ...Object.values(d.compositions[id].layers).filter((l) => l.track === 'V1' || (placement.layer.type === 'audio' && l.track === 'A1')).map((l) => l.out ?? 0));
  }
  return ops.length > 1 ? { ops, id } : null;
}
