// The phone's app (Android, see apps/desktop/plugin-device): what a finished
// file does there. A video is written to a file of the app piece by piece,
// where mediabunny's stream target says (an MP4 is patched in place), never held
// whole in memory; the file is then saved to the gallery or the downloads, or
// handed to the share sheet. Everything here is a no-op off Android: the
// platform is asked in tauri.ts, once. (The toasts and the system notice are loaded
// when they are needed: the editor's state is a browser's.)

import { signal } from '@preact/signals';
import type { StreamTarget, StreamTargetChunk } from 'mediabunny';
import { toBase64 } from '@tramme/interop';
import { t } from './i18n/index.ts';
import { platform, tauri } from './tauri.ts';

export type SaveChoice = 'gallery' | 'downloads' | 'share';

/** what the sheet offers for a file: a video or a picture goes to the gallery, the rest to the downloads; any can be shared */
export const saveChoices = (mime: string): ['gallery', 'share'] | ['downloads', 'share'] =>
  /^(video|image)\//.test(mime) ? ['gallery', 'share'] : ['downloads', 'share'];

// ── the exports folder of the app (apps/desktop/src-tauri/src/exports.rs) ──

/** one request carries at most this much */
const PART = 8 << 20;
/** what mediabunny gathers before it writes: well under a part */
const GATHER = 4 << 20;

const urlOf = (name: string, at?: number) => `/api/device/exports/${encodeURIComponent(name)}${at === undefined ? '' : `?at=${at}`}`;

async function check(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(t('device.saveFailed'));
  return res;
}

/** bytes written at a position of the export, in requests of at most PART */
async function put(name: string, data: Uint8Array, position: number): Promise<void> {
  // an empty write still goes (it creates the file)
  for (let off = 0; off === 0 || off < data.length; off += PART) {
    await check(await fetch(urlOf(name, position + off), { method: 'PUT', body: data.subarray(off, off + PART) as BodyInit }));
  }
}

/** the files the export wrote, by the blob that stands for them: saving one does not write it again */
const written = new WeakMap<Blob, string>();

/** the name of the file of the exports folder this blob was read from, if it was */
export const deviceFileOf = (blob: Blob): string | undefined => written.get(blob);

/**
 * A stream that writes what it is given, at the positions it is given, in order: a request is
 * awaited before the next one starts, so the encoder is held back when the phone is slower.
 * `finish` reads the file back as a blob.
 */
export function deviceWritable(name: string): { writable: WritableStream<StreamTargetChunk>; finish: () => Promise<Blob> } {
  const writable = new WritableStream<StreamTargetChunk>({
    // an earlier export of the same name must not leave its tail behind
    start: async () => { await fetch(urlOf(name), { method: 'DELETE' }); },
    write: (chunk) => put(name, chunk.data, chunk.position),
  });
  const finish = async () => {
    const blob = await (await check(await fetch(urlOf(name)))).blob();
    written.set(blob, name);
    return blob;
  };
  return { writable, finish };
}

/** the target of an export on the phone: a file of the exports folder, and the way to get it as a blob once finalized
 *  (mediabunny is loaded here, not at the top: this module is on every page, the encoder is not) */
export async function deviceTarget(name: string): Promise<{ target: StreamTarget; finish: () => Promise<Blob> }> {
  const { StreamTarget } = await import('mediabunny');
  const { writable, finish } = deviceWritable(name);
  return { target: new StreamTarget(writable, { chunked: true, chunkSize: GATHER }), finish };
}

// ── what to do with a finished file ──────────────────────────

export interface SavePrompt {
  /** the file, by its name in the exports folder */
  name: string;
  mime: string;
  choices: SaveChoice[];
  /** true when the file was saved or shared, false when the sheet was dismissed */
  done: (saved: boolean) => void;
}

/** the sheet asking, if any (ui/DeviceSaveSheet.tsx shows it) */
export const savePrompt = signal<SavePrompt | null>(null);

/** the file's content type, for the system: a blob without one is a plain file */
const mimeOf = (blob: Blob) => blob.type || 'application/octet-stream';

/** a blob sent to the exports folder in requests of at most PART */
async function putBlob(name: string, blob: Blob): Promise<void> {
  await fetch(urlOf(name), { method: 'DELETE' });
  for (let at = 0; at < blob.size; at += PART) await put(name, new Uint8Array(await blob.slice(at, at + PART).arrayBuffer()), at);
  if (!blob.size) await put(name, new Uint8Array(0), 0);
}

/**
 * Saving a file on the phone (download.ts saveBlob): written to the exports folder unless an export
 * already did, then the sheet asks where it goes. Resolves false when the sheet is dismissed.
 */
export async function saveOnDevice(blob: Blob, name: string): Promise<boolean> {
  let file = deviceFileOf(blob);
  if (!file) {
    try { await putBlob(name, blob); } catch (e) { (await import('./state.ts')).toast((e as Error).message, 'error'); return false; }
    file = name;
  } else if (file !== name) {
    // an export named itself; the gallery and the share sheet show the name the user's project gives it
    const renamed = await fetch(`${urlOf(file)}?as=${encodeURIComponent(name)}`, { method: 'POST' }).then((r) => r.ok, () => false);
    if (renamed) { written.set(blob, name); file = name; }
  }
  savePrompt.value?.done(false);
  return new Promise<boolean>((resolve) => {
    savePrompt.value = { name: file!, mime: mimeOf(blob), choices: saveChoices(blob.type), done: (saved) => { savePrompt.value = null; resolve(saved); } };
  });
}

/** does what the sheet's choice says with the file; throws a sentence for the user */
export async function applyChoice(p: Pick<SavePrompt, 'name' | 'mime'>, choice: SaveChoice): Promise<void> {
  if (!tauri) return;
  try {
    await tauri.core.invoke(choice === 'share' ? 'device_share' : 'device_save', { name: p.name, mime: p.mime });
  } catch {
    // the system's own reason is not for the user
    throw new Error(choice === 'share' ? t('device.shareFailed') : t('device.saveFailed'));
  }
}

// ── a long job on the phone ──────────────────────────────────

let leaving: (() => void) | null = null;
/** the exports running now (two can overlap) */
let running = 0;

/**
 * The screen stays on while an export runs, and leaving the app during it says that it stops:
 * the system is told when the page is hidden. Off Android it does nothing.
 */
export function keepAwake(on: boolean): void {
  if (platform !== 'android') return;
  running = Math.max(0, running + (on ? 1 : -1));
  const awake = running > 0;
  // told to the phone when the first export starts and when the last one ends
  if (on ? running === 1 : running === 0) tauri!.core.invoke('device_keep_awake', { on: awake }).catch(() => {});
  if (awake && !leaving) {
    leaving = () => { if (document.hidden) void import('./notify.ts').then((n) => n.notify('Tramme', t('device.exportNeedsTramme'))); };
    document.addEventListener('visibilitychange', leaving);
  } else if (!awake && leaving) {
    document.removeEventListener('visibilitychange', leaving);
    leaving = null;
  }
}

// ── the back button ──────────────────────────────────────────

/** what is open on top of a page: the menus, popovers, lists and dialogs (ui/controls.tsx), which close on Escape */
const OVERLAYS = '.menu, .popover, .modal-back, [role="listbox"], .layer-library';

/** What the back button does: closes what is open on top first, then goes back through the pages, then leaves the app. */
export function backAction(s: { overlayOpen: boolean; path: string }): 'escape' | 'history' | 'exit' {
  if (s.overlayOpen) return 'escape';
  return s.path === '/' ? 'exit' : 'history';
}

/** the system's back button, from the plugin (apps/desktop/plugin-device): the page decides what it does */
export function startBackButton(): void {
  if (platform !== 'android') return;
  tauri!.core.addPluginListener('tramme-device', 'back', () => {
    const action = backAction({ overlayOpen: !!document.querySelector(OVERLAYS), path: location.pathname });
    if (action === 'escape') (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // a page opened with nothing before it (the app started on a project) goes to the projects
    else if (action === 'history') { if (history.length > 1) history.back(); else void import('./nav.ts').then((n) => n.go('/')); }
    else tauri!.core.invoke('device_exit').catch(() => {});
  }).catch((e) => console.warn('[tramme] back button:', (e as Error).message));
}

// ── the bodies of the requests ───────────────────────────────

/** what one IPC call carries of a body (base64 makes it a third larger) */
const BODY_PART = 4 << 20;

/** the request as it leaves, without its body (read already): the app has it beforehand under `token`, if any */
export function withoutBody(req: Request, token?: string): RequestInit {
  const headers = new Headers(req.headers);
  if (token) headers.set('x-tramme-body', token);
  return { method: req.method, headers, signal: req.signal, cache: req.cache, redirect: req.redirect, credentials: req.credentials };
}

/** whether a request's body must go through the IPC: one to the app's own origin that has one */
export const carriesBody = (req: Request, origin: string): boolean =>
  req.method !== 'GET' && req.method !== 'HEAD' && new URL(req.url).origin === origin;

/**
 * Android's WebView gives the app's protocol a request without its body (apps/desktop/src-tauri/src/bodies.rs):
 * the page's fetch lays the body in the app first, through the IPC, then sends the request with its token.
 * Every fetch of the page goes through here, so no caller changes. Off Android it does nothing.
 * `part` is what one IPC call carries (a test makes it small).
 */
export function carryBodies(part = BODY_PART): void {
  if (platform !== 'android') return;
  const native = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (!carriesBody(req, location.origin)) return native(input, init);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) return native(req.url, withoutBody(req));
    const token = crypto.randomUUID();
    for (let at = 0; at < bytes.length; at += part) {
      await tauri!.core.invoke('device_body', { token, part: toBase64(bytes.subarray(at, at + part)) });
    }
    return native(req.url, withoutBody(req, token));
  };
}

// ── the system's bars ────────────────────────────────────────

/** the bars take the page's colour (theme/pref.ts writes it in theme-color), their icons dark on a light theme */
export function followBars(): void {
  if (platform !== 'android') return;
  const color = document.querySelector('meta[name="theme-color"]');
  const scheme = document.querySelector('meta[name="color-scheme"]');
  const tell = () => tauri!.core.invoke('device_bars', {
    color: color?.getAttribute('content') ?? '#090f13',
    light: scheme?.getAttribute('content') === 'light',
  }).catch(() => {});
  tell();
  const watch = new MutationObserver(tell);
  for (const meta of [color, scheme]) if (meta) watch.observe(meta, { attributes: true, attributeFilter: ['content'] });
}
