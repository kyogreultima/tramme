// Openverse, the search of free recordings and pictures: one call for the
// sounds (sound-find) and the pictures (the stock libraries).

/** a search of Openverse (audio or images): its results, or an error naming Openverse */
export async function openverse(kind: 'audio' | 'images', params: Record<string, string>, signal: AbortSignal): Promise<unknown[]> {
  const r = await fetch(`https://api.openverse.org/v1/${kind}/?${new URLSearchParams(params)}`, { signal });
  if (!r.ok) throw new Error(`Openverse: HTTP ${r.status}`);
  return ((await r.json()) as { results?: unknown[] }).results ?? [];
}
