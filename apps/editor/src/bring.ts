// Bringing the projects of this browser into the account. Before signing in,
// the personal mode kept them in this browser's IndexedDB (sw.ts); signed in,
// the projects are the account's (mode.ts, cloud). Each one chosen goes
// through its .tramme archive, read from IndexedDB with the routes the service
// worker answers with, and imported into the account as a .tramme file is: no
// second way of copying a project. The local copies stay.

import { recordBucket, storageRoute } from '@tramme/api';
import type { Manifest } from '@tramme/project';
import { importArchive } from './importer.ts';
import { idbRecords } from './local/idb.ts';

/** the storage of this browser's personal mode, asked the way the service worker is */
async function local(path: string): Promise<Response> {
  const url = new URL(path, 'http://local');
  const res = await storageRoute(new Request(url), recordBucket(idbRecords()), url);
  if (!res?.ok) throw new Error(`${path}: ${res?.status ?? 'no route'}`);
  return res;
}

/** the projects this browser keeps without an account, most recent first ([] when there is none) */
export async function localProjects(): Promise<Manifest[]> {
  if (typeof indexedDB === 'undefined') return [];
  try { return (await (await local('/api/projects')).json()) as Manifest[]; } catch { return []; }
}

export interface Brought { brought: Manifest[]; failed: { id: string; name: string; error: string }[] }

/** the chosen projects copied into the account, one after the other; a failure does not stop the others */
export async function bring(projects: Manifest[], progress: (done: number, total: number, name: string) => void): Promise<Brought> {
  const out: Brought = { brought: [], failed: [] };
  for (const [i, m] of projects.entries()) {
    progress(i, projects.length, m.name);
    try {
      const archive = await (await local(`/api/projects/${encodeURIComponent(m.id)}/export`)).blob();
      // the person's own projects: their code was accepted when they came into this browser
      out.brought.push(await importArchive(archive, undefined, { ask: null }));
    } catch (e) {
      out.failed.push({ id: m.id, name: m.name, error: (e as Error).message });
    }
  }
  progress(projects.length, projects.length, '');
  return out;
}

const offeredKey = (userId: string) => `tramme.bring.offered.${userId}`;

/** whether the offer was made to this person in this browser (it is made once; the space keeps it at hand) */
export function wasOffered(userId: string): boolean {
  try { return localStorage.getItem(offeredKey(userId)) === '1'; } catch { return true; }
}

export function markOffered(userId: string) {
  try { localStorage.setItem(offeredKey(userId), '1'); } catch { /* private browsing: offered again next time */ }
}
