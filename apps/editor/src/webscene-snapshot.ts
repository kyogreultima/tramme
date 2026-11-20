// Pictures of web scenes for the renders the editor makes away from the live view: the assistant's
// stills, the storyboard and the exports. An iframe's pixels cannot be read back, so each scene is
// asked for its own picture: in a hidden frame of its own (the same sandboxed document the viewport
// shows), it seeks to the instant, freezes its page as an SVG foreignObject and sends that drawing
// back as an ImageBitmap (webscene-frame.ts). The webscene node draws it (setWebSceneSource); while
// a picture is on its way the node defers, and those renders draw the frame again once it has come.
//
// The live view shows a scene of the composition on screen in its overlay (WebSceneFrames). Every
// other scene it draws (one inside a nested composition) is drawn from these pictures too: the last
// one the scene gave while the next is on its way, one asked at a time per scene, so a playback
// never piles up requests and the view is drawn again when a picture comes.

import { setWebSceneSource, type WebSceneAsk, type WebSceneShot } from '@tramme/nodes';
import type { TrammeDoc } from '@tramme/core';
import { SCENE_FRAME_SANDBOX } from './webscene-frame.ts';
import { liveScenes, sceneDocument, sceneRevision } from './webscene-preview.ts';

/** how long a scene may take to load, then to give one picture */
const LOAD_LIMIT = 30_000;
const SHOT_LIMIT = 20_000;
/** pictures kept (an export asks for each frame once; a still asks again for the same instant), about 8 MB each in 1080p */
const KEEP = 12;

interface Frame { el: HTMLIFrameElement; loaded: Promise<void>; style: string }

const frames = new Map<string, Frame>();
const waiting = new Map<number, { resolve(b: ImageBitmap): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
let seq = 0;
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  addEventListener('message', (event) => {
    const d = event.data as { kind?: string; id?: number; bitmap?: ImageBitmap; message?: string } | null;
    if (!d || typeof d !== 'object' || typeof d.id !== 'number') return;
    const w = waiting.get(d.id);
    // only an answer from one of our own frames counts
    if (!w || ![...frames.values()].some((f) => f.el.contentWindow === event.source)) return;
    waiting.delete(d.id);
    clearTimeout(w.timer);
    if (d.kind === 'snapshot' && d.bitmap) w.resolve(d.bitmap);
    else w.reject(new Error(String(d.message ?? 'the scene gave no picture').slice(0, 300)));
  });
}

/** what the scene's document is made of besides its files: the tokens and fonts (a change builds the frame again) */
const styleOf = (doc: TrammeDoc) => JSON.stringify([doc.tokens, Object.values(doc.assets).filter((a) => a.type === 'font')]);

/** the hidden frame of a scene at a size, its document built from the project's files */
function frameFor(projectId: string, doc: TrammeDoc, folder: string, size: [number, number]): Frame {
  const key = `${projectId}|${folder}|${sceneRevision.peek()}|${size[0]}x${size[1]}`, style = styleOf(doc);
  const have = frames.get(key);
  if (have && have.style === style) return have;
  if (have) { have.el.remove(); frames.delete(key); }
  // frames of an older version of the scene go
  for (const [k, f] of frames) if (k.startsWith(`${projectId}|${folder}|`)) { f.el.remove(); frames.delete(k); }
  const el = document.createElement('iframe');
  el.setAttribute('sandbox', SCENE_FRAME_SANDBOX);
  el.setAttribute('referrerpolicy', 'no-referrer');
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  // laid out at the scene's size (its page reads its viewport), never seen nor reached
  el.style.cssText = `position:fixed;left:0;top:0;width:${size[0]}px;height:${size[1]}px;border:0;opacity:0;pointer-events:none;z-index:-1;contain:strict`;
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { removeEventListener('message', heard); reject(new Error('the scene did not load in time')); }, LOAD_LIMIT);
    const heard = (event: MessageEvent) => {
      if (event.source !== el.contentWindow || !event.data || typeof event.data !== 'object' || 'id' in event.data) return;
      if (event.data.kind === 'ready') { clearTimeout(timer); removeEventListener('message', heard); resolve(); }
      else if (event.data.kind === 'error') { clearTimeout(timer); removeEventListener('message', heard); reject(new Error(String(event.data.message).slice(0, 300))); }
    };
    addEventListener('message', heard);
    sceneDocument(projectId, doc, folder).then(({ srcdoc }) => { el.srcdoc = srcdoc; document.body.appendChild(el); })
      .catch((error: Error) => { clearTimeout(timer); removeEventListener('message', heard); reject(error); });
  });
  const frame = { el, loaded, style };
  frames.set(key, frame);
  loaded.catch(() => { if (frames.get(key) === frame) { el.remove(); frames.delete(key); } });
  return frame;
}

/** the scene's picture at t with these parameters, at the layer's size */
export async function snapshotScene(projectId: string, doc: TrammeDoc, ask: WebSceneAsk): Promise<ImageBitmap> {
  listen();
  const size: [number, number] = [Math.round(ask.size[0]), Math.round(ask.size[1])];
  const frame = frameFor(projectId, doc, ask.folder, size);
  await frame.loaded;
  const id = ++seq;
  return new Promise<ImageBitmap>((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('the scene gave no picture in time')); }, SHOT_LIMIT);
    waiting.set(id, { resolve, reject, timer });
    frame.el.contentWindow!.postMessage({ kind: 'snapshot', id, t: ask.t, params: ask.params, width: size[0], height: size[1] }, '*');
  });
}

/** the longest side of a scene's still for the assistant */
const STILL_SIDE = 960;

/**
 * Stills of a scene alone, at its start, middle and end (or the times given), as JPEG data URLs
 * at most 960 pixels on their longest side: what check_scene shows the assistant.
 */
export async function sceneStills(projectId: string, doc: TrammeDoc, folder: string, manifest: { duration: number; size: [number, number] }, times?: number[]): Promise<{ url: string; caption: string }[]> {
  const at = times ?? [0, manifest.duration / 2, Math.max(0, manifest.duration - 1 / 30)];
  const out: { url: string; caption: string }[] = [];
  for (const t of at) {
    const bitmap = await snapshotScene(projectId, doc, { folder, t, size: manifest.size, params: {} });
    try {
      const k = Math.min(1, STILL_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * k); canvas.height = Math.round(bitmap.height * k);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      out.push({ url: canvas.toDataURL('image/jpeg', 0.86), caption: `${folder} · ${t.toFixed(2)} s` });
    } finally { bitmap.close(); }
  }
  return out;
}

// ── the source the webscene node reads ──

let scope: { projectId: string; doc: TrammeDoc } | null = null;
let depth = 0;
const shots = new Map<string, ImageBitmap | Error>();
const coming = new Map<string, Promise<void>>();
/** per scene (project|folder): the key of the last picture it gave, drawn while the next is on its way */
const lastOf = new Map<string, string>();
/** per scene: the picture the live view wants next (only the latest counts), and whether one is being made */
const nextOf = new Map<string, { view: LiveView; ask: WebSceneAsk; key: string }>();
const making = new Map<string, Promise<void>>();

/** what the live view gives: the open project and the document on screen */
export interface LiveView { projectId: string; doc: TrammeDoc }
let liveView: (() => LiveView | null) | null = null;
/** the preview says what it shows (preview.ts) */
export function setSceneLiveView(view: (() => LiveView | null) | null) { liveView = view; }

const shotKey = (projectId: string, a: WebSceneAsk) =>
  `${projectId}|${a.folder}|${sceneRevision.peek()}|${a.t.toFixed(4)}|${Math.round(a.size[0])}x${Math.round(a.size[1])}|${JSON.stringify(a.params)}`;

function keep(key: string, value: ImageBitmap | Error) {
  shots.set(key, value);
  // the oldest go first, except a scene's last picture: the live view still draws it
  const lasts = new Set(lastOf.values());
  for (const [k, v] of shots) {
    if (shots.size <= KEEP) break;
    if (lasts.has(k)) continue;
    if (v instanceof ImageBitmap) v.close();
    shots.delete(k);
  }
}

/** an export or a still: the picture at that very instant, waited for */
function exactShot(projectId: string, doc: TrammeDoc, ask: WebSceneAsk): WebSceneShot {
  const key = shotKey(projectId, ask);
  const have = shots.get(key);
  if (have) return have;
  let wait = coming.get(key);
  if (!wait) {
    wait = snapshotScene(projectId, doc, ask)
      .then((bitmap) => { keep(key, bitmap); lastOf.set(`${projectId}|${ask.folder}`, key); }, (error: Error) => keep(key, error))
      .finally(() => coming.delete(key));
    coming.set(key, wait);
  }
  return wait;
}

/**
 * The live view: the picture at the instant if made, else the scene's last one (null the first
 * time: its placeholder) with the wait for the new one, so the view is drawn again when it comes.
 */
function liveShot(view: LiveView, ask: WebSceneAsk): WebSceneShot {
  const key = shotKey(view.projectId, ask);
  const have = shots.get(key);
  if (have) return have;
  const scene = `${view.projectId}|${ask.folder}`;
  nextOf.set(scene, { view, ask, key });
  let wait = making.get(scene);
  if (!wait) { wait = make(scene).finally(() => making.delete(scene)); making.set(scene, wait); }
  const last = lastOf.get(scene), stale = last ? shots.get(last) : undefined;
  return { last: stale instanceof ImageBitmap ? stale : null, wait };
}

/** one picture at a time per scene, always the latest asked: a playback skips the instants it has passed */
async function make(scene: string) {
  for (let n = nextOf.get(scene); n; n = nextOf.get(scene)) {
    nextOf.delete(scene);
    if (shots.has(n.key)) continue;
    try { keep(n.key, await snapshotScene(n.view.projectId, n.view.doc, n.ask)); lastOf.set(scene, n.key); }
    catch (error) { keep(n.key, error as Error); }
  }
}

setWebSceneSource((ask) => {
  if (scope) return exactShot(scope.projectId, scope.doc, ask);
  // a scene the view shows in its overlay draws nothing on the canvas
  if (liveScenes.has(ask.folder)) return null;
  const view = liveView?.();
  return view ? liveShot(view, ask) : null;
});

/**
 * Runs a render that should show web scenes as pictures (a still, an export): while it runs, the
 * webscene node draws each scene from its own frame instead of the live view's stand-in.
 */
export async function withSceneCapture<T>(projectId: string, doc: TrammeDoc, run: () => Promise<T>): Promise<T> {
  const before = scope;
  scope = { projectId, doc };
  depth++;
  try { return await run(); }
  finally {
    depth--;
    scope = depth ? scope : before;
    // a failed picture is asked again next time (the scene may have been fixed)
    for (const [k, v] of shots) if (v instanceof Error) shots.delete(k);
  }
}

/** the frames and pictures go when the project closes */
export function disposeSceneCapture() {
  for (const f of frames.values()) f.el.remove();
  frames.clear();
  for (const v of shots.values()) if (v instanceof ImageBitmap) v.close();
  shots.clear();
  lastOf.clear();
  nextOf.clear();
}
