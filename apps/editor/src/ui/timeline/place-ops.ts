// A clip made from the project's media put on a track: a video with a sound
// comes as a picture and its own sound, linked, the picture muted. Pure: what
// the drop on a lane, the keys and the assistant use (place.ts reads the file
// and commits).

import { applyOps, detachAudioOps, insertOps, overwriteOps, type Layer, type Op, type TrammeDoc } from '@tramme/core';
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
