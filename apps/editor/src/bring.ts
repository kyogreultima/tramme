// Bringing the projects of this browser, or of this computer, into the
// account. Before signing in, the personal mode kept them in this browser's
// IndexedDB (sw.ts); signed in, the projects are the account's (mode.ts,
// cloud). The desktop app lists its folder's projects beside the account's
// (its cloud.rs), the account's marked `cloud`. Each one chosen goes through its
// .tramme archive and is imported into the account as a .tramme file is: no
// second way of copying a project.
//
// A project lives in one place: bringing it moves it. Its renders follow (the
// archive leaves them out), the copy is checked file by file, and only then
// does the one here go. A copy the account had before, whose document is no
// longer this one's, is never taken for it: the project stays here and is
// reported. The desktop app moves an account's project to this computer the
// same way (moveHere).

import { recordBucket, storageRoute } from '@tramme/api';
import { DOCUMENT } from '@tramme/project';
import type { Manifest } from '@tramme/project';
import { api, ApiError, type ProjectFile } from './api.ts';
import { importArchive } from './importer.ts';
import { idbRecords } from './local/idb.ts';
import { tauri } from './tauri.ts';
import { t } from './i18n/index.ts';

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
async function local(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, 'http://local');
  const res = await storageRoute(new Request(url, init), recordBucket(idbRecords()), url);
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

/** a file of a project the app's server holds (this computer's folder in the desktop app, the account) */
async function served(id: string, path: string): Promise<Blob> {
  const r = await fetch(api.fileUrl(id, path));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.blob();
}

/** a project kept here (this computer's folder, this browser's storage): its files, a file, its removal */
const here = {
  files: async (id: string): Promise<ProjectFile[]> => tauri
    ? (await api.info(id)).files
    : ((await (await local(`/api/projects/${encodeURIComponent(id)}`)).json()) as { files: ProjectFile[] }).files,
  file: async (id: string, path: string): Promise<Blob> => tauri
    ? served(id, path)
    : (await local(`/api/projects/${encodeURIComponent(id)}/files/${path.split('/').map(encodeURIComponent).join('/')}`)).blob(),
  remove: async (id: string) => {
    if (tauri) await api.remove(id);
    else await local(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

/** the manifest and the document are rewritten by an import (the id, an upgrade): they are checked for presence, the rest by size */
const REWRITTEN = new Set(['tramme.json', DOCUMENT]);

/** the files of `from` that `to` lacks or holds at another size (none: the copy is whole) */
export function missingFiles(from: { path: string; size: number }[], to: { path: string; size: number }[]): string[] {
  const there = new Map(to.map((f) => [f.path, f.size]));
  return from.filter((f) => !there.has(f.path) || (!REWRITTEN.has(f.path) && there.get(f.path) !== f.size)).map((f) => f.path);
}

/** the renders of a project, which its archive leaves out, written into the copy; one the copy already holds at that size is left */
async function copyRenders(files: ProjectFile[], read: (path: string) => Promise<Blob>, to: string, write: (path: string, blob: Blob) => Promise<unknown>) {
  const there = new Map((await api.info(to)).files.map((f) => [f.path, f.size]));
  for (const f of files.filter((x) => x.path.startsWith('renders/'))) {
    if (there.get(f.path) === f.size) continue;
    await write(f.path, await read(f.path));
  }
}

/** the copy `to` holds every file of `from`, else an error naming what it lacks */
function checkWhole(from: ProjectFile[], to: ProjectFile[]) {
  const missing = missingFiles(from, to);
  if (!missing.length) return;
  // the files for the log; the person reads a sentence
  console.warn('[tramme] move: the copy lacks', missing);
  throw new Error(t('account.bring.notWhole'));
}

/** a project of this computer or browser into the account: copied (archive, then renders), checked, then removed here */
async function moveOne(m: Manifest, cloud: Manifest[]): Promise<{ made: Manifest; fresh: boolean }> {
  let target = cloud.find((r) => sameOrigin(m, r)), fresh = false;
  if (target) {
    if (!await completeCopy(target)) throw new Error(t('account.bring.incomplete'));
    // a copy made earlier stands for this project only while the documents are the same
    if (!await sameLegacyCopy({ ...m, created: target.created, name: target.name }, target)) throw new Error(t('account.bring.differs'));
  } else {
    for (const r of cloud) if (await sameLegacyCopy(m, r)) { target = r; break; }
  }
  if (!target) {
    const archive = tauri
      ? await (await fetch(api.exportUrl(m.id))).blob()
      : await (await local(`/api/projects/${encodeURIComponent(m.id)}/export`)).blob();
    // the person's own projects: their code was accepted when they came into this browser or this computer
    target = await importArchive(archive, undefined, { ask: null, id: m.id, ...(tauri ? { place: 'cloud' as const } : {}) });
    fresh = true;
  }
  const into = target.id, files = await here.files(m.id);
  await copyRenders(files, (path) => here.file(m.id, path), into, (path, blob) => api.writeAny(into, path, blob));
  checkWhole(files, (await api.info(into)).files);
  await here.remove(m.id);
  return { made: target, fresh };
}

/** the chosen projects moved into the account, one after the other; a failure does not stop the others, and leaves that project here */
export async function bring(projects: Manifest[], progress: (done: number, total: number, name: string) => void): Promise<Brought> {
  const out: Brought = { brought: [], skipped: [], failed: [] };
  let cloud: Manifest[];
  try { cloud = await accountProjects(); }
  catch (e) {
    out.failed = projects.map((m) => ({ id: m.id, name: m.name, error: (e as Error).message }));
    progress(projects.length, projects.length, '');
    return out;
  }
  const record = ({ made, fresh }: { made: Manifest; fresh: boolean }, m: Manifest) => {
    if (fresh) { out.brought.push(made); cloud.push(made); } else out.skipped.push(m);
  };
  for (const [i, m] of projects.entries()) {
    progress(i, projects.length, m.name);
    try {
      record(await moveOne(m, cloud), m);
    } catch (e) {
      let error = e as Error;
      // another window may have made the same copy since the first listing: taken again from a fresh one
      if (e instanceof ApiError && e.status === 409) {
        try { cloud = await accountProjects(); record(await moveOne(m, cloud), m); continue; } catch (again) { error = again as Error; }
      }
      out.failed.push({ id: m.id, name: m.name, error: error.message });
    }
  }
  progress(projects.length, projects.length, '');
  return out;
}

/**
 * The desktop app: a project of the account moved to this computer, the same
 * way as the other way round (its archive, its renders, checked, then removed
 * from the account). When a project of this computer already has its id, the
 * moved one takes a new id.
 */
export async function moveHere(m: Manifest): Promise<Manifest> {
  if (!tauri || !inAccount(m)) throw new Error('only the desktop app moves a project of the account here');
  const archive = await (await fetch(api.exportUrl(m.id))).blob();
  const id = cloudId(m.id), taken = (await api.list()).some((x) => !inAccount(x) && x.id === id);
  const made = await importArchive(archive, undefined, { ask: null, ...(taken ? {} : { id }) });
  try {
    const files = (await api.info(m.id)).files;
    await copyRenders(files, (path) => served(m.id, path), made.id, (path, blob) => api.write(made.id, path, blob));
    checkWhole(files, (await api.info(made.id)).files);
  } catch (e) {
    // the account keeps it: the partial copy here goes
    await api.remove(made.id).catch(() => {});
    throw e;
  }
  await api.remove(m.id);
  return made;
}

const offeredKey = (userId: string) => `tramme.bring.offered.${userId}`;

/** whether the offer was made to this person in this browser (it is made once; the space keeps it at hand) */
export function wasOffered(userId: string): boolean {
  try { return localStorage.getItem(offeredKey(userId)) === '1'; } catch { return true; }
}

export function markOffered(userId: string) {
  try { localStorage.setItem(offeredKey(userId), '1'); } catch { /* private browsing: offered again next time */ }
}
