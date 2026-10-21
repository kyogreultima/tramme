// The sandbox's real raster: what draws a sandboxed layer in the worker. A
// plugin node's own canvas2d runs on an OffscreenCanvas sized to its bounds
// (in local units, translated so the bounds' corner is the origin); its gl
// runs on the node type's WebGL2 service of its own (the same nodeContext the
// engine uses, which prefers an OffscreenCanvas already). The picture comes
// back as an ImageBitmap, transferred. What a draw may reach is what a draw
// needs: evaluated props, the frame's numbers, the simulation state computed
// on the page, the other layers' evaluated data, and the document's pictures,
// json and fonts — not video frames, not other layers' pixels.
//
// renderFrame is the evaluator's move (docs/evaluator-sandbox.md): the whole
// composition — built-in nodes, plugin nodes, their modifiers, effects and
// simulations — is evaluated and drawn here, and one finished picture comes
// back. The page ships the document (setDoc) and each video asset's current
// frame (their decoding still happens there, for now).

import { Evaluator, parseColor, type Host, type Instance, type NodeType, type PluginModule, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { CanvasPool, Compositor, drawFrame, drawLayers, finishOf, subTimes } from '@tramme/render/src/index.ts';
import { nodeContext, resizeNode } from '@tramme/render/src/gpu.ts';
import { RecordingPath2D } from './recording-path.ts';
import type { DrawPayload, DrawResult, FramePayload, SandboxDoc } from './protocol.ts';
import type { SandboxDrawSide } from './worker-side.ts';

const MAX_PIXELS = 2048;
const FALLING_AREA = { x: -60, y: -60, w: 120, h: 120 };

/** a canvas pool for a worker: OffscreenCanvases instead of document canvases */
class WorkerPool extends CanvasPool {
  constructor() { super(false); }
  protected override make(): HTMLCanvasElement {
    return new OffscreenCanvas(300, 150) as unknown as HTMLCanvasElement;
  }
}

interface DocSide {
  doc: Record<string, unknown> | null;
  docUrl: string;
  images: Map<string, unknown>;
  json: Map<string, unknown>;
  fonts: Set<string>;
}

export function makeSandboxDraw(modules: Map<string, PluginModule>): SandboxDrawSide {
  const side: DocSide = { doc: null, docUrl: '', images: new Map(), json: new Map(), fonts: new Set() };
  const self_ = self as unknown as { fonts: { add(f: unknown): void } };

  const nodeOf = (type: string): NodeType | null => {
    for (const mod of modules.values()) {
      const n = mod.nodes?.find((x) => x.type === type);
      if (n) return n;
    }
    return null;
  };

  const assetInfo = (id: string): Record<string, unknown> => {
    const assets = side.doc?.assets as Record<string, Record<string, unknown>> | undefined;
    const a = assets?.[id];
    if (!a) throw new Error(`unknown asset: ${id}`);
    return a;
  };

  const hostOf = (item: DrawPayload['items'][number], payload: DrawPayload): Host => ({
    layerId: item.id,
    t: item.t,
    frame: item.frame,
    fps: payload.comp.fps,
    width: payload.comp.width,
    height: payload.comp.height,
    duration: payload.comp.duration,
    asset: ((id: string) => {
      if (side.images.has(id)) return side.images.get(id);
      if (side.json.has(id)) return side.json.get(id);
      const a = assetInfo(id);
      if (a.type === 'font') return a.family ?? id;
      if (a.type === 'video') throw new Error('host.asset: video frames do not cross the sandbox (a video is read by its own layer)');
      if (a.type === 'module') throw new Error('host.asset: module namespaces do not cross the sandbox');
      throw new Error(`host.asset: the asset "${id}" (${String(a.type)}) is not in the sandbox`);
    }) as Host['asset'],
    assetInfo: (id) => assetInfo(id) as never,
    assetUrl: (id) => new URL(String(assetInfo(id).src), side.docUrl).href,
    state: (() => item.state) as Host['state'],
    layer: ((id: string) => payload.layers.find((l) => l.id === id) ?? null) as Host['layer'],
    defer: () => {},
    drawComposition: () => { throw new Error('host.drawComposition does not cross the sandbox'); },
    drawLayer: () => { throw new Error('host.drawLayer does not cross the sandbox'); },
  });

  const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  // ── the evaluator's move: a whole frame, evaluated and drawn here ──

  const theDoc = () => side.doc as unknown as TrammeDoc | null;

  const sandboxAsset = (id: string, videos: Map<string, unknown>) => {
    if (side.images.has(id)) return side.images.get(id);
    if (side.json.has(id)) return side.json.get(id);
    const a = assetInfo(id);
    if (a.type === 'font') return a.family ?? id;
    if (a.type === 'video') {
      // the page decodes the frame this render asks for and ships it with the request
      const frame = videos.get(id) ?? null;
      return { width: Number(a.width ?? 0) || 2, height: Number(a.height ?? 0) || 2, duration: Number(a.duration ?? 0), frameAt: () => frame, request: () => {} };
    }
    if (a.type === 'module') throw new Error('host.asset: module namespaces do not cross the sandbox');
    throw new Error(`host.asset: the asset "${id}" (${String(a.type)}) is not in the sandbox`);
  };

  const renderFrame = async (p: FramePayload) => {
    const doc = theDoc();
    if (!doc) return { err: 'no document in the sandbox' };
    const comp = doc.compositions[p.compId];
    if (!comp) return { err: `unknown composition: ${p.compId}` };
    const videos = new Map(Object.entries(p.videos ?? {}));
    const reg = builtinRegistry().clone();
    for (const [id, mod] of modules) reg.use(mod, id);
    const evaluator = new Evaluator(doc, reg, { data: (id) => side.json.get(id) });
    const sims = new Map<string, { frame: number; state: unknown }>();
    const layerOf = (id: string, t: number, cid: string) => {
      try { return doc.compositions[cid]?.layers[id] ? evaluator.layerAt(id, t, cid) : null; } catch { return null; }
    };
    const hostAt = (f: { t: number; frame: number }, cid: string) => (layerId: string): Host => ({
      layerId,
      layerIn: doc.compositions[cid]?.layers[layerId]?.in ?? 0,
      t: f.t,
      frame: f.frame,
      fps: comp.fps,
      width: comp.width,
      height: comp.height,
      duration: comp.duration,
      asset: ((id: string) => sandboxAsset(id, videos)) as Host['asset'],
      assetInfo: (id) => assetInfo(id) as never,
      assetUrl: (id) => new URL(String(assetInfo(id).src), side.docUrl).href,
      compositionSize: (cid2: string) => { const c = doc.compositions[cid2]; return c ? { width: c.width, height: c.height, duration: c.duration } : null; },
      drawComposition: (ctx: CanvasRenderingContext2D, cid2: string, t2: number, inst?: Instance) => { const fr = evaluator.frame(t2, cid2, inst); if (fr.background) { ctx.fillStyle = fr.background; ctx.fillRect(0, 0, fr.comp.width, fr.comp.height); } drawFrame(ctx, fr, envOf(fr, cid2)); },
      drawLayer: (ctx: CanvasRenderingContext2D, lid: string) => { const L = layerOf(lid, f.t, cid); if (L) drawLayers(ctx, [{ ...L, layer: { ...L.layer, visible: true } }], envOf({ t: f.t }, cid)); },
      layer: (lid: string) => { const L = layerOf(lid, f.t, cid); return L ? { props: L.props, transform: L.transform, in: L.layer.in ?? 0, out: L.layer.out ?? comp.duration } : null; },
      state: (() => simsOf(cid, layerId, f.t, f)) as Host['state'],
      defer: () => {},
    });
    const envOf = (frame: { t: number }, cid: string) => ({
      registry: reg,
      pool,
      scale: [scaleX, scaleY] as [number, number],
      t: frame.t,
      host: hostAt({ t: frame.t, frame: Math.round(frame.t * comp.fps) }, cid),
      layerAt: (id: string) => layerOf(id, frame.t, cid),
    });
    const simsOf = (cid: string, id: string, t: number, f: { t: number; frame: number }) => {
      const layer = doc.compositions[cid]?.layers[id];
      const sim = layer && reg.hasNode(layer.type) ? reg.node(layer.type).simulate : undefined;
      if (!sim) return undefined;
      const fps = comp.fps, start = layer.in ?? 0;
      const target = Math.max(0, Math.round((t - start) * fps));
      const key = `${cid}/${id}`;
      let s = sims.get(key);
      // sequential by design: a jump backwards re-steps from the layer's start
      if (!s || s.frame > target) s = { frame: -1, state: undefined };
      if (s.frame === target) return s.state;
      const at = (f: number) => ({ props: evaluator.layerAt(id, start + f / fps, cid)!.props, host: hostAt({ t: start + f / fps, frame: f }, cid)(id) });
      if (s.frame < 0) s = { frame: 0, state: sim.init(at(0).props, at(0).host) };
      while (s.frame < target) { const a = at(s.frame + 1); s.state = sim.step(s.state, a.props, 1 / fps, a.host); s.frame++; }
      sims.set(key, s);
      return s.state;
    };
    let pool: WorkerPool, scaleX = 1, scaleY = 1;
    try {
      const w = Math.max(8, Math.round(comp.width * p.scale / 8) * 8), h = Math.max(2, Math.round(comp.height * p.scale / 2) * 2);
      scaleX = w / comp.width; scaleY = h / comp.height;
      pool = new WorkerPool();
      const out = new OffscreenCanvas(w, h);
      const compositor = new Compositor(out, w, h, { preserve: false });
      const frame0 = evaluator.frame(p.t, p.compId);
      const times = subTimes(p.t, frame0.motionBlur.samples, frame0.motionBlur.shutter, comp);
      compositor.begin();
      for (const ts of times) {
        const frame = evaluator.frame(ts, p.compId);
        const scratch = pool.get(w, h);
        drawFrame(scratch, frame, envOf({ t: ts }, p.compId));
        compositor.add(scratch.canvas as unknown as OffscreenCanvas, 1 / times.length);
        pool.release(scratch);
      }
      const frame = evaluator.frame(p.t, p.compId);
      const { fx, seed } = finishOf(frame.effects, frame.frame);
      const bg = frame.background ? parseColor(frame.background) : null;
      const passes = frame.effects.flatMap((e) => {
        const type = reg.hasEffect(e.type) ? reg.effect(e.type) : null;
        return type?.stage === 'finish' && type.gl ? [{ code: type.gl.code, schema: type.props, props: e.props }] : [];
      });
      compositor.finish(fx, { bg: bg ? [toLin(bg[0] / 255), toLin(bg[1] / 255), toLin(bg[2] / 255)] : null, checker: false }, seed, { passes, t: frame.t, scale: (scaleX + scaleY) / 2, onError: (e: Error) => { throw e; } });
      const bitmap = await createImageBitmap(out);
      return { bitmap, transfer: [bitmap as unknown as Transferable] };
    } catch (e) {
      return { err: (e as Error).message };
    }
  };

  return {
    renderFrame,
    setDoc(d: SandboxDoc) {
      side.doc = d.doc as Record<string, unknown>;
      side.docUrl = d.docUrl;
      side.images = new Map(Object.entries(d.images ?? {}));
      side.json = new Map(Object.entries(d.json ?? {}));
      for (const f of d.fonts ?? []) {
        if (side.fonts.has(f.url)) continue;
        side.fonts.add(f.url);
        void fetch(f.url).then((r) => r.arrayBuffer()).then((data) => {
          const face = new FontFace(f.family, data, { weight: f.weight ?? '400' });
          return face.load();
        }).then((face) => self_.fonts.add(face)).catch(() => {});
      }
    },

    async draw(payload: DrawPayload) {
      const results = await Promise.all(payload.items.map(async (item): Promise<DrawResult> => {
        const node = nodeOf(item.type);
        if (!node) return { id: item.id, ok: false, err: `unknown node type: ${item.type}` };
        const host = hostOf(item, payload);
        let area = FALLING_AREA;
        try { area = node.bounds?.(item.props, host) ?? FALLING_AREA; } catch { area = FALLING_AREA; }
        const w = Math.min(MAX_PIXELS, Math.max(1, Math.round(area.w))), h = Math.min(MAX_PIXELS, Math.max(1, Math.round(area.h)));
        // the outline crosses as SVG path data: the node's `path` runs with a recording Path2D in place of the real one
        let pathData: string | undefined;
        if (node.path) {
          const realm = globalThis as { Path2D?: unknown };
          const real = realm.Path2D;
          realm.Path2D = RecordingPath2D;
          try {
            const p = node.path(item.props, host);
            pathData = p ? String(p) : undefined;
          } catch { pathData = undefined; }
          finally { realm.Path2D = real; }
        }
        let handles: unknown[] | undefined;
        if (node.handles) {
          try { const hs = node.handles(item.props); if (Array.isArray(hs)) handles = hs; } catch { handles = undefined; }
        }
        try {
          if (node.render.canvas2d) {
            const canvas = new OffscreenCanvas(w, h);
            // the same 2D surface API the engine draws with, on an OffscreenCanvas
            const ctx = canvas.getContext('2d', { alpha: true })! as unknown as CanvasRenderingContext2D;
            // the plugin draws in local units: the bounds' corner becomes the origin
            ctx.translate(-area.x, -area.y);
            node.render.canvas2d(ctx, item.props, host);
            const bitmap = await createImageBitmap(canvas);
            return { id: item.id, ok: true, bitmap, area, ...(pathData ? { path: pathData } : {}), ...(handles ? { handles } : {}) };
          }
          if (node.render.gl) {
            const g = nodeContext(`sandbox/${item.type}`);
            resizeNode(g, w, h);
            node.render.gl(g, item.props, host, area);
            const bitmap = await createImageBitmap(g.canvas as OffscreenCanvas, 0, (g.canvas as OffscreenCanvas).height - h, w, h);
            return { id: item.id, ok: true, bitmap, area, ...(pathData ? { path: pathData } : {}), ...(handles ? { handles } : {}) };
          }
          return { id: item.id, ok: false, err: `${item.type} draws nothing` };
        } catch (e) {
          return { id: item.id, ok: false, err: (e as Error).message };
        }
      }));
      const transfer: Transferable[] = results.flatMap((r) => (r.ok && r.bitmap ? [r.bitmap as Transferable] : []));
      return { results, transfer };
    },

    async exportOf(type: string, props: unknown) {
      const node = nodeOf(type);
      if (!node?.export) return { err: node ? `${type} has no vector export` : `unknown node type: ${type}` };
      try {
        return { svg: node.export.svg?.(props), lottie: node.export.lottie?.(props) };
      } catch (e) {
        return { err: (e as Error).message };
      }
    },
  };
}
