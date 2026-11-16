// Bringing the projects of this browser, or of this computer, into the
// account. Before signing in, the personal mode kept them in this browser's
// IndexedDB (sw.ts); signed in, the projects are the account's (mode.ts,
// cloud). The desktop app lists its folder's projects beside the account's
// (its cloud.rs), the account's marked `cloud`. Each one chosen goes through its
// .tramme archive and is imported into the account as a .tramme file is: no
// second way of copying a project. The local copies stay.

import { recordBucket, storageRoute } from '@tramme/api';
import { DOCUMENT } from '@tramme/project';
import type { Manifest } from '@tramme/project';
import { api, ApiError } from './api.ts';
import { importArchive } from './importer.ts';
import { idbRecords } from './local/idb.ts';
import { tauri } from './tauri.ts';

/** a project of the account, as the desktop app lists it */
export const inAccount = (m: Manifest): boolean => (m as Manifest & { cloud?: boolean }).cloud === true;

/** The account's name for a desktop project's id. */
const cloudId = (id: string) => id.startsWith('cloud--') ? id.slice('cloud--'.length) : id;
export const sameOrigin = (local: Manifest, remote: Manifest): boolean => cloudId(remote.id) === local.id;

/** A claimed id can be left behind by an interrupted import; the document is written last. */
const completeCopy = async (remote: Manifest): Promise<boolean> =>
  (await api.info(remote.id)).files.some((f) => f.path === DOCUMENT);

/** An old copy has a new id. Only identical documents, with the same name and creation date, count as the same copy. */
async function sameLegacyCopy(source: Manifest, remote: Manifest): Promise<boolean> {
  if (source.created !== remote.created || source.name !== remote.name) return false;
  const original = tauri
    ? (await api.readText(source.id, DOCUMENT))?.text
    : await (await local(`/api/projects/${encodeURIComponent(source.id)}/files/${DOCUMENT}`)).text();
  const copy = (await api.readText(remote.id, DOCUMENT))?.text;
  return !!original && original === copy;
}

/** The desktop lists local and cloud projects together; the web account lists only its cloud projects. */
const accountProjects = async () => (await api.list()).filter((m) => !tauri || inAccount(m));

/** the storage of this browser's personal mode, asked the way the service worker is */
async function local(path: string): Promise<Response> {
  const url = new URL(path, 'http://local');
  const res = await storageRoute(new Request(url), recordBucket(idbRecords()), url);
  if (!res?.ok) throw new Error(`${path}: ${res?.status ?? 'no route'}`);
  return res;
}

/** the projects this browser keeps without an account, most recent first ([] when there is none) */
export async function localProjects(): Promise<Manifest[]> {
  if (tauri) {
    try {
      const all = await api.list(), cloud = all.filter(inAccount);
      const kept = all.filter((m) => !inAccount(m));
      const visible = await Promise.all(kept.map(async (m) => {
        const prior = cloud.find((r) => sameOrigin(m, r));
        return !prior || !await completeCopy(prior).catch(() => false);
      }));
      return kept.filter((_, i) => visible[i]);
    } catch { return []; }
  }
  if (typeof indexedDB === 'undefined') return [];
  try {
    const kept = (await (await local('/api/projects')).json()) as Manifest[];
    const cloud = await accountProjects().catch(() => []);
    const visible = await Promise.all(kept.map(async (m) => {
      const prior = cloud.find((r) => sameOrigin(m, r));
      return !prior || !await completeCopy(prior).catch(() => false);
    }));
    return kept.filter((_, i) => visible[i]);
  } catch { return []; }
}

export interface Brought { brought: Manifest[]; skipped: Manifest[]; failed: { id: string; name: string; error: string }[] }

/** the chosen projects copied into the account, one after the other; a failure does not stop the others */
export async function bring(projects: Manifest[], progress: (done: number, total: number, name: string) => void): Promise<Brought> {
  const out: Brought = { brought: [], skipped: [], failed: [] };
  let cloud: Manifest[];
  try { cloud = await accountProjects(); }
  catch (e) {
    out.failed = projects.map((m) => ({ id: m.id, name: m.name, error: (e as Error).message }));
    progress(projects.length, projects.length, '');
    return out;
  }
  for (const [i, m] of projects.entries()) {
    progress(i, projects.length, m.name);
    try {
      const prior = cloud.find((r) => sameOrigin(m, r));
      if (prior) {
        if (await completeCopy(prior)) { out.skipped.push(m); continue; }
        throw new Error('the account copy is incomplete');
      }
      for (const r of cloud) {
        if (await sameLegacyCopy(m, r)) { out.skipped.push(m); break; }
      }
      if (out.skipped.includes(m)) continue;
      const archive = tauri
        ? await (await fetch(api.exportUrl(m.id))).blob()
        : await (await local(`/api/projects/${encodeURIComponent(m.id)}/export`)).blob();
      // the person's own projects: their code was accepted when they came into this browser or this computer
      const made = await importArchive(archive, undefined, { ask: null, id: m.id, ...(tauri ? { place: 'cloud' as const } : {}) });
      out.brought.push(made);
      cloud.push({ ...m, id: made.id });
    } catch (e) {
      // Another window may have completed the same import since the first listing.
      if (e instanceof ApiError && e.status === 409) {
        const fresh = await accountProjects().catch(() => []);
        const prior = fresh.find((r) => sameOrigin(m, r));
        if (prior && await completeCopy(prior).catch(() => false)) { out.skipped.push(m); continue; }
      }
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
