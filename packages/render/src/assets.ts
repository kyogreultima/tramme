// Loads every asset of a document before the first frame, so rendering
// never waits and never depends on timing. Paths resolve against the
// document's URL. sync() follows edits: only new or changed assets load.

import { parseCube, type Asset, type TrammeDoc } from '@tramme/core';
import { VideoFrames } from './video.ts';

/** the longest side, in pixels, of an SVG drawn without a size of its own */
const SVG_RASTER = 2048;
/** how long the page's own fonts (its CSS) are waited for once the document's are loaded */
const FONTS_WAIT_MS = 3000;
const MODEL_LIMIT = 32 * 1024 * 1024;
const FONT_LIMIT = 16 * 1024 * 1024;
const DATA_LIMIT = 8 * 1024 * 1024;
const IMAGE_LIMIT = 32 * 1024 * 1024;
const MAX_ACTIVE_ASSETS = 8;
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
/** the decoded pixels kept at once: the isolated project's (what the sandbox can take) and the trusted page's (768 MB) */
const MAX_RETAINED_IMAGE_PIXELS = 64 * 1024 * 1024;
const RETAINED_IMAGE_PIXELS = 192 * 1024 * 1024;
const MAX_IMAGE_SIDE = 8192;
const MAX_PROJECT_ASSETS = 4096;

async function boundedBytes(response: Response, limit: number, label: string): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > limit) { void response.body?.cancel(); throw new Error(`${label} exceeds ${limit / 1048576} MB`); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${label} requires a streamed response`);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { void reader.cancel(); throw new Error(`${label} exceeds ${limit / 1048576} MB`); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes.buffer as ArrayBuffer;
}

/** the proportions of an SVG from its viewBox (1:1 when it has none) */
export function viewBoxSize(svg: string): [number, number] {
  const m = /<svg\b[^>]*\bviewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i.exec(svg);
  const w = m ? Number(m[1]) : NaN, h = m ? Number(m[2]) : NaN;
  return w > 0 && h > 0 ? [w, h] : [1, 1];
}

/** the SVG with a size of its own (width and height on its root), so it decodes as any picture */
export function withSize(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b([^>]*)>/i, (_, attrs: string) => `<svg${attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '')} width="${width}" height="${height}">`);
}

/** an SVG without a size of its own (most logos), which Chrome will not turn into a bitmap as it is: drawn in its viewBox's proportions, large enough to stay sharp */
async function svgBitmap(url: string): Promise<ImageBitmap> {
  const text = await (await fetch(url)).text();
  const [vw, vh] = viewBoxSize(text), k = SVG_RASTER / Math.max(vw, vh);
  const blob = URL.createObjectURL(new Blob([withSize(text, Math.round(vw * k), Math.round(vh * k))], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = blob;
    await img.decode();
    return await createImageBitmap(img);
  } finally { URL.revokeObjectURL(blob); }
}

/** a picture brought down on decode still says what it was: the nodes lay it out from the original's size (a source box, a scale of one) and draw the smaller bitmap over it */
function withNaturalSize<T extends object>(bitmap: T, width: number, height: number): T {
  Object.defineProperties(bitmap, { naturalWidth: { value: width }, naturalHeight: { value: height } });
  return bitmap;
}

/** what a node draws for a picture still on its way: nothing */
function blankImage(): unknown {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : (document.createElement('canvas') as HTMLCanvasElement);
  c.width = 1; c.height = 1;
  return c;
}

export class AssetStore {
  private loaded = new Map<string, { key: string; entry: Asset; value: unknown }>();
  private doc: TrammeDoc;
  private base: string;
  /** bumped when a module reloads, so a changed plugin file is imported again */
  private version = 0;
  /** a font of the page stayed loading past FONTS_WAIT_MS: not waited for again */
  private pageFontsStuck = false;
  /** the sandbox owns project code: no module asset is imported by the trusted page */
  sandboxModules = false;
  /** a video with a proxy plays its proxy (the editor's preview, when its setting asks); exports always read the original */
  useProxies = false;
  /** the assets whose file could not be loaded (id → why), kept by `sync(…, tolerate)`: the preview shows them offline and goes on, an export refuses */
  readonly offline = new Map<string, string>();
  /** what each failed asset was when it failed: it is not asked for again until it changes or is reloaded */
  private failed = new Map<string, string>();

  private imagePixels(entry: Asset, value: unknown): number {
    if (entry.type !== 'image' || !value || typeof value !== 'object') return 0;
    const image = value as { width?: number; height?: number };
    return Number(image.width) * Number(image.height) || 0;
  }

  /** the decoded pixels the loaded images hold, those of `except` not counted */
  private retainedPixels(except?: string): number {
    let sum = 0;
    for (const [id, old] of this.loaded) if (id !== except) sum += this.imagePixels(old.entry, old.value);
    return sum;
  }

  // ── a project heavier than the room ──
  // Pictures are kept decoded up to a budget of pixels. Past it the rest wait
  // (cold) and come when a frame asks for them, the pictures not shown in that
  // frame making room in least-recently-used order: a project of any weight
  // plays, as the frames it shows at one time fit.

  /** the longest side a picture is kept at: a larger one is brought down as it is decoded (the renderer sets it from its compositions' size) */
  keptSide = MAX_IMAGE_SIDE;
  /** images not kept for lack of room: id → what it was */
  private cold = new Map<string, string>();
  /** the last use of each image (a counter), and the frame it was last used in */
  private touched = new Map<string, number>();
  private usedIn = new Map<string, number>();
  private tick = 0;
  private frameNo = 0;
  private asking = new Map<string, Promise<void>>();
  private blank: unknown = null;

  private get budget(): number { return this.sandboxModules ? MAX_RETAINED_IMAGE_PIXELS : RETAINED_IMAGE_PIXELS; }

  /** a new frame begins: what it uses is not made room from */
  beginFrame(): void { this.frameNo++; }

  /** whether some images wait for a frame to ask for them */
  get hasCold(): boolean { return this.cold.size > 0; }

  /** the images that are not kept (their ids) */
  coldIds(): string[] { return [...this.cold.keys()]; }
  isCold(id: string): boolean { return this.cold.has(id) && !this.loaded.has(id); }

  /**
   * An image for a node drawing a frame. Kept: itself. Waiting or sent away:
   * a blank picture now, and the load handed to `defer` (the frame is drawn
   * again once it has come, as it is for a video frame).
   */
  use<T>(id: string, defer: (p: Promise<unknown>) => void): T {
    const e = this.loaded.get(id);
    if (e) { this.touched.set(id, ++this.tick); this.usedIn.set(id, this.frameNo); return e.value as T; }
    const a = this.doc.assets[id];
    if (a?.type === 'image' && a.of === undefined && this.failed.get(id) !== this.keyOf(a)) {
      this.usedIn.set(id, this.frameNo);
      defer(this.request(id));
      return (this.blank ??= blankImage()) as T;
    }
    return this.get<T>(id);
  }

  /** loads an image on demand (once at a time), making room for it */
  request(id: string): Promise<void> {
    let p = this.asking.get(id);
    if (!p) {
      const a = this.info(id), key = this.keyOf(a);
      p = (async () => {
        try {
          const value = await this.load(id, a);
          if (this.doc.assets[id] === a) this.keep(id, a, key, value, true);
          else this.release(a, value);
        } catch (e) { this.failed.set(id, key); this.offline.set(id, (e as Error).message); } finally { this.asking.delete(id); }
      })();
      this.asking.set(id, p);
    }
    return p;
  }

  /** the pictures not used since `frameNo` began, the longest unused first, set aside until `px` more fit; false when they cannot */
  private makeRoom(px: number, except: string): boolean {
    const order = [...this.loaded.entries()].filter(([id, v]) => id !== except && v.entry.type === 'image' && this.usedIn.get(id) !== this.frameNo)
      .sort((x, y) => (this.touched.get(x[0]) ?? 0) - (this.touched.get(y[0]) ?? 0));
    let held = this.retainedPixels(except);
    for (const [id, old] of order) {
      if (held + px <= this.budget) break;
      held -= this.imagePixels(old.entry, old.value);
      this.release(old.entry, old.value);
      this.loaded.delete(id);
      this.cold.set(id, old.key);
    }
    return held + px <= this.budget;
  }

  /** an image decoded: kept when it fits (after making room, when asked to), else waits cold */
  private keep(id: string, a: Asset, key: string, value: unknown, evict: boolean): boolean {
    const px = this.imagePixels(a, value), old = this.loaded.get(id);
    if (old) { this.release(old.entry, old.value); this.loaded.delete(id); }
    if (this.retainedPixels(id) + px > this.budget && !(evict && this.makeRoom(px, id))) {
      this.release(a, value);
      this.cold.set(id, key);
      return false;
    }
    this.cold.delete(id);
    this.loaded.set(id, { key, entry: a, value });
    this.offline.delete(id); this.failed.delete(id);
    this.touched.set(id, ++this.tick);
    return true;
  }

  private release(entry: Asset, value: unknown): void {
    if (entry.type === 'image') (value as { close?: () => void } | null)?.close?.();
    if (entry.type === 'video') (value as { dispose?: () => void } | null)?.dispose?.();
  }

  /** what a loaded asset is kept under: its entry, and for a video with a proxy, which of the two plays */
  private keyOf(a: Asset): string {
    return JSON.stringify(a) + (this.proxyOf(a) ? '|proxy' : '');
  }

  /** the proxy a video plays instead of itself, if it has one and proxies are on */
  private proxyOf(a: Asset): string | null {
    return this.useProxies && a.type === 'video' && a.proxy && this.doc.assets[a.proxy]?.type === 'video' ? a.proxy : null;
  }

  constructor(doc: TrammeDoc, docUrl: string) {
    this.doc = doc;
    this.base = docUrl;
  }

  info(id: string): Asset {
    const a = this.doc.assets[id];
    if (!a) throw new Error(`unknown asset: ${id}`);
    return a;
  }

  url(id: string): string {
    return new URL(this.info(id).src, this.base).href;
  }

  get<T>(id: string): T {
    const e = this.loaded.get(id);
    if (!e) throw new Error(`asset not loaded: ${id}`);
    return e.value as T;
  }

  has(id: string) { return this.loaded.has(id); }

  private assertProjectUrl(url: string): void {
    if (!this.sandboxModules) return;
    const target = new URL(url), base = new URL(this.base);
    const root = new URL('./', base);
    const projectFile = target.origin === base.origin && target.pathname.startsWith(root.pathname);
    const localBlob = target.protocol === 'blob:' && target.origin === base.origin;
    if (!projectFile && !localBlob) throw new Error('asset must belong to this project');
  }

  /** load what the document needs and is not loaded yet; `reload` forces some ids (a module edited on disk) */
  async sync(doc: TrammeDoc, reload: string[] = [], tolerate = false): Promise<void> {
    const entries = Object.entries(doc.assets);
    if (this.sandboxModules && entries.length > MAX_PROJECT_ASSETS) throw new Error(`isolated project exceeds ${MAX_PROJECT_ASSETS} assets`);
    this.doc = doc;
    for (const [id, old] of this.loaded) if (!doc.assets[id]) { this.release(old.entry, old.value); this.loaded.delete(id); }
    for (const id of [...this.offline.keys()]) if (!doc.assets[id]) { this.offline.delete(id); this.failed.delete(id); }
    for (const id of [...this.cold.keys()]) if (!doc.assets[id]) this.cold.delete(id);
    const refused: string[] = [];
    if (reload.length) this.version++;
    for (let start = 0; start < entries.length; start += MAX_ACTIVE_ASSETS) await Promise.all(entries.slice(start, start + MAX_ACTIVE_ASSETS).map(async ([id, a]) => {
      // a sub-clip is a range of another asset, no file of its own
      if (a.of !== undefined) { const old = this.loaded.get(id); if (old) this.release(old.entry, old.value); this.loaded.delete(id); return; }
      // A non-plugin module can be an unused asset or a Free code layer. Neither
      // may import into the trusted page while isolation is selected.
      if (this.sandboxModules && a.type === 'module') { const old = this.loaded.get(id); if (old) this.release(old.entry, old.value); this.loaded.delete(id); return; }
      const have = this.loaded.get(id);
      if (have && !reload.includes(id)) {
        const key = this.keyOf(a);
        if (have.entry === a && have.key === key) return;
        if (have.key === key) { have.entry = a; return; }
      }
      const key = this.keyOf(a);
      if (tolerate && this.failed.get(id) === key && !reload.includes(id)) return;
      // not kept for lack of room, and unchanged: it waits for a frame to ask
      if (a.type === 'image' && this.cold.get(id) === key && !reload.includes(id)) return;
      try {
        const value = await this.load(id, a);
        if (a.type === 'image') {
          // an image the budget cannot hold waits cold (no error): a frame that shows it asks for it
          this.keep(id, a, key, value, false);
        } else {
          if (have) this.release(have.entry, have.value);
          this.loaded.set(id, { key, entry: a, value });
          this.offline.delete(id); this.failed.delete(id);
        }
      } catch (e) {
        const why = `asset "${id}" (${a.src}): ${(e as Error).message}`;
        if (have) this.release(have.entry, have.value);
        this.loaded.delete(id);
        if (!tolerate) { refused.push(why); return; }
        this.offline.set(id, (e as Error).message); this.failed.set(id, key);
      }
    }));
    if (refused.length) throw new Error(refused.join('\n'));
    // the document's fonts are loaded above, one by one; the page's own (its
    // CSS) are waited for a moment only: Chrome may leave one of them loading
    // for good, and the preview would never open (nor wait again at each edit)
    if (this.pageFontsStuck) return;
    const settled = await Promise.race([document.fonts.ready.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), FONTS_WAIT_MS))]);
    if (!settled) this.pageFontsStuck = true;
  }

  private async load(id: string, a: Asset): Promise<unknown> {
    const url = this.url(id);
    this.assertProjectUrl(url);
    switch (a.type) {
      case 'image': {
        // an ImageBitmap, not the <img>: Chrome resamples an <img> with its
        // own filter when it is scaled down, a bitmap like any canvas pixels
        let source = url;
        if (this.sandboxModules) {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          source = URL.createObjectURL(new Blob([await boundedBytes(response, IMAGE_LIMIT, 'image')], { type: response.headers.get('content-type') || 'application/octet-stream' }));
        }
        try {
          const img = new Image();
          img.src = source;
          await img.decode();
          const w = img.naturalWidth, h = img.naturalHeight;
          if (this.sandboxModules && (!w || !h)) throw new Error('the picture has no size');
          // kept no larger than the frames can show (and, isolated, than the sandbox takes): brought down as it is decoded
          const k = w && h ? Math.min(1, this.keptSide / Math.max(w, h), this.sandboxModules ? Math.sqrt(MAX_IMAGE_PIXELS / (w * h)) : 1) : 1;
          const resize = k < 1 ? { resizeWidth: Math.max(1, Math.floor(w * k)), resizeHeight: Math.max(1, Math.floor(h * k)), resizeQuality: 'high' as const } : undefined;
          try { const bitmap = await (resize ? createImageBitmap(img, resize) : createImageBitmap(img)); return resize ? withNaturalSize(bitmap, w, h) : bitmap; } catch (e) { if (!/svg/i.test((e as Error).message)) throw e; }
          return await svgBitmap(source);
        } finally { if (source !== url) URL.revokeObjectURL(source); }
      }
      case 'font': {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const family = a.family || id;
        const bytes = this.sandboxModules ? await boundedBytes(r, FONT_LIMIT, 'font') : await r.arrayBuffer();
        const face = new FontFace(family, bytes, { weight: a.weight || '400', style: a.style || 'normal' });
        await face.load();
        document.fonts.add(face);
        return family;
      }
      case 'module':
        return import(/* @vite-ignore */ this.version ? `${url}${url.includes('?') ? '&' : '?'}v=${this.version}` : url);
      case 'model': {
        const r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok) throw new Error(`model: HTTP ${r.status}`);
        const declared = Number(r.headers.get('content-length'));
        if (declared > MODEL_LIMIT) { void r.body?.cancel(); throw new Error('model exceeds 32 MB'); }
        const reader = r.body?.getReader();
        if (!reader) {
          const bytes = await r.arrayBuffer();
          if (bytes.byteLength > MODEL_LIMIT) throw new Error('model exceeds 32 MB');
          return bytes;
        }
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MODEL_LIMIT) { void reader.cancel(); throw new Error('model exceeds 32 MB'); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size); let at = 0;
        for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
        return bytes.buffer;
      }
      case 'video': {
        const proxy = this.proxyOf(a);
        const cache = this.useProxies && (!!proxy || Object.values(this.doc.assets).some((asset) => asset.type === 'video' && asset.proxy === id));
        const source = proxy ? this.url(proxy) : url;
        this.assertProjectUrl(source);
        return VideoFrames.open(source, { cache, maxPixels: this.sandboxModules ? MAX_IMAGE_PIXELS : undefined });
      }
      case 'json': {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return this.sandboxModules ? JSON.parse(new TextDecoder().decode(await boundedBytes(r, DATA_LIMIT, 'JSON'))) : r.json();
      }
      case 'lut': {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return parseCube(this.sandboxModules ? new TextDecoder().decode(await boundedBytes(r, DATA_LIMIT, 'LUT')) : await r.text());
      }
      case 'audio': {
        // a sound is decoded by the mixer when it plays: here only its presence is checked, a byte asked for
        const r = await fetch(url, { headers: { range: 'bytes=0-0' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        void r.body?.cancel?.();
        return url;
      }
      default:
        return url;
    }
  }
}
