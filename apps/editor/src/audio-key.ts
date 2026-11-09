import type { TrammeDoc } from '@tramme/core';

/** Audio inserts/routing, shared by the playback watcher and loudness cache.
 * Other document edits must not interrupt a playing sound. */
export function audioEffectsKey(doc: TrammeDoc, compId: string): string {
  const comp = doc.compositions[compId];
  const duckSources = new Set((comp.tracks ?? []).flatMap((track) => track.duckUnder ? [track.duckUnder] : []));
  return JSON.stringify([
    compId,
    comp.sound?.tempo ?? null,
    (comp.tracks ?? []).map((track) => [track.id, track.to ?? null, track.effects ?? [], track.volumeBlocks ?? [], track.duckUnder ?? null, ...(duckSources.has(track.id) ? [track.muted ?? false, track.hidden ?? false] : [])]),
    Object.entries(comp.layers).filter(([, layer]) => layer.type === 'audio' || layer.type === 'video').map(([id, layer]) => [id, layer.track ?? null, ...(duckSources.has(layer.track ?? '') ? [layer.in ?? 0, layer.out ?? comp.duration, layer.visible ?? true, layer.props?.muted ?? false] : [])]),
    duckSources.size ? Object.entries(comp.layers).filter(([, layer]) => !!layer.children).map(([id, layer]) => [id, layer.in ?? 0, layer.out ?? comp.duration, layer.visible ?? true]) : [],
  ]);
}
