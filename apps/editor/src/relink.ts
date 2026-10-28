// Media whose file went missing, and the files that bring them back: which
// file belongs to which media (the same content first, then the same name).

import type { Asset } from '@tramme/core';

/** a file offered to bring media back: its name, and its content hash when it was computed */
export interface Candidate { name: string; hash?: string }

const baseName = (path: string) => (path.split(/[\\/]/).pop() ?? path).toLowerCase();

/**
 * For each missing asset the index of the candidate that is its file: one
 * with the same content hash first, then one with the same name (case aside)
 * unless both are hashed and the hashes differ (another content under the
 * name). A candidate serves one asset; the assets nothing matches are left out.
 */
export function matchRelink(missing: [string, Asset][], candidates: Candidate[]): Map<string, number> {
  const out = new Map<string, number>(), taken = new Set<number>();
  for (const [id, a] of missing) {
    const i = a.hash ? candidates.findIndex((c, k) => !taken.has(k) && c.hash === a.hash) : -1;
    if (i >= 0) { out.set(id, i); taken.add(i); }
  }
  for (const [id, a] of missing) {
    if (out.has(id)) continue;
    const i = candidates.findIndex((c, k) => !taken.has(k) && c.name.toLowerCase() === baseName(a.src) && !(a.hash && c.hash && c.hash !== a.hash));
    if (i >= 0) { out.set(id, i); taken.add(i); }
  }
  return out;
}
