// The viewport's picture: the same Renderer as the export, fed with the
// document on screen. Playback follows the audio clock when there is sound.
// For speed, the preview renders at the size it is displayed (GPU raster),
// with one sub-frame while playing or dragging; once the picture stays still
// for a moment, it is drawn again with the full motion blur. While playing or
// dragging it also renders smaller, at a size that adapts to the frame rate
// the machine actually reaches; it is sharp again as soon as it stops.

/** render sizes the preview moves between (fractions of the composition) */
const NOTCHES = [0.25, 0.375, 0.5, 0.75, 1];
const notchAtMost = (x: number) => [...NOTCHES].reverse().find((k) => k <= x + 1e-6) ?? NOTCHES[0];

/** what the preview renders now, for the viewport and the settings: sizes as fractions of the composition */
export const previewInfo = signal({ scale: 1, still: 1, motion: 0.5 });

import { effect, signal } from '@preact/signals';
import { audioClips, clipFileTime, curveAt, needsPitch, soundMix, type TrammeDoc, type EvaluatedFrame } from '@tramme/core';
import { editorRegistry } from './vocabulary.ts';
import { clipChain, liveMaster, loadPitch, masterGainDb, mixTracks, playClip, Renderer } from '@tramme/render';
import { comp, compIdOf, S, setRegistry, setTime, toast, viewDoc } from './state.ts';
import { attachInstalled, attachIsolated, filterModule, onSandboxStopped, pluginHost, pluginToolHost } from './plugins/index.ts';
import { copiesIn, copyId, counted, installed, installedFor, installedTypes, offIn, permitted, sandboxedDoc, stopped, STRIKES } from './installed.ts';
import { bindSandbox, blitSandboxFrame, declarationsModule, ensureDeclared, ensureSandboxDoc, moduleItemsOf, resetSandbox, sandboxDeclaration, sandboxVideoFrames, type SandboxContext } from './plugins/sandbox-draw.ts';
import { t } from './i18n/index.ts';
import { MASTER_METER_ID, previewMeters } from './audio-meters.ts';
import { audioEffectsKey } from './audio-key.ts';
import { prefs } from './settings.ts';
import { clockTime, scrubWindow, step, Runs, type Clock } from './playclock.ts';
import { packAsInstalled, packBySrc, packContext, shippedPacks } from './packs.ts';
import { syncPluginTours } from './tours/index.ts';
// a stopped sandbox leaves the saved project and the open edits as they were; the next call starts a fresh one
onSandboxStopped((reason) => toast(t('editor.pluginStopped', { reason }), 'error', 9000));

/** the slowest pace a media element takes (browsers refuse less): slower, it waits */
const MIN_ELEMENT_RATE = 0.0625;

class Preview {
  readonly meters = previewMeters;
  readonly canvas: HTMLCanvasElement;
  renderer: Renderer | null = null;
  private applied: TrammeDoc | null = null;
  private wanted: TrammeDoc | null = null;
  private busy = false;
  private frameQueued = false;
  private audio: AudioContext | null = null;
  /** every sound of the preview goes through it: the volume set for the preview (the exports keep the mix as it is) */
  private master: GainNode | null = null;
  /** the master of the exports, as near as a live playback gets: their loudness gain (measured ahead, kept per mix), then a limiter */
  private level: GainNode | null = null;
  private meterOut: GainNode | null = null;
  private levels = new Map<string, Promise<number>>();
  /** this playback's way in to the level: cut on stop, so the buses of a playback do not outlive it */
  private playOut: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private sources: AudioBufferSourceNode[] = [];
  /** sound of video layers: media elements playing their cut, and the timers that start and stop them */
  private media: HTMLAudioElement[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private clock: Clock = { at: 0, t0: 0, audio: false };
  /** the playback started last: a start still loading its sounds when another begins (or a pause) schedules nothing */
  private runs = new Runs();
  private refineTimer: ReturnType<typeof setTimeout> | null = null;
  /** last rendered frame time (ms), shown in the transport */
  lastMs = 0;
  /** frames drawn and time spent drawing them, for measurements */
  stats = { frames: 0, ms: 0 };
  /** render size while moving, learnt from the frame rate during playback; ceiling: a size found too slow */
  private motion = { scale: 0.5, ceiling: 2, calm: 0, intervals: [] as number[], last: 0 };
  /** when the time last changed while paused (scrubbing the playhead) */
  private scrubAt = 0;
  /** when the scrub's sound last played (the window waits its 60 ms) */
  private scrubPlayedAt = -1e9;
  /** counter for re-loading an edited plugin in the sandbox */
  private bust = 0;
  /** one sandbox frame in flight (the flag's draw path) */
  private sandboxBusy = false;
  private sandboxAgain = false;
  /** the sharp frame being drawn in steps, cancelled by any change */
  private job: (() => EvaluatedFrame | null) | null = null;
  /** frame of the composition last drawn during playback (exact frames) */
  private playedFrame = -1;
  /** the document's motion blur sub-frames, from the last frame drawn */
  private docSamples = 1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'picture';
  }

  async start() {
    this.meters.clear(true);
    // a new project on the same page: what crossed for the old one is dropped
    resetSandbox();
    // every sandboxed draw goes through the open project's sandbox, fed with this preview's document and assets
    bindSandbox({
      host: () => pluginHost(new URL(S.docUrl.peek(), location.href).href),
      context: (): SandboxContext | null => {
        const r = this.renderer;
        if (!r) return null;
        return {
          doc: this.applied ?? S.doc.peek(),
          docUrl: new URL(S.docUrl.peek(), location.href).href,
          loaded: (id) => { try { return r.assets.get(id); } catch { return null; } },
        };
      },
    });
    try {
      const doc0 = S.doc.peek();
      const sandboxed = sandboxedDoc(doc0);
      // the sandbox's declarations are needed before the renderer opens: it registers from them, and the modules never load on the page
      if (sandboxed) await ensureDeclared(pluginHost(new URL(S.docUrl.peek(), location.href).href), moduleItemsOf(doc0, new URL(S.docUrl.peek(), location.href).href));
      this.renderer = await Renderer.open(doc0, editorRegistry(), new URL(S.docUrl.peek(), location.href).href, this.canvas, { compId: compIdOf(doc0), raster: 'gpu', scale: S.previewScale.peek(), preserve: false, isolate: true, proxies: prefs.peek().proxies, pluginModule: filterModule, sandboxModules: sandboxed, sandboxDeclarations: (id) => declarationsModule(sandboxDeclaration(id)!, id) });
      this.applied = doc0;
      await this.attachPlugins();
      setRegistry(this.renderer.registry);
      if (this.renderer.compositor.software) toast(t('editor.softwareGpu'), 'error');
      this.pluginTours();
      S.renderError.value = null;
    } catch (e) {
      S.renderError.value = (e as Error).message;
      return;
    }
    effect(() => { this.wanted = viewDoc.value; void S.compId.value; this.sync(); });
    let lastT = -1;
    effect(() => {
      const t = S.time.value, playing = S.playing.value;
      if (!playing && t !== lastT) { this.scrubAt = performance.now(); this.scrub(t); }
      if (!playing) this.playedFrame = -1;
      lastT = t;
      this.invalidate();
    });
    // A chain/routing edit or solo changes the live graph. Picture edits and
    // fader drafts leave it running instead of repeatedly cutting the sound.
    let audioKey = '';
    effect(() => {
      const playing = S.playing.value, solo = [...S.solo.value].sort(), doc = viewDoc.value;
      void S.compId.value;
      if (!playing) { audioKey = ''; this.stopAudio(); return; }
      const key = JSON.stringify([solo, audioEffectsKey(doc, compIdOf(doc))]);
      if (key !== audioKey) { audioKey = key; this.play(); }
    });
    effect(() => { void S.previewScale.value; void prefs.value; this.invalidate(); });
    effect(() => { const p = prefs.value; if (this.master) this.master.gain.value = p.previewMuted ? 0 : p.previewVolume; });
    let seenInstalled = installed.peek(), seenStopped = 0;
    // the installed plugins changed, or one was stopped for the session: the registry is built again
    effect(() => {
      const now = installed.value, off = stopped.value.size;
      if (now === seenInstalled && off === seenStopped) return;
      seenInstalled = now; seenStopped = off;
      this.installedChanged().catch((e) => console.warn('[installed plugins]', (e as Error).message));
    });
  }

  /** the tours exported by the project's plugins join the editor's */
  private pluginTours() {
    const r = this.renderer;
    if (!r) return;
    const doc = this.applied ?? S.doc.peek();
    syncPluginTours((doc.plugins ?? []).map((id) => {
      // the sandbox's declarations carry them (the sandbox owns the modules); the native path reads the module
      const decl = sandboxDeclaration(id);
      if (decl) return { id, module: declarationsModule(decl, id) };
      try { return { id, module: r.assets.get(id) }; } catch { return { id, module: null }; }
    }));
  }

  /** the plugins' tools and checks join the registry as sandbox-backed entries (no cost when there are none, or nothing new) */
  private async attachPlugins(reload: string[] = []) {
    const r = this.renderer;
    if (!r) return;
    const doc = this.applied ?? S.doc.peek();
    // the packs that ship with the editor, for the project's own copies' data and for the assistant's reach
    const packs = await shippedPacks();
    // the plugins installed on this device, in the project's sandbox (its own plugins win a shared name: attached first)
    const mine = installedFor(doc);
    if (!(doc.plugins ?? []).length && !mine.length && !packs.length) return;
    try {
      const base = new URL(S.docUrl.peek(), location.href).href;
      await attachIsolated(r.registry, pluginHost(base), doc, (id) => {
        const url = r.assets.url(id);
        // an edited plugin file: a fresh url, so the sandbox imports it again
        return reload.includes(id) ? `${url}${url.includes('?') ? '&' : '?'}pw=${++this.bust}` : url;
      }, (id, ctx) => {
        // a copy of an installed plugin keeps the permissions the user granted it, where it is installed
        const p = installed.peek().find((x) => copyId(x) === id && copiesIn(doc)[x.manifest.id] !== undefined);
        if (p) return permitted(ctx, p);
        // a copy of one of the editor's packs reads the pack's own data
        const pack = packBySrc(packs, doc.assets[id]?.src);
        return pack ? packContext(pack, ctx) : ctx;
      }, (id, url) => pluginToolHost(base, id, url));
    } catch (e) {
      toast(t('editor.pluginSandbox', { error: (e as Error).message }), 'error', 9000);
    }
    try {
      const byId = new Map(mine.map((p) => [p.id, p.plugin]));
      installedTypes.clear();
      await attachInstalled(r.registry, pluginHost(new URL(S.docUrl.peek(), location.href).href), mine.map((p) => ({ id: p.id, url: p.url, name: p.plugin.manifest.name })), {
        brought: (id, key) => installedTypes.set(key, byId.get(id)!),
        context: (id, ctx) => permitted(ctx, byId.get(id)!),
        around: (id, run) => counted(byId.get(id)!, run, (p) => toast(t('plugins.stopped', { name: p.manifest.name, n: STRIKES }), 'error', 9000)),
        hostFor: (id, url) => pluginToolHost(new URL(S.docUrl.peek(), location.href).href, id, url),
      });
    } catch (e) {
      toast(t('editor.installedRefused', { error: (e as Error).message }), 'error', 9000);
    }
    // the editor's packs, reached the way the installed plugins are: their tools and checks bridged from the
    // sandbox, their nodes and presets offered until the project holds them; a proposal that draws with one
    // copies it in (installedTypes), the version recorded. A pack that cannot load is left out, never the others.
    try {
      const settled = await Promise.allSettled(packs.map((p) => packAsInstalled(p)));
      for (const s of settled) if (s.status === 'rejected') console.error('[packs]', s.reason);
      const asInstalled = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
      const held = new Set(Object.values(doc.assets ?? {}).filter((x) => x.type === 'module').map((x) => x.src));
      const list = asInstalled
        .filter((p) => !held.has(`plugins/${p.file}`))
        .map((p) => ({ id: `packs:${p.file}`, url: `/plugins/${p.file}`, name: p.manifest.name }));
      const byId = new Map(asInstalled.map((p) => [`packs:${p.file}`, p]));
      const entryOf = new Map(packs.map((p) => [p.file, p]));
      await attachInstalled(r.registry, pluginHost(new URL(S.docUrl.peek(), location.href).href), list, {
        brought: (id, key) => { const p = byId.get(id); if (p) installedTypes.set(key, p); },
        context: (id, ctx) => { const p = byId.get(id); const pack = p && entryOf.get(p.file); return pack ? packContext(pack, ctx) : ctx; },
        hostFor: (id, url) => pluginToolHost(new URL(S.docUrl.peek(), location.href).href, id, url),
      });
    } catch (e) {
      console.error('[packs]', e);
    }
  }

  /** the installed plugins changed (installed, updated, turned off): the registry is built again without the old ones */
  private async installedChanged() {
    if (!this.renderer || !this.applied) return;
    await this.renderer.setDoc(this.applied, { compId: compIdOf(this.applied), fresh: true });
    await this.attachPlugins();
    setRegistry(this.renderer.registry);
  }

  /** apply the latest wanted document, one at a time (asset loading is async) */
  private async sync() {
    if (this.busy || !this.renderer) return;
    const doc = this.wanted;
    const compId = doc ? compIdOf(doc) : S.compId.peek();
    if (!doc || (doc === this.applied && this.renderer.compId === compId)) return;
    this.busy = true;
    try {
      // a drag's draft comes from a valid document: no need to validate it again
      // a project that turns an installed plugin off or on: the registry is built again
      const fresh = !!this.applied && offIn(doc).join('\n') !== offIn(this.applied).join('\n');
      // a copy of an installed plugin entered the project (or left it): its plugins move to the sandbox (or back), their modules loaded again
      const sandboxed = sandboxedDoc(doc), base = new URL(S.docUrl.peek(), location.href).href;
      const reload = sandboxed !== this.renderer.sandboxModules ? (doc.plugins ?? []) : [];
      this.renderer.sandboxModules = this.renderer.assets.sandboxModules = sandboxed;
      if (sandboxed) await ensureDeclared(pluginHost(base), moduleItemsOf(doc, base));
      await this.renderer.setDoc(doc, { compId, trusted: doc === S.draft.peek(), fresh, reload });
      this.applied = doc;
      await this.attachPlugins();
      setRegistry(this.renderer.registry);
      this.pluginTours();
      this.noteOffline();
      S.renderError.value = null;
    } catch (e) {
      S.renderError.value = (e as Error).message;
      this.applied = doc;
    } finally {
      this.busy = false;
    }
    this.invalidate();
    if (this.wanted !== this.applied) this.sync();
  }

  /** load a module asset again (a plugin edited on disk) */
  async reload(assetIds: string[]) {
    if (!this.renderer) return;
    if (this.renderer.sandboxModules) {
      const base = new URL(S.docUrl.peek(), location.href).href;
      // A saved edit can keep the same asset URL. Discard the worker's module
      // cache so the next load reads the new source and declarations.
      if (assetIds.some((id) => this.applied!.assets[id]?.type === 'module')) {
        pluginHost(base).dispose('project module changed');
        resetSandbox();
      }
      await ensureDeclared(pluginHost(base), moduleItemsOf(this.applied!, base));
    }
    await this.renderer.setDoc(this.applied!, { compId: compIdOf(this.applied!), reload: assetIds });
    await this.attachPlugins(assetIds);
    setRegistry(this.renderer.registry);
    this.pluginTours();
    this.noteOffline();
    this.invalidate();
  }

  /** the media whose file is missing, for the panels: written only when the list changes */
  private noteOffline() {
    const ids = [...(this.renderer?.assets.offline.keys() ?? [])];
    if (ids.join('|') !== S.offline.peek().join('|')) S.offline.value = ids;
  }

  /** the proxies setting changed: the videos that have one open again, the proxy or the original */
  async useProxies(on: boolean) {
    if (!this.renderer || !this.applied) return;
    this.renderer.assets.useProxies = on;
    await this.reload(Object.entries(this.applied.assets).filter(([, a]) => a.type === 'video' && a.proxy).map(([id]) => id));
  }

  /** the sandbox-preview flag changed: the registry is rebuilt from the other source (declarations or real modules) */
  async reloadPlugins() {
    const doc = this.applied;
    if (!doc || !this.renderer) { await this.start(); return; }
    this.renderer.sandboxModules = sandboxedDoc(doc);
    this.renderer.assets.sandboxModules = this.renderer.sandboxModules;
    await this.reload((doc.plugins ?? []).concat(Object.entries(doc.assets).filter(([, a]) => a.type === 'module').map(([id]) => id)));
  }

  /** a small picture of the current frame, for the home screen */
  async thumbnail(t: number, width = 480): Promise<Blob | null> {
    const r = this.renderer;
    if (!r) return null;
    if (r.sandboxModules) {
      const doc = this.applied;
      if (!doc) return null;
      const base = new URL(S.docUrl.peek(), location.href).href;
      const host = pluginHost(base);
      await ensureDeclared(host, moduleItemsOf(doc, base));
      ensureSandboxDoc(host, { doc, docUrl: base, loaded: (id) => { try { return r.assets.get(id); } catch { return null; } } });
      const scale = Math.min(1, width / r.comp.width);
      const videos = await sandboxVideoFrames(r, doc, t);
      const picture = await host.renderFrame({ compId: r.compId, t, scale, width: r.comp.width, height: r.comp.height, videos });
      if (picture.err || !picture.bitmap) throw new Error(picture.err ?? 'no picture from the sandbox');
      const small = document.createElement('canvas');
      small.width = Math.round(r.comp.width * scale); small.height = Math.round(r.comp.height * scale);
      try { small.getContext('2d')!.drawImage(picture.bitmap as ImageBitmap, 0, 0, small.width, small.height); }
      finally { (picture.bitmap as ImageBitmap).close(); }
      return new Promise((res) => small.toBlob(res, 'image/webp', 0.82));
    }
    // every video frame exact, then drawn once more right before reading (the canvas keeps nothing between tasks)
    await r.renderComplete(t);
    r.render(t);
    const k = Math.min(1, width / this.canvas.width);
    const small = document.createElement('canvas');
    small.width = Math.round(this.canvas.width * k); small.height = Math.round(this.canvas.height * k);
    const ctx = small.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    // read right after drawing, before the WebGL canvas is presented
    ctx.drawImage(this.canvas, 0, 0, small.width, small.height);
    this.invalidate();
    return new Promise((res) => small.toBlob(res, 'image/webp', 0.82));
  }

  invalidate() {
    if (this.refineTimer) { clearTimeout(this.refineTimer); this.refineTimer = null; }
    this.job = null;
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => {
      this.frameQueued = false;
      this.draw();
    });
  }

  /** render size once still: the size on screen, or the composition's full size (settings) */
  private stillScale() { return prefs.peek().still === 'full' ? 1 : S.previewScale.peek(); }

  /** render size while moving: learnt from the frame rate (automatic), or fixed in the settings */
  private motionScale(still: number) {
    const m = prefs.peek().motion;
    if (m === 'full') return still;
    if (m === 'half') return notchAtMost(still / 2);
    if (m === 'quarter') return notchAtMost(still / 4);
    return Math.min(still, this.motion.scale);
  }

  /** sub-frames of the sharp picture: the document's, at most 4, or 1 (settings) */
  private sharpSamples(): number | undefined {
    const b = prefs.peek().blur;
    return b === 'off' ? 1 : b === 'limited' ? Math.min(4, this.docSamples) : undefined;
  }

  private setScale(r: Renderer, k: number, still: number) {
    if (Math.abs(r.scale - k) > 1e-6) r.setScale(k);
    const info = previewInfo.peek();
    if (info.scale !== k || info.still !== still || info.motion !== this.motionScale(still)) previewInfo.value = { scale: k, still, motion: this.motionScale(still) };
  }

  /** one sub-frame, at the motion size while playing, dragging or scrubbing; the sharp picture follows once still */
  private draw() {
    const r = this.renderer;
    if (!r) return;
    const playing = S.playing.peek();
    if (playing) { this.advance(); this.adapt(this.stillScale()); } else this.motion.last = 0;
    // playback at the composition's own frames (as the export): nothing to draw between two of them
    let t = S.time.peek();
    if (playing && prefs.peek().exactFrames) {
      const fps = comp.peek().fps, f = Math.floor(t * fps + 1e-6);
      if (f === this.playedFrame) { this.invalidate(); return; }
      this.playedFrame = f;
      t = f / fps;
    }
    const moving = playing || S.draft.peek() !== null;
    const still = this.stillScale();
    const scrubbing = !playing && performance.now() - this.scrubAt < 250;
    const scale = moving || scrubbing ? this.motionScale(still) : still;
    const sandboxed = prefs.peek().sandboxPreview || r.sandboxModules;
    // Resizing clears the displayed canvas. The sandbox replaces it only
    // after asynchronous decoding: keep the old picture until then.
    if (!sandboxed) this.setScale(r, scale, still);
    const t0 = performance.now();
    try {
      if (sandboxed) {
        // the whole picture comes from the sandbox (docs/evaluator-sandbox.md): modifiers, effects and simulations never run here
        if (!this.sandboxBusy) {
          this.sandboxBusy = true;
          this.sandboxAgain = false;
          const blur = prefs.peek().blur;
          const samples = moving || scrubbing || blur === 'off' ? 1 : blur === 'limited' ? 4 : undefined;
          void this.drawSandboxFrame(t, samples, scale).catch((e) => { S.renderError.value = `sandbox: ${(e as Error).message}`; }).finally(() => {
            this.sandboxBusy = false;
            // Only another invalidation needs another frame. An unconditional
            // redraw here keeps decoding and drawing forever while paused.
            if (this.sandboxAgain && !S.playing.peek()) this.invalidate();
            else if (scrubbing && !moving && !S.playing.peek()) {
              this.refineTimer = setTimeout(() => { this.refineTimer = null; this.invalidate(); }, Math.max(0, 250 - (performance.now() - this.scrubAt)));
            }
          });
        } else this.sandboxAgain = true;
      } else {
        const frame = r.render(t, { samples: 1, checker: true });
        this.docSamples = frame.motionBlur.samples;
        // a video frame still decoding: drawn again as soon as it is there
        if (r.incomplete) r.settle().then((waited) => { if (waited && !S.playing.peek()) this.invalidate(); });
        // a layer or effect that failed is drawn as a red frame: say which and why
        if (r.errors.size) S.renderError.value = `render: ${[...r.errors].map(([id, m]) => `${id}: ${m}`).join(' · ')}`;
        else if (S.renderError.peek()?.startsWith('render')) S.renderError.value = null;
        // still for a moment: the sharp picture, with its motion blur, at the still size
        const blurred = (this.sharpSamples() ?? frame.motionBlur.samples) > 1;
        if (!moving && (blurred || r.scale < still)) {
          this.refineTimer = setTimeout(() => { this.refineTimer = null; requestAnimationFrame(() => this.refine()); }, 180);
        }
      }
    } catch (e) {
      S.renderError.value = `render: ${(e as Error).message}`;
    }
    this.lastMs = performance.now() - t0;
    this.stats.frames++;
    this.stats.ms += this.lastMs;
    if (S.playing.peek()) this.invalidate();
  }

  /**
   * The picture of the flag: the sandbox evaluates and draws the whole
   * composition (modifiers, effects, simulations inside), the page blits the
   * finished picture through the renderer's own compositor — the canvas is
   * WebGL, so the bitmap goes in as a frame, and the checker shows behind
   * transparency as anywhere. Video frames are still decoded here and travel
   * with the request.
   */
  private async drawSandboxFrame(t: number, samples?: number, scale = this.renderer!.scale) {
    const r = this.renderer!;
    const doc = this.applied ?? S.doc.peek();
    const c = doc.compositions[r.compId];
    if (!c) return;
    const docUrl = new URL(S.docUrl.peek(), location.href).href;
    const ctx: SandboxContext = {
      doc, docUrl,
      loaded: (id) => { try { return r.assets.get(id); } catch { return null; } },
    };
    ensureSandboxDoc(pluginHost(docUrl), ctx);
    const videos = await sandboxVideoFrames(r, doc, t);
    const pic = await pluginHost(docUrl).renderFrame({ compId: r.compId, t, scale, samples, width: c.width, height: c.height, videos });
    if (pic.err) { S.renderError.value = `sandbox: ${pic.err}`; return; }
    if (!pic.bitmap) return;
    this.setScale(r, scale, this.stillScale());
    blitSandboxFrame(r, pic.bitmap, t, true);
    if (S.renderError.peek()?.startsWith('sandbox')) S.renderError.value = null;
  }

  /**
   * The picture at full size and with its motion blur, drawn in slices of
   * about 10 ms over several animation frames: the interface never freezes,
   * and any change in between cancels it.
   */
  private refine() {
    const r = this.renderer;
    if (!r) return;
    const still = this.stillScale(), t = S.time.peek();
    try {
      // a new size clears the canvas: show a quick frame at that size first
      if (Math.abs(r.scale - still) > 1e-6) { this.setScale(r, still, still); r.render(t, { samples: 1, checker: true }); }
      const job = r.renderSteps(t, { checker: true, samples: this.sharpSamples() });
      this.job = job;
      const run = () => {
        if (this.job !== job) return;
        const t0 = performance.now();
        let done: EvaluatedFrame | null = null;
        while (!(done = job()) && performance.now() - t0 < 10) { /* next sub-frame */ }
        this.stats.frames++;
        this.stats.ms += performance.now() - t0;
        if (!done) { requestAnimationFrame(run); return; }
        this.job = null;
        // a video frame was missing: the sharp picture again once it is decoded
        if (r.incomplete) r.settle().then((waited) => { if (waited && !this.job && !S.playing.peek()) this.refine(); });
      };
      run();
    } catch (e) {
      S.renderError.value = `render: ${(e as Error).message}`;
    }
  }

  /** playback too slow: render smaller; comfortably fast: a little larger again, never back to a size found too slow */
  private adapt(target: number) {
    const m = this.motion, now = performance.now();
    if (m.last) m.intervals.push(now - m.last);
    m.last = now;
    if (m.intervals.length < 24) return;
    const avg = m.intervals.reduce((a, b) => a + b, 0) / m.intervals.length;
    m.intervals = [];
    const i = NOTCHES.indexOf(m.scale);
    // frames lost (under about 45 per second): smaller. The screen keeps its pace (60 Hz gives 16.7 ms): larger, step by step
    if (avg > 22 && i > 0) { m.ceiling = Math.min(m.ceiling, m.scale); m.scale = NOTCHES[i - 1]; m.calm = 0; }
    else if (avg < 18 && ++m.calm >= 2 && i < NOTCHES.length - 1 && NOTCHES[i + 1] < m.ceiling && NOTCHES[i + 1] <= target) { m.scale = NOTCHES[i + 1]; m.calm = 0; }
    else if (avg >= 18) m.calm = 0;
  }

  // ── playback ───────────────────────────────────────────────
  private now() {
    return this.clock.audio && this.audio ? this.audio.currentTime : performance.now() / 1000;
  }

  private advance() {
    const c = comp.peek();
    const s = step(this.clock, this.now(), c.duration, S.loop.peek());
    if (s.wrap) { S.time.value = s.t; this.play(s.t); return; }
    if (s.end) { setTime(c.duration); S.playing.value = false; return; }
    S.time.value = s.t;
  }

  private async play(from = S.time.peek()) {
    this.stopAudio();
    const run = this.runs.begin();
    // the clock starts at once, before the sounds load: the frames drawn meanwhile read the new start, not the last playback
    // (the audio context runs on while paused: its old clock would land past the end, wrap and start the sound again)
    this.clock = { at: performance.now() / 1000, t0: from, audio: false };
    const doc = viewDoc.peek();
    // audio layers and the sound of videos, each from its in point to its out point (the cuts)
    const solo = S.solo.peek();
    const clips = audioClips(doc, compIdOf(doc)).filter((c) => c.at + c.duration > from && (!solo.size || solo.has(c.layerId)));
    if (clips.length) this.ensureAudio();
    if (this.audio) await this.audio.resume();
    if (!this.audio || !this.renderer || !clips.length || !this.runs.live(run)) return;
    const r = this.renderer, ctx = this.audio, compId = compIdOf(doc);
    this.levelOf(doc, compId);
    const sounds = clips.filter((c) => doc.assets[c.asset].type !== 'video');
    const bufs = await Promise.all(sounds.map((c) => this.buffer(r.assets.url(c.asset))));
    // the pitch worklet, before the clock starts
    if (clips.some(needsPitch)) await loadPitch(ctx).catch(() => {});
    if (!S.playing.peek() || !this.runs.live(run)) return;
    const startAt = ctx.currentTime + 0.03;
    this.clock = { at: startAt, t0: from, audio: true };
    // the mixer of the exports: filters, gain curves, fades, reverb and the shared room sound the same here
    this.playOut = ctx.createGain();
    this.playOut.connect(this.level!);
    this.meters.source(MASTER_METER_ID, ctx, this.meterOut!);
    const output = mixTracks(ctx, doc, compId, this.playOut, (id, node) => this.meters.source(id, ctx, node));
    sounds.forEach((c, i) => {
      const src = bufs[i] && playClip(ctx, c, bufs[i]!, output(c), startAt, from);
      if (src) this.sources.push(src);
    });
    // a video's sound streams from its file (never decoded whole): one element per cut, started and stopped on the clock
    for (const c of clips.filter((x) => doc.assets[x.asset].type === 'video')) {
      const el = new Audio(r.assets.url(c.asset));
      el.preload = 'auto';
      el.playbackRate = Math.max(MIN_ELEMENT_RATE, c.rate);
      // the pitch goes with the speed, as in the exports, unless the layer keeps it: the browser does it for an element
      el.preservesPitch = c.keepPitch;
      ctx.createMediaElementSource(el).connect(clipChain(ctx, { ...c, keepPitch: false }, output(c), startAt, from));
      const skip = Math.max(0, from - c.at);
      // the element is timed like the file: the seek lands at the file's time (the pace included), wrapped into a loop it is past
      const looping = c.loopStart !== undefined && c.loopEnd !== undefined && c.loopEnd > c.loopStart;
      const loopStart = Math.max(0, c.loopStart ?? 0), len = (c.loopEnd ?? 0) - loopStart;
      const raw = clipFileTime(c, c.at + skip);
      const at = looping && raw > loopStart && len > 0 ? loopStart + ((raw - loopStart) % len) : raw;
      const begin = () => {
        el.currentTime = at;
        el.play().catch(() => {});
        // a speed curve steers the element as it plays; under its slowest pace, it waits (a frozen frame is silent)
        const curve = c.rateCurve;
        if (!curve) return;
        const steer = setInterval(() => {
          const now = clockTime(this.clock, this.audio!.currentTime), rate = curveAt(curve, now);
          if (rate < MIN_ELEMENT_RATE) { if (!el.paused) el.pause(); return; }
          el.playbackRate = rate;
          if (el.paused && now < c.at + c.duration) el.play().catch(() => {});
        }, 40);
        this.timers.push(steer as unknown as ReturnType<typeof setTimeout>);
      };
      // a looped section: the element cannot loopStart like a buffer, the wrap keeps it close (the exports are exact)
      if (looping) el.addEventListener('timeupdate', () => { if (el.currentTime >= c.loopEnd!) el.currentTime -= len; });
      const wait = Math.max(0, c.at - from) * 1000 + 30;
      this.timers.push(setTimeout(begin, wait), setTimeout(() => el.pause(), wait + (c.duration - skip) * 1000));
      this.media.push(el);
    }
  }

  /** the sound heard while the playhead is dragged: 80 ms of the decoded buffers around `t`, at most every 60 ms;
   *  never the videos' (their sound streams from the file) */
  private scrub(t: number) {
    const p = prefs.peek();
    if (!p.scrubAudio || p.previewMuted || !this.renderer || S.playing.peek()) return;
    const w = scrubWindow(t, this.scrubPlayedAt, performance.now());
    if (!w) return;
    this.scrubPlayedAt = performance.now();
    const doc = viewDoc.peek(), solo = S.solo.peek();
    const clips = audioClips(doc, compIdOf(doc)).filter((c) => t >= c.at && t < c.at + c.duration && doc.assets[c.asset].type !== 'video' && (!solo.size || solo.has(c.layerId)));
    if (!clips.length) return;
    // the drag is a gesture: the sound can start before the first playback
    this.ensureAudio();
    void this.audio!.resume();
    const scrubOut = this.audio!.createGain();
    scrubOut.connect(this.level ?? this.master!);
    const output = mixTracks(this.audio!, doc, compIdOf(doc), scrubOut);
    const cleanup = setTimeout(() => { scrubOut.disconnect(); this.timers = this.timers.filter((timer) => timer !== cleanup); }, (w.dur + 0.03) * 1000);
    this.timers.push(cleanup);
    for (const c of clips) {
      void this.buffer(this.renderer.assets.url(c.asset)).then((buf) => {
        if (!buf || !this.audio || S.playing.peek()) return;
        const src = playClip(this.audio, c, buf, output(c), this.audio.currentTime + 0.005, w.from);
        if (!src) return;
        this.sources.push(src);
        // a scrub's window is short-lived: it leaves the list once it has played, so a long drag keeps none
        src.onended = () => { this.sources = this.sources.filter((s) => s !== src); };
        src.stop(this.audio.currentTime + 0.005 + w.dur);
      });
    }
  }

  /** the audio graph, made on the first sound: the master volume, a limiter, the level the loudness sets */
  private ensureAudio() {
    if (this.audio) return;
    this.audio = new AudioContext({ sampleRate: 48000 });
    this.master = this.audio.createGain();
    this.master.connect(this.audio.destination);
    this.master.gain.value = prefs.peek().previewMuted ? 0 : prefs.peek().previewVolume;
    const chain = liveMaster(this.audio, this.master);
    this.level = chain.input;
    this.meterOut = chain.output;
  }

  /** the loudness gain of the master for this mix: measured once per mix (in the background the first time), then set on the level */
  private levelOf(doc: TrammeDoc, compId: string) {
    const r = this.renderer!, clips = audioClips(doc, compId);
    const key = JSON.stringify([audioEffectsKey(doc, compId), soundMix(doc.compositions[compId]), clips]);
    let p = this.levels.get(key);
    if (!p) {
      // Video audio streams during playback. Measuring its complete mix here
      // would fetch and decode the whole film in the background, starving the
      // preview's range reads. Keep unity gain and the live limiter for these
      // mixes; exports still measure and master the complete original.
      p = clips.some((clip) => doc.assets[clip.asset]?.type === 'video')
        ? Promise.resolve(0)
        : masterGainDb(doc, compId, (id) => r.assets.url(id)).catch(() => 0);
      this.levels.set(key, p);
    }
    p.then((db) => { if (this.level && this.audio) this.level.gain.setTargetAtTime(Math.pow(10, db / 20), this.audio.currentTime, 0.05); });
  }

  private stopAudio() {
    this.runs.cancel();
    this.meters.clear();
    this.playOut?.disconnect();
    this.playOut = null;
    for (const s of this.sources) { try { s.stop(); } catch { /* not started */ } }
    this.sources = [];
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const el of this.media) { el.pause(); el.removeAttribute('src'); el.load(); }
    this.media = [];
  }

  private buffer(url: string) {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url).then((r) => r.arrayBuffer()).then((b) => this.audio!.decodeAudioData(b)).catch(() => null);
      this.buffers.set(url, p);
    }
    return p;
  }
}

export const preview = new Preview();

/** a video's length when the preview has it open: the handle after a shot's end */
export const fileLength = (asset: string): number | undefined => { try { return (preview.renderer?.assets.get(asset) as { duration?: number } | undefined)?.duration; } catch { return undefined; } };

/** a JSON asset as the preview loaded it (analyses, event lists), for the editor's own evaluators: the expressions that read them get their values */
export const assetData = (id: string) => (preview.renderer?.assets.has(id) ? preview.renderer.assets.get(id) : undefined);
