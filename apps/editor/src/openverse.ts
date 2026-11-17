// Openverse, the search of free recordings and pictures: one call for the
// sounds (sound-find) and the pictures (the stock libraries).

/** The licences the editor can keep and credit for commercial work. */
export function licenceOf(r: { license?: string; license_version?: string }): string | null {
  const license = r.license?.trim().toLowerCase();
  if (license === 'cc0') return 'CC0';
  if (license === 'pdm') return 'PDM';
  if (license === 'by') return `CC BY${r.license_version?.trim() ? ` ${r.license_version.trim()}` : ''}`;
  return null;
}

/** a search of Openverse (audio or images): its results, or an error naming Openverse */
export async function openverse(kind: 'audio' | 'images', params: Record<string, string>, signal: AbortSignal): Promise<unknown[]> {
  const r = await fetch(`https://api.openverse.org/v1/${kind}/?${new URLSearchParams(params)}`, { signal });
  if (!r.ok) throw new Error(`Openverse: HTTP ${r.status}`);
  return ((await r.json()) as { results?: unknown[] }).results ?? [];
}
