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
const MAX_RETAINED_IMAGE_PIXELS = 64 * 1024 * 1024;
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

export class AssetStore {
  private loaded = new Map<string, { key: string; entry: Asset; value: unknown }>();
  private doc: TrammeDoc;
  private base: string;
  /** bumped when a module reloads, so a changed plugin file is imported again */
  private version = 0;
  /** a font of the page stayed loading past FONTS_WAIT_MS: not waited for again */
  private pageFontsStuck = false;
  /** the sandbox owns the project's plugin modules: sync skips them, their code never loads here */
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

  private release(entry: Asset, value: unknown): void {
    if (entry.type === 'image') (value as { close?: () => void } | null)?.close?.();
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
    const refused: string[] = [];
    if (reload.length) this.version++;
    for (let start = 0; start < entries.length; start += MAX_ACTIVE_ASSETS) await Promise.all(entries.slice(start, start + MAX_ACTIVE_ASSETS).map(async ([id, a]) => {
      // a sub-clip is a range of another asset, no file of its own
      if (a.of !== undefined) { const old = this.loaded.get(id); if (old) this.release(old.entry, old.value); this.loaded.delete(id); return; }
      // the sandbox owns the project's plugin modules: their code never loads here
      if (this.sandboxModules && a.type === 'module' && (doc.plugins || []).includes(id)) { const old = this.loaded.get(id); if (old) this.release(old.entry, old.value); this.loaded.delete(id); return; }
      const have = this.loaded.get(id);
      if (have && !reload.includes(id)) {
        const key = this.keyOf(a);
        if (have.entry === a && have.key === key) return;
        if (have.key === key) { have.entry = a; return; }
      }
      const key = this.keyOf(a);
      if (tolerate && this.failed.get(id) === key && !reload.includes(id)) return;
      try {
        const value = await this.load(id, a);
        if (this.sandboxModules && a.type === 'image') {
          const retained = [...this.loaded.entries()].reduce((sum, [otherId, old]) => sum + (otherId === id ? 0 : this.imagePixels(old.entry, old.value)), 0);
          if (retained + this.imagePixels(a, value) > MAX_RETAINED_IMAGE_PIXELS) {
            this.release(a, value);
            throw new Error('images exceed 256 MB of retained decoded pixels');
          }
        }
        if (have) this.release(have.entry, have.value);
        this.loaded.set(id, { key, entry: a, value });
        this.offline.delete(id); this.failed.delete(id);
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
          if (this.sandboxModules && (!img.naturalWidth || !img.naturalHeight || img.naturalWidth > 8192 || img.naturalHeight > 8192 || img.naturalWidth * img.naturalHeight > MAX_IMAGE_PIXELS)) {
            throw new Error('image exceeds 8192 pixels per side or 16 million pixels total');
          }
          try { return await createImageBitmap(img); } catch (e) { if (!/svg/i.test((e as Error).message)) throw e; }
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
        return VideoFrames.open(source, { cache });
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
