// Pictures of the film drawn away from the preview, on a renderer of their
// own: the assistant's stills (render_still, the contact sheets) and the
// studio's storyboard, whose frames are drawn one at a time in the
// background while nothing plays, the last ones shown while new ones draw.

import { effect, signal } from '@preact/signals';
import type { TrammeDoc } from '@tramme/core';
import { Renderer } from '@tramme/render';
import { editorRegistry } from './vocabulary.ts';
import { attachIsolated, filterModule, pluginHost } from './plugins/index.ts';
import { declarationsModule, ensureDeclared, ensureSandboxDoc, pluginItemsOf, sandboxDeclaration, sandboxVideoFrames } from './plugins/sandbox-draw.ts';
import { prefs } from './settings.ts';
import { sandboxedDoc } from './installed.ts';
import { S } from './state.ts';

/** a renderer of its own (never the preview's) and the stills it draws */
export class Stills {
  private renderer: Renderer | null = null;
  private canvas = document.createElement('canvas');
  private doc: TrammeDoc | null = null;
  private compId = '';

  /** the renderer, on this document and composition */
  async rendererFor(doc: TrammeDoc, compId?: string): Promise<Renderer> {
    const id = compId ?? doc.root;
    const base = new URL(S.docUrl.peek(), location.href).href;
    if (!this.renderer) {
      // the flag: the sandbox owns the plugins' modules, the registry takes its declarations
      const sandboxed = sandboxedDoc(doc);
      if (sandboxed) await ensureDeclared(pluginHost(base), pluginItemsOf(doc, base));
      this.renderer = await Renderer.open(doc, editorRegistry(), base, this.canvas, { compId: id, raster: 'gpu', pluginModule: sandboxed ? undefined : filterModule, sandboxModules: sandboxed, sandboxDeclarations: sandboxed ? (pid) => declarationsModule(sandboxDeclaration(pid)!, pid) : undefined });
    }
    // the same version again: its simulations stay computed
    else if (doc !== this.doc || id !== this.compId) await this.renderer.setDoc(doc, { compId: id, trusted: true });
    this.doc = doc; this.compId = id;
    // a proposal may add a plugin: its tools join as sandbox-backed entries
    if ((doc.plugins ?? []).length) await attachIsolated(this.renderer.registry, pluginHost(base), doc, (pid) => this.renderer!.assets.url(pid)).catch((e) => console.error('[plugins]', (e as Error).message));
    return this.renderer;
  }

  /** the frame at t, at most `width` pixels wide, as a JPEG data URL */
  async still(doc: TrammeDoc, t: number, compId: string, width: number, quality = 0.86): Promise<string> {
    const r = await this.rendererFor(doc, compId);
    const c = doc.compositions[compId];
    const k = Math.min(1, width / c.width);
    // the flag: the picture comes from the sandbox, videos decoded here
    if (sandboxedDoc(doc)) {
      const docUrl = new URL(S.docUrl.peek(), location.href).href;
      ensureSandboxDoc(pluginHost(docUrl), { doc, docUrl, loaded: (id) => { try { return r.assets.get(id); } catch { return null; } } });
      const videos = await sandboxVideoFrames(r, doc, t);
      const pic = await pluginHost(docUrl).renderFrame({ compId, t, scale: k, width: c.width, height: c.height, videos });
      if (pic.err || !pic.bitmap) throw new Error(pic.err ?? 'no picture from the sandbox');
      const small = document.createElement('canvas');
      small.width = Math.round(c.width * k); small.height = Math.round(c.height * k);
      small.getContext('2d')!.drawImage(pic.bitmap as OffscreenCanvas, 0, 0, small.width, small.height);
      return small.toDataURL('image/jpeg', quality);
    }
    r.setScale(k);
    await r.renderComplete(t);
    r.render(t);
    // copied right after drawing, before the WebGL canvas is presented
    const copy = document.createElement('canvas');
    copy.width = this.canvas.width; copy.height = this.canvas.height;
    copy.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return copy.toDataURL('image/jpeg', quality);
  }

  dispose() { this.renderer?.dispose(); this.renderer = null; this.doc = null; }
}

interface Wanted { key: string; where: string; doc: TrammeDoc; compId: string; t: number }

/** the frames the storyboard asked for */
class Frames {
  private stills = new Stills();
  /** frames drawn, by version of the document (an id per document object), composition and time */
  private cache = new Map<string, string>();
  /** the last frame drawn for a composition and a time, whatever the version: shown while the new one draws */
  private last = new Map<string, string>();
  private queue: Wanted[] = [];
  private busy = false;
  private ids = new WeakMap<TrammeDoc, number>();
  private seq = 0;
  /** the version the frames follow: frames asked for an older one are dropped */
  private current: TrammeDoc | null = null;
  /** changes when frames arrive: the storyboard draws again */
  readonly tick = signal(0);
  /** width of the frames, in pixels */
  readonly width = 256;

  constructor() {
    // nothing is drawn while the film plays: the frames go on once it stops
    effect(() => { if (!S.playing.value) this.pump(); });
  }

  private idOf(doc: TrammeDoc) {
    let n = this.ids.get(doc);
    if (n === undefined) { n = ++this.seq; this.ids.set(doc, n); }
    return n;
  }

  /** the picture of the film at t: this version's, or the last one drawn there while it draws, or null */
  at(doc: TrammeDoc, compId: string, t: number): string | null {
    const where = `${compId}|${t.toFixed(3)}`, key = `${this.idOf(doc)}|${where}`;
    const have = this.cache.get(key);
    if (have) return have;
    if (this.current !== doc) { this.current = doc; this.queue = this.queue.filter((q) => q.doc === doc); }
    if (!this.queue.some((q) => q.key === key)) this.queue.push({ key, where, doc, compId, t });
    queueMicrotask(() => this.pump());
    return this.last.get(where) ?? null;
  }

  private async pump() {
    if (this.busy || S.playing.peek() || !S.ready.peek()) return;
    this.busy = true;
    try {
      for (let w = this.queue.shift(); w; w = this.queue.shift()) {
        if (w.doc !== this.current || this.cache.has(w.key) || !w.doc.compositions[w.compId]) continue;
        let url: string;
        try { url = await this.stills.still(w.doc, w.t, w.compId, this.width, 0.78); }
        catch { continue; }
        this.cache.set(w.key, url);
        this.last.set(w.where, url);
        // the oldest frames go first when there are many
        if (this.cache.size > 800) this.cache.delete(this.cache.keys().next().value!);
        this.tick.value++;
        if (S.playing.peek()) break;
      }
    } finally { this.busy = false; }
  }
}

export const frames = new Frames();
