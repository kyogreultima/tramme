// Runtime page driven by the CLI through Puppeteer: loads one document,
// validates it, loads its assets and exposes window.TRAMME.
//   /__tramme/?doc=/project/film.tramme.json[&comp=main][&sandbox=0]
// With plugins in the project, the whole frame is evaluated and drawn in the
// plugin sandbox's worker (docs/evaluator-sandbox.md): the page ships the
// document and each video asset's decoded frame, and one picture comes back.

import type { TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { addParts, encodeWav, formatParts, mixComposition, noParts, perFrame, Renderer, type FrameParts, type RenderOptions } from '@tramme/render';
import { blitSandboxFrame, ensureDeclared, ensureSandboxDoc, pluginItemsOf, sandboxVideoFrames } from '../../../apps/editor/src/plugins/sandbox-draw.ts';
import { browserHost, type PluginHost } from '../../../apps/editor/src/plugins/host.ts';

const q = new URLSearchParams(location.search);
const docUrl = new URL(q.get('doc') || '', location.href).href;
const sandboxOn = q.get('sandbox') !== '0';
let renderer: Renderer;
let currentDoc: TrammeDoc | null = null;
let sandbox: PluginHost | null = null;

async function init() {
  const r = await fetch(docUrl);
  if (!r.ok) throw new Error(`document not found: ${docUrl}`);
  currentDoc = (await r.json()) as TrammeDoc;
  renderer = await Renderer.open(currentDoc, builtinRegistry(), docUrl, document.getElementById('out') as HTMLCanvasElement, { compId: q.get('comp') || currentDoc.root });
}

/** the sandbox host, when the document carries plugins and the flag is not off */
async function sandboxReady(): Promise<PluginHost | null> {
  const doc = currentDoc;
  if (!sandboxOn || !doc || !(doc.plugins ?? []).length) return null;
  sandbox ??= browserHost(docUrl);
  // the document's plugins loaded in the worker first (a url it knows is not loaded again), as the editor does
  await ensureDeclared(sandbox, pluginItemsOf(doc, docUrl));
  ensureSandboxDoc(sandbox, {
    doc, docUrl,
    loaded: (id) => { try { return renderer.assets.get(id); } catch { return null; } },
  });
  return sandbox;
}

/** the sandbox's finished picture for frame f, its videos decoded on the page */
async function sandboxFrame(f: number): Promise<OffscreenCanvas> {
  const sb = await sandboxReady();
  if (!sb) throw new Error('the sandbox is off');
  const time = f / renderer.comp.fps;
  const videos = await sandboxVideoFrames(renderer, currentDoc!, time);
  const c = currentDoc!.compositions[renderer.compId];
  const pic = await sb.renderFrame({ compId: renderer.compId, t: time, scale: 1, width: c.width, height: c.height, videos });
  if (pic.err) throw new Error(pic.err);
  if (!pic.bitmap) throw new Error(`frame ${f} drew nothing in the sandbox`);
  return pic.bitmap as OffscreenCanvas;
}

const canvas = () => document.getElementById('out') as HTMLCanvasElement;

const dataUrl = (c: HTMLCanvasElement, type = 'image/png', quality?: number) => new Promise<string>((resolve, reject) => c.toBlob((b) => {
  if (!b) return reject(new Error('toBlob failed'));
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result as string);
  fr.readAsDataURL(b);
}, type, quality));

const api = {
  ready: init(),
  info() {
    const c = renderer.comp;
    return {
      title: renderer.doc.meta.title, comp: renderer.compId,
      width: c.width, height: c.height, fps: c.fps, duration: c.duration,
      frames: Math.round(c.duration * c.fps), markers: c.markers || [],
    };
  },
  /** switch to another version of the document (validated, new assets loaded) */
  async load(doc: TrammeDoc, compId?: string) {
    currentDoc = doc;
    await renderer.setDoc(doc, { compId: compId || doc.root });
    return api.info();
  },
  /** PNG of one frame as a data URL; maxWidth scales it down (previews for the assistant) */
  async still(t: number, opts: RenderOptions = {}, maxWidth?: number): Promise<string> {
    if (await sandboxReady()) {
      blitSandboxFrame(renderer, await sandboxFrame(Math.round(t * renderer.comp.fps)), t, false);
      const out = canvas();
      if (!maxWidth || out.width <= maxWidth) return dataUrl(out);
      const k = maxWidth / out.width, small = document.createElement('canvas');
      small.width = Math.round(out.width * k); small.height = Math.round(out.height * k);
      const ctx = small.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(out, 0, 0, small.width, small.height);
      return dataUrl(small);
    }
    await renderer.renderComplete(t, opts);
    const out = canvas();
    if (!maxWidth || out.width <= maxWidth) return dataUrl(out);
    const k = maxWidth / out.width, small = document.createElement('canvas');
    small.width = Math.round(out.width * k); small.height = Math.round(out.height * k);
    const ctx = small.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(out, 0, 0, small.width, small.height);
    return dataUrl(small);
  },
  /** the sound over [from, to] through the mixer of the editor, as a WAV in base64; null when there is none */
  async mix(from: number, to: number): Promise<string | null> {
    const buf = await mixComposition(renderer.doc, renderer.compId, (id) => renderer.assets.url(id), { from, to });
    if (!buf) return null;
    const bytes = encodeWav(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  /** stream frames [f0, f1) over the WebSocket: 'yuv' (4:2:0 BT.709) or 'rgba' (straight alpha); returns ms per frame, and its parts */
  async capture(f0: number, f1: number, opts: RenderOptions = {}, kind: 'yuv' | 'rgba' | 'rgba64' = 'yuv', sink?: string): Promise<{ ms: number; parts: FrameParts }> {
    const { width: W, height: H, fps } = renderer.comp;
    const ws = new WebSocket(`ws://${location.host}/__tramme/ws${sink ? `?sink=${encodeURIComponent(sink)}` : ''}`);
    ws.binaryType = 'arraybuffer';
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let waiting: (() => void) | null = null;
    ws.onmessage = () => { const r = waiting; waiting = null; r?.(); };
    const size = kind === 'rgba64' ? W * H * 8 : kind === 'rgba' ? W * H * 4 : (W * H * 3) / 2;
    const bufs = [new Uint8Array(size), new Uint8Array(size)];
    // 16 bits a channel, little-endian as the page's typed arrays are (ffmpeg rgba64le)
    const wide = kind === 'rgba64' ? bufs.map((b) => new Uint16Array(b.buffer)) : null;
    const t0 = performance.now();
    // where the time goes: the renderer counts evaluation, drawing and video; readback and send are counted here
    const parts = noParts();
    renderer.times = noParts();
    const progress = (window as any).__trammeProgress as ((done: number, total: number) => void) | undefined;
    let inflight: Promise<void> | null = null;
    for (let f = f0; f < f1; f++) {
      if (await sandboxReady()) {
        blitSandboxFrame(renderer, await sandboxFrame(f), f / fps, false);
      } else {
        await renderer.renderComplete(f / fps, { ...opts, toFbo: true });
        // a frame whose pictures never came (see SETTLE_LIMIT): the export stops rather than carry a wrong picture
        if (renderer.late) { ws.close(); throw new Error(`frame ${f} (${(f / fps).toFixed(2)} s) never finished: a video frame or a plugin picture did not come`); }
      }
      const buf = bufs[f & 1];
      const r0 = performance.now();
      if (wide) renderer.compositor.readRGBA16(wide[f & 1]);
      else if (kind === 'rgba') renderer.compositor.readRGBA(buf, renderer.lastSeed);
      else renderer.compositor.readYUV(buf, renderer.lastSeed);
      const s0 = performance.now();
      parts.readback += s0 - r0;
      if (inflight) await inflight; // one frame in flight while the next renders
      parts.send += performance.now() - s0;
      inflight = new Promise((r) => { waiting = r; });
      ws.send(buf);
      progress?.(f - f0 + 1, f1 - f0);
      if ((f - f0) % 30 === 29 || f === f1 - 1) {
        const n = f - f0 + 1;
        const sofar = addParts({ ...parts }, renderer.times);
        console.log(`image ${f + 1}/${f1}  ${((performance.now() - t0) / n).toFixed(0)} ms/image  (${formatParts(sofar, n)})`);
      }
    }
    const s1 = performance.now();
    if (inflight) await inflight;
    parts.send += performance.now() - s1;
    ws.close();
    const n = Math.max(1, f1 - f0);
    return { ms: (performance.now() - t0) / n, parts: perFrame(addParts(parts, renderer.times), n) };
  },
};

(window as any).TRAMME = api;
api.ready.catch((e) => console.error('[tramme]', e?.stack || e));
