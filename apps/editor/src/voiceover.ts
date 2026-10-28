// A voice-over taken on the timeline: the recording becomes a sound asset and a
// voice clip lying over the track from where it began. What it covers is cut
// by it, never lost: the media stay in the project.

import { addTrackOps, applyOps, overwriteOps, pointer, type Layer, type Op, type TrammeDoc } from '@tramme/core';
import { freshId } from './model.ts';

/** a recording, once it is a file of the project */
export interface Take { src: string; name: string; /** s */ duration: number }

/**
 * The operations that put a take (asset `id`) on a sound track at `at`: the
 * asset, a sound track when there is none, the clip lying over the track. Null
 * for an empty recording, or a locked track.
 */
export function takeOps(doc: TrammeDoc, compId: string, id: string, take: Take, at: number, trackId: string): { ops: Op[]; id: string } | null {
  if (!(take.duration > 0)) return null;
  const ops: Op[] = [{ op: 'add', path: pointer('assets', id), value: { type: 'audio', src: take.src, name: take.name } }];
  let d = applyOps(doc, ops).doc, track = d.compositions[compId].tracks?.find((x) => x.id === trackId && x.kind === 'audio');
  if (!track) {
    const add = addTrackOps(d.compositions[compId], compId, 'audio');
    ops.push(...add.ops);
    d = applyOps(d, add.ops).doc;
    track = d.compositions[compId].tracks!.find((x) => x.id === add.id)!;
  }
  if (track.locked) return null;
  const layerId = freshId(d.compositions[compId].layers, 'voice');
  const layer: Layer = { type: 'audio', name: take.name, in: 0, out: take.duration, props: { audio: id, role: 'voice' } };
  const placed = overwriteOps(d, compId, layerId, layer, track.id, at);
  return placed.length ? { ops: [...ops, ...placed], id: layerId } : null;
}
