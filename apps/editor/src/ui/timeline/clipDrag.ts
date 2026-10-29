// What a drag of clips comes to when it is let go: on a magnetic track the
// clip is put among the others and the track closes up; elsewhere the clips
// are moved in time and nothing else shifts. The clips linked to the ones
// dragged (a picture and its sound) go with them, and a locked clip among
// them keeps them all where they are.

import { applyOps, isLocked, linkedIds, reorderOps, shiftLayerOps, type Composition, type Op, type TrammeDoc } from '@tramme/core';
import { topLayers } from '../../model.ts';
import { moveToTrackOps } from './tracks.ts';

/** these clips and the clips linked to them */
export const withLinks = (c: Composition, ids: string[]): string[] => [...new Set(ids.flatMap((id) => linkedIds(c, id)))];

/** the operations of clips dropped `dt` seconds from where they were picked up */
export function dropOps(doc: TrammeDoc, compId: string, ids: string[], dt: number): Op[] {
  const c = doc.compositions[compId];
  if (ids.length === 1) {
    const l = c.layers[ids[0]];
    if (l?.track && c.tracks?.find((t) => t.id === l.track)?.magnetic) return reorderOps(doc, compId, ids[0], (l.in ?? 0) + dt + ((l.out ?? c.duration) - (l.in ?? 0)) / 2);
  }
  const moving = withLinks(c, topLayers(c, ids));
  if (moving.some((id) => isLocked(c, id))) return [];
  const earliest = Math.min(...moving.map((id) => c.layers[id].in ?? 0));
  const at = Math.max(dt, -earliest);
  return at ? moving.flatMap((id) => shiftLayerOps(doc, compId, id, at)) : [];
}

/**
 * A drag let go: over another lane, the clip changes track where it is in
 * time; over its own lane or outside every one, the clips are dropped as
 * `dropOps` says (on a magnetic track the clip finds its place among the others).
 */
export function endMoveOps(doc: TrammeDoc, compId: string, ids: string[], dt: number, lane: string | null): Op[] {
  const c = doc.compositions[compId], only = ids.length === 1 ? c.layers[ids[0]] : undefined;
  if (only && lane && lane !== only.track) {
    const by = withLinks(c, ids).some((id) => isLocked(c, id)) ? [] : shiftOnly(doc, compId, ids, dt);
    return by.length || !dt ? [...by, ...moveToTrackOps(by.length ? applyOps(doc, by).doc : doc, compId, ids[0], lane)] : [];
  }
  return dropOps(doc, compId, ids, dt);
}

/** the clips moved in time, nothing else */
function shiftOnly(doc: TrammeDoc, compId: string, ids: string[], dt: number): Op[] {
  const c = doc.compositions[compId], moving = withLinks(c, topLayers(c, ids)), earliest = Math.min(...moving.map((id) => c.layers[id].in ?? 0)), at = Math.max(dt, -earliest);
  return at ? moving.flatMap((id) => shiftLayerOps(doc, compId, id, at)) : [];
}
