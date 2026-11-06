import type { TrammeDoc } from '@tramme/core';

/** Audio inserts/routing, shared by the playback watcher and loudness cache.
 * Other document edits must not interrupt a playing sound. */
export function audioEffectsKey(doc: TrammeDoc, compId: string): string {
  const comp = doc.compositions[compId];
  return JSON.stringify([
    compId,
    comp.sound?.tempo ?? null,
    (comp.tracks ?? []).map((track) => [track.id, track.to ?? null, track.effects ?? []]),
    Object.entries(comp.layers).filter(([, layer]) => layer.type === 'audio' || layer.type === 'video').map(([id, layer]) => [id, layer.track ?? null]),
  ]);
}
