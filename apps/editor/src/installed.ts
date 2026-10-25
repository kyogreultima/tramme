// The plugins installed on this device (docs/installed-plugins-roadmap.md,
// steps 1 and 2): kept where the platform allows, in the order of the
// roadmap's table. The desktop app keeps them in its folder; a browser with
// the File System Access API, in a real folder the user picked once; the
// personal mode, in the browser's own storage (made persistent); the private
// deployment, in the server's bucket. All but the picked folder answer the
// library's address (/api/library), so the existing library is this store.
// A plugin's own files (a .trammeplugin's fonts, LUTs, translations) are kept
// beside it in a companion module `<name>--files.js`.

import { signal } from '@preact/signals';
import { PROVIDER_ROUTES, recordBucket } from '@tramme/api';
import { applyOps, type Op, type ToolContext, type TrammeDoc } from '@tramme/core';
import { compareVersions, manifestOf, packInstalled, permissionsAdded, readPluginPackage, unpackInstalled, type PluginManifest } from '@tramme/project';
import { api, reach } from './api.ts';
import { folderRecords, type DirHandle } from './local/folder.ts';
import { personal } from './mode.ts';
import { prefs, setPrefs } from './settings.ts';
import { tauri } from './tauri.ts';

export type StorageKind = 'desktop' | 'folder' | 'browser' | 'server';

export interface Installed {
  /** its file in the storage: charts.js */
  file: string;
  manifest: PluginManifest;
  size: number;
  modified: string;
  /** its text: what the sandbox loads */
  code: string;
  /** its own files (from its package), by path */
  files: Map<string, Uint8Array>;
  enabled: boolean;
}

/** a name the storages take: lower case, digits, - and _, then .js */
export const FILE_NAME = /^[a-z0-9][a-z0-9_-]{0,62}\.(js|mjs)$/;
const COMPANION = /--files\.js$/;
const companionOf = (file: string) => file.replace(/\.(js|mjs)$/, '--files.js');

export const installed = signal<Installed[]>([]);
export const storageKind = signal<StorageKind>(tauri ? 'desktop' : personal ? 'browser' : 'server');
/** the persistence of the browser's storage: granted, refused, or not asked (another storage) */
export const persistence = signal<'granted' | 'refused' | 'n/a'>('n/a');
/** the picked folder's name, when the plugins are in one */
export const folderName = signal<string | null>(null);

// ── the picked folder's handle, kept between visits ──
const HANDLES = 'tramme-handles';
const idb = <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  const open = indexedDB.open(HANDLES, 1);
  open.onupgradeneeded = () => open.result.createObjectStore('handles');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => { const r = run(open.result.transaction('handles', mode).objectStore('handles')); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); };
});
type FolderHandle = DirHandle & { name: string; queryPermission?(o: { mode: string }): Promise<string>; requestPermission?(o: { mode: string }): Promise<string> };
let folder: FolderHandle | null = null;

/** the browsers that can keep the plugins in a real folder (Chrome and Edge on a computer) */
export const canPickFolder = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window && !tauri;

/** the folder the user picks for their plugins (asked once; the handle is kept) */
export async function pickFolder(): Promise<void> {
  const h = await (window as unknown as { showDirectoryPicker(o: { mode: string; id?: string }): Promise<FolderHandle> }).showDirectoryPicker({ mode: 'readwrite', id: 'tramme-plugins' });
  await idb('readwrite', (s) => s.put(h, 'plugins'));
  folder = h;
  storageKind.value = 'folder';
  folderName.value = h.name;
  await refreshInstalled();
}

/** back to the platform's own storage (the folder is left as it is) */
export async function forgetFolder(): Promise<void> {
  await idb('readwrite', (s) => s.delete('plugins')).catch(() => {});
  folder = null;
  folderName.value = null;
  storageKind.value = tauri ? 'desktop' : personal ? 'browser' : 'server';
  await refreshInstalled();
}

/** the folder's access, asked again when the browser requires it (a click must ask: false when it needs one) */
export async function folderAccess(ask = false): Promise<boolean> {
  if (!folder) return true;
  const q = await folder.queryPermission?.({ mode: 'readwrite' }) ?? 'granted';
  if (q === 'granted') return true;
  if (!ask) return false;
  return (await folder.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

/** where the plugins are, found once: a folder picked before, else the platform's storage; persistence asked where it is the browser's */
export async function startInstalled(): Promise<void> {
  if (canPickFolder()) {
    try {
      const h = await idb<FolderHandle | undefined>('readonly', (s) => s.get('plugins') as IDBRequest<FolderHandle | undefined>);
      if (h) { folder = h; storageKind.value = 'folder'; folderName.value = h.name; }
    } catch { /* no folder kept */ }
  }
  if (storageKind.value === 'browser' && navigator.storage?.persist) {
    // Safari may clear a site's storage after weeks without a visit when it is not installed as an app
    persistence.value = (await navigator.storage.persisted().catch(() => false)) || (await navigator.storage.persist().catch(() => false)) ? 'granted' : 'refused';
  }
  await refreshInstalled().catch((e) => console.error('[installed plugins]', (e as Error).message));
}

// ── the storage's four calls ──
const folderBucket = () => recordBucket(folderRecords(folder!));
async function listFiles(): Promise<{ name: string; size: number; modified: string }[]> {
  if (storageKind.value === 'folder') {
    if (!(await folderAccess())) return [];
    const out: { name: string; size: number; modified: string }[] = [];
    let cursor: string | undefined;
    do {
      const l = await folderBucket().list({ prefix: '', cursor });
      for (const o of l.objects) if (FILE_NAME.test(o.key)) out.push({ name: o.key, size: o.size, modified: o.uploaded.toISOString() });
      cursor = l.truncated ? l.cursor : undefined;
    } while (cursor);
    return out;
  }
  try { return await api.library(); } catch { return []; }
}
async function readFile(name: string): Promise<string> {
  if (storageKind.value === 'folder') { const o = await folderBucket().get(name); if (!o || !('arrayBuffer' in o)) throw new Error(`no plugin "${name}"`); return new TextDecoder().decode(await o.arrayBuffer()); }
  return api.libraryGet(name);
}
async function writeFile(name: string, code: string): Promise<void> {
  if (storageKind.value === 'folder') { await folderBucket().put(name, code, { httpMetadata: { contentType: 'text/javascript' } }); return; }
  await api.libraryPut(name, code);
}
async function removeFile(name: string): Promise<void> {
  if (storageKind.value === 'folder') { await folderBucket().delete(name); return; }
  await api.libraryDelete(name).catch(() => {});
}

/** a plugin's own files as a module of data (so every storage, made for modules, keeps them) */
const filesModule = (files: Map<string, Uint8Array>) => `// the files of a plugin's package, kept beside it by tramme\nexport const files = ${JSON.stringify(Object.fromEntries([...files].map(([k, v]) => [k, btoa(String.fromCharCode(...v))])))};\n`;
function filesOf(code: string): Map<string, Uint8Array> {
  const m = /export const files = (\{[\s\S]*\});/.exec(code);
  if (!m) return new Map();
  const o = JSON.parse(m[1]) as Record<string, string>;
  return new Map(Object.entries(o).map(([k, b]) => [k, Uint8Array.from(atob(b), (c) => c.charCodeAt(0))]));
}

/** the installed plugins read again from their storage */
export async function refreshInstalled(): Promise<void> {
  const list = await listFiles(), off = prefs.peek().pluginsOff;
  const names = new Set(list.map((f) => f.name));
  const out: Installed[] = [];
  for (const f of list) {
    // the library's components (component-<name>.js) are not plugins
    if (COMPANION.test(f.name) || f.name.startsWith('component-')) continue;
    try {
      const code = await readFile(f.name);
      const files = names.has(companionOf(f.name)) ? filesOf(await readFile(companionOf(f.name))) : new Map();
      out.push({ file: f.name, manifest: manifestOf(code, f.name), size: f.size, modified: f.modified, code, files, enabled: !off.includes(f.name) });
    } catch { /* a file that cannot be read is left out */ }
  }
  installed.value = out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

/** what an import would install, read from its text, before any of its code runs */
export interface Candidate { file: string; code: string; files: Map<string, Uint8Array>; manifest: PluginManifest; replaces: Installed | null; added: PluginManifest['permissions'] }

/** a picked or dropped file as a candidate: a .js module or a .trammeplugin package */
export async function candidateOf(f: File): Promise<Candidate> {
  let code: string, files = new Map<string, Uint8Array>();
  if (/\.trammeplugin$/i.test(f.name)) ({ module: code, files } = readPluginPackage(new Uint8Array(await f.arrayBuffer())));
  else if (/\.m?js$/i.test(f.name)) code = await f.text();
  else throw new Error(`${f.name}: a .js module or a .trammeplugin package is expected`);
  const manifest = manifestOf(code, f.name);
  // the same plugin (its id) installed already: an update, kept under its file name
  const replaces = installed.peek().find((p) => p.manifest.id === manifest.id) ?? null;
  const file = replaces?.file ?? `${manifest.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'plugin'}.js`;
  const none = { network: [], providers: [], files: [] };
  return { file, code, files, manifest, replaces, added: permissionsAdded(replaces?.manifest.permissions ?? none, manifest.permissions) };
}

/** installs a candidate the user said yes to */
export async function install(c: Candidate): Promise<void> {
  if (!FILE_NAME.test(c.file)) throw new Error(`invalid name "${c.file}"`);
  await writeFile(c.file, c.code);
  if (c.files.size) await writeFile(companionOf(c.file), filesModule(c.files));
  else if (c.replaces?.files.size) await removeFile(companionOf(c.file));
  await refreshInstalled();
}

/** a plugin's text kept in the device's storage as it is (the library tools: a project's plugin kept, one brought into a project) */
export async function installFile(file: string, code: string): Promise<void> {
  if (!FILE_NAME.test(file)) throw new Error(`invalid name "${file}"`);
  await writeFile(file, code);
  await refreshInstalled();
}
export const installedCode = (file: string) => readFile(file);

export async function uninstall(p: Installed): Promise<void> {
  await removeFile(p.file);
  if (p.files.size) await removeFile(companionOf(p.file));
  setPrefs({ pluginsOff: prefs.peek().pluginsOff.filter((x) => x !== p.file) });
  await refreshInstalled();
}

export function setEnabled(p: Installed, on: boolean): void {
  const off = prefs.peek().pluginsOff.filter((x) => x !== p.file);
  setPrefs({ pluginsOff: on ? off : [...off, p.file] });
  installed.value = installed.peek().map((x) => (x.file === p.file ? { ...x, enabled: on } : x));
}

// ── in each project (step 3) ──

/** the blob url of each installed plugin's text, kept while its text is the same (the sandbox imports a url once) */
const urls = new Map<string, { code: string; url: string }>();
function urlOf(p: Installed): string {
  const had = urls.get(p.file);
  if (had?.code === p.code) return had.url;
  if (had) URL.revokeObjectURL(had.url);
  const url = URL.createObjectURL(new Blob([p.code], { type: 'text/javascript' }));
  urls.set(p.file, { code: p.code, url });
  return url;
}

/** the installed plugins a project turned off, by id (kept in the document: the project opens the same everywhere) */
export const offIn = (doc: TrammeDoc): string[] => (Array.isArray(doc.meta?.pluginsOff) ? (doc.meta.pluginsOff as unknown[]).filter((x): x is string => typeof x === 'string') : []);

// ── permissions and failures (step 5) ──

/**
 * A tool's context as an installed plugin gets it: the requests it declared
 * (its network origins, its provider routes, reached with the user's keys
 * that it never sees), and writes under assets/ and the paths it declared
 * only. A plugin that declares nothing reaches nothing.
 */
export function permitted(ctx: ToolContext, p: Installed): ToolContext {
  const { network, providers, files } = p.manifest.permissions, name = p.manifest.name;
  const origins = network.flatMap((o) => { try { return [new URL(o).origin]; } catch { return []; } });
  const write = (path: string) => path.startsWith('assets/') || files.some((f) => path === f || path.startsWith(f.endsWith('/') ? f : `${f}/`));
  return {
    ...ctx,
    fetch: async (url, init) => {
      const u = new URL(url, location.href);
      if (u.origin === location.origin && u.pathname.startsWith('/api/')) {
        const route = u.pathname.split('/')[2] ?? '';
        if (PROVIDER_ROUTES.includes(route) && providers.includes(route)) return reach(u.pathname + u.search, init as RequestInit);
        throw new Error(`${name} did not declare the provider route "${route}" (meta.permissions.providers)`);
      }
      if (origins.includes(u.origin)) return fetch(u.href, { ...(init as RequestInit), credentials: 'omit' });
      throw new Error(`${name} did not declare ${u.origin} (meta.permissions.network)`);
    },
    writeFile: (path, data) => (write(path) ? ctx.writeFile(path, data) : Promise.reject(new Error(`${name} writes under assets/ and the paths it declared only (meta.permissions.files), not ${path}`))),
  };
}

/** the installed plugins stopped for this session after failing again and again, by id */
export const stopped = signal<ReadonlySet<string>>(new Set());
const strikes = new Map<string, number>();
/** how many failures in a row stop a plugin for the session */
export const STRIKES = 3;

/** a call of an installed plugin's tool or check, counted: three throws in a row stop it until the editor opens again (a cancel is not a failure) */
export async function counted<T>(p: Installed, run: () => Promise<T>, onStop?: (p: Installed) => void): Promise<T> {
  try {
    const out = await run();
    strikes.delete(p.manifest.id);
    return out;
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      const n = (strikes.get(p.manifest.id) ?? 0) + 1;
      strikes.set(p.manifest.id, n);
      if (n >= STRIKES && !stopped.peek().has(p.manifest.id)) { stopped.value = new Set([...stopped.peek(), p.manifest.id]); onStop?.(p); }
    }
    throw e;
  }
}

/** the installed plugins a project takes, for its sandbox: enabled on this device and in the project, and not one the project carries itself (its copy wins) */
export function installedFor(doc: TrammeDoc): { id: string; url: string; plugin: Installed }[] {
  const off = offIn(doc), own = new Set(doc.plugins ?? []);
  return installed.value
    .filter((p) => p.enabled && !stopped.value.has(p.manifest.id) && !off.includes(p.manifest.id) && !own.has(p.file.replace(/\.(js|mjs)$/, '')))
    .map((p) => ({ id: `installed:${p.file}`, url: urlOf(p), plugin: p }));
}

// ── what draws is copied into the project (step 4) ──

/** the node, effect and modifier types an installed plugin brought to the open project's registry, by kind and type (filled as they are attached) */
export const installedTypes = new Map<string, Installed>();

/** every type a document draws with: its layers', their effects', and the modifiers of any property */
export function typesOf(doc: TrammeDoc): Set<string> {
  const out = new Set<string>();
  const mods = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) mods(x); return; }
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.$mod)) for (const m of o.$mod) if (m && typeof (m as { type?: unknown }).type === 'string') out.add(`modifier:${(m as { type: string }).type}`);
    for (const x of Object.values(o)) mods(x);
  };
  for (const c of Object.values(doc.compositions)) for (const l of Object.values(c.layers)) {
    out.add(`node:${l.type}`);
    for (const e of l.effects ?? []) out.add(`effect:${e.type}`);
    mods(l.props);
    for (const e of l.effects ?? []) mods(e.props);
  }
  return out;
}

/** the asset id a plugin's copy takes in a project: its file's stem */
export const copyId = (p: Installed) => p.file.replace(/\.(js|mjs)$/, '');

/** the version of each installed plugin copied into a project, by id (the document keeps it: a newer one is offered, never applied alone) */
export const copiesIn = (doc: TrammeDoc): Record<string, string> => {
  const c = doc.meta?.installedCopies;
  return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, string>) : {};
};

/**
 * The project's plugins drawn by the sandbox, their modules never loaded on
 * the page (step 5): under the experimental flag, and always for a project
 * that carries a copy of an installed plugin (code from outside the project
 * the user did not write).
 */
export const sandboxedDoc = (doc: TrammeDoc): boolean => (doc.plugins ?? []).length > 0 && (prefs.peek().sandboxPreview || Object.keys(copiesIn(doc)).length > 0);

/** the operations that copy a plugin into a project (beside the ones that made it needed), and the files to write first */
export function copyOps(doc: TrammeDoc, p: Installed): { ops: Op[]; files: [string, Blob][] } {
  const id = copyId(p), src = `plugins/${p.file}`;
  const files: [string, Blob][] = [[src, new Blob([p.code], { type: 'text/javascript' })]];
  // its own files beside it, where its module finds them (new URL('fonts/x.woff2', import.meta.url))
  for (const [path, data] of p.files) files.push([`plugins/${path}`, new Blob([data as BlobPart])]);
  const ops: Op[] = [{ op: doc.assets[id] ? 'replace' : 'add', path: `/assets/${id}`, value: { type: 'module', src, name: p.manifest.name } }];
  if (!(doc.plugins ?? []).includes(id)) ops.push(doc.plugins ? { op: 'add', path: '/plugins/-', value: id } : { op: 'add', path: '/plugins', value: [id] });
  const copies = { ...copiesIn(doc), [p.manifest.id]: p.manifest.version };
  ops.push({ op: doc.meta.installedCopies === undefined ? 'add' : 'replace', path: '/meta/installedCopies', value: copies });
  return { ops, files };
}

/**
 * What a change needs copied: the installed plugins whose layers, effects or
 * modifiers it brings into the project (the add menu, a preset, a recipe,
 * the assistant's proposal all end in a commit). Null when it needs none.
 */
export function copiesFor(doc: TrammeDoc, ops: Op[]): { ops: Op[]; files: [string, Blob][]; names: string[] } | null {
  if (!installedTypes.size) return null;
  let next: TrammeDoc;
  try { next = applyOps(doc, ops).doc; } catch { return null; }
  const own = new Set(next.plugins ?? []), need = new Map<string, Installed>();
  // a module the project already holds by its file (a pack added from the Code section) is not copied again
  const held = new Set(Object.values(next.assets).filter((x) => x.type === 'module').map((x) => x.src));
  for (const k of typesOf(next)) { const p = installedTypes.get(k); if (p && !own.has(copyId(p)) && !held.has(`plugins/${p.file}`)) need.set(p.file, p); }
  if (!need.size) return null;
  const out = { ops: [...ops], files: [] as [string, Blob][], names: [] as string[] };
  for (const p of need.values()) {
    const c = copyOps(applyOps(doc, out.ops).doc, p);
    out.ops.push(...c.ops); out.files.push(...c.files); out.names.push(p.manifest.name);
  }
  return out;
}

/** every installed plugin in one file, to keep or to bring to another device */
export function backup(): Blob {
  const files = new Map<string, Uint8Array>();
  for (const p of installed.peek()) {
    files.set(p.file, new TextEncoder().encode(p.code));
    if (p.files.size) files.set(companionOf(p.file), new TextEncoder().encode(filesModule(p.files)));
  }
  return new Blob([packInstalled(files, { version: 1, disabled: prefs.peek().pluginsOff }) as BlobPart], { type: 'application/zip' });
}

/** a backup put back: its plugins installed (an installed one of a newer version kept), its off ones turned off */
export async function restoreBackup(f: File): Promise<number> {
  const { files, state } = unpackInstalled(new Uint8Array(await f.arrayBuffer()));
  let n = 0;
  for (const [name, data] of files) {
    const code = new TextDecoder().decode(data);
    const have = installed.peek().find((p) => p.file === name);
    if (have && !COMPANION.test(name) && compareVersions(have.manifest.version, manifestOf(code, name).version) > 0) continue;
    await writeFile(name, code);
    if (!COMPANION.test(name)) n++;
  }
  setPrefs({ pluginsOff: [...new Set([...prefs.peek().pluginsOff, ...state.disabled])] });
  await refreshInstalled();
  return n;
}
