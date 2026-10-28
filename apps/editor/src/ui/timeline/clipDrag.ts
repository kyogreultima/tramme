// What a drag of clips comes to when it is let go: on a magnetic track the
// clip is put among the others and the track closes up; elsewhere the clips
// are moved in time and nothing else shifts.

import { isLocked, reorderOps, shiftLayerOps, type Op, type TrammeDoc } from '@tramme/core';
import { topLayers } from '../../model.ts';

/** the operations of clips dropped `dt` seconds from where they were picked up */
export function dropOps(doc: TrammeDoc, compId: string, ids: string[], dt: number): Op[] {
  const c = doc.compositions[compId];
  if (ids.length === 1) {
    const l = c.layers[ids[0]];
    if (l?.track && c.tracks?.find((t) => t.id === l.track)?.magnetic) return reorderOps(doc, compId, ids[0], (l.in ?? 0) + dt + ((l.out ?? c.duration) - (l.in ?? 0)) / 2);
  }
  const moving = topLayers(c, ids);
  if (moving.some((id) => isLocked(c, id))) return [];
  const earliest = Math.min(...moving.map((id) => c.layers[id].in ?? 0));
  const at = Math.max(dt, -earliest);
  return at ? moving.flatMap((id) => shiftLayerOps(doc, compId, id, at)) : [];
}
