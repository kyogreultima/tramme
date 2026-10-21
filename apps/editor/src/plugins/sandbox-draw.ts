// The page's half of the sandboxed drawing (stage 2 of plugin-isolation.md).
// A sandboxable node (one that needs no synchronous geometry on the page) is
// registered with a wrapper instead of its own draw: the wrapper asks the
// sandbox for the layer's picture at this frame and draws what comes back.
// The first pass of a frame has nothing yet, so it defers — renderComplete
// waits and draws again with the fresh picture, which keeps stills and
// exports exact — and a fast preview pass draws the layer's last picture
// rather than nothing. One sample per frame: a plugin layer's motion blur
// takes its picture at the first sub-time.

import type { EffectType, Handle, Host, ModifierType, NodeType, PluginModule, Rect, Registry, TrammeDoc } from '@tramme/core';
import { Evaluator } from '@tramme/core';
import type { Renderer } from '@tramme/render';
import type { PluginHost } from './host.ts';
import type { PluginDecl, SandboxDoc, SchemaModifier, SchemaNode } from './protocol.ts';

/** what the wrapper needs from the editor: the document and its loaded assets */
export interface SandboxContext {
  doc: TrammeDoc;
  docUrl: string;
  /** the loaded value of an asset (a picture, a json), or null */
  loaded(id: string): unknown | null;
}

let env: { host: () => PluginHost; context: () => SandboxContext | null } | null = null;

/** bound once by the preview: every sandboxed draw goes through the project's sandbox */
export function bindSandbox(e: { host: () => PluginHost; context: () => SandboxContext | null }) { env = e; }

/** identity of a set of evaluated props, for the caches the page reads synchronously */
const hash = (props: unknown) => {
  try { return JSON.stringify(props); } catch { return `${Date.now()}`; }
};

/**
 * The node as the page's registry holds it: schemas, notes, simulations
 * (still stepped on the page, their state shipped per frame), and every
 * geometry the page reads — outline, handles, vector export — served from
 * what the sandbox shipped with the frame's picture. The draw itself asks
 * the sandbox instead of the plugin's code.
 */
export function sandboxNode(node: NodeType): NodeType {
  const out: NodeType = {
    ...node,
    load: undefined,
    bounds: undefined,
    render: { canvas2d: (ctx, props, host) => drawSandboxed(ctx, host, node, props) },
  };
  if (node.path) out.path = (_props, host) => pathOf(host);
  if (node.handles) out.handles = (props) => handlesFor(node.type, props);
  if (node.export) {
    out.export = {
      svg: (props) => exportFor(node.type, props).svg!,
      lottie: (props) => exportFor(node.type, props).lottie as unknown[],
    };
  }
  return out;
}

interface Picture { frame: number; bitmap?: CanvasImageSource; area?: Rect; pathData?: string; handlesData?: unknown[]; err?: string }
/** the last picture of a layer (drawn again while the fresh one is in flight) */
const ready = new Map<string, Picture>();
/** the draws in flight, by layer and frame */
const pending = new Map<string, Promise<Picture>>();
/** the viewport handles, keyed by node type and props */
const handlesCache = new Map<string, unknown[]>();
/** the vector exports, keyed by node type and props */
const exportCache = new Map<string, { svg?: string; lottie?: unknown }>();
/** the declarations the sandbox sent, by plugin id (the page's registry may be built from them) */
const declareCache = new Map<string, PluginDecl>();

/** the declarations of a project's plugin, once the sandbox has them */
export function sandboxDeclaration(id: string): PluginDecl | null { return declareCache.get(id) ?? null; }
/** remembered as the sandbox reports a plugin's declarations (the page's registry may be built from them) */
export function noteSandboxDeclaration(d: PluginDecl) { declareCache.set(d.id, d); }
/** the plugins loaded in the sandbox, their declarations remembered (before a registry is built from them) */
export async function ensureDeclared(host: { ensure(p: { id: string; url: string }[]): Promise<Map<string, PluginDecl>> }, plugins: { id: string; url: string }[]): Promise<void> {
  for (const d of (await host.ensure(plugins)).values()) noteSandboxDeclaration(d);
}

const handlesFor = (type: string, props: unknown): Handle[] => (handlesCache.get(`${type}/${hash(props)}`) ?? []) as Handle[];
const exportFor = (type: string, props: unknown) => {
  const v = exportCache.get(`${type}/${hash(props)}`);
  if (!v?.svg && v?.lottie === undefined) throw new Error(`${type}: its vector export is computed in the sandbox and was not primed here`);
  return v;
};
/** the node's outline as it crossed, or null before the first frame */
const pathOf = (host: Host): Path2D | null => {
  const e = ready.get(host.layerId);
  return e?.pathData ? new Path2D(e.pathData) : null;
};

/**
 * The page's registry module built from a plugin's declarations: every schema
 * the interface reads, the same sandbox-backed draw and geometry the wrapped
 * module carries, and the data exports (tours, translations). No function of
 * the plugin's is on the page: this is what the renderer registers when the
 * sandbox owns the plugin's modules.
 */
export function declarationsModule(decl: PluginDecl, id: string): PluginModule {
  const nodeOf = (n: SchemaNode): NodeType => {
    const stub = { type: n.type } as NodeType;
    return {
      type: n.type, title: n.title, category: n.category, description: n.description, ai: n.ai, props: n.props,
      ...(n.container ? { container: true } : {}),
      render: { canvas2d: (ctx, props, host) => drawSandboxed(ctx, host, stub, props) },
      ...(n.hasPath ? { path: (_props: unknown, host: Host) => pathOf(host) } : {}),
      ...(n.hasHandles ? { handles: (props: unknown) => handlesFor(n.type, props) } : {}),
      ...(n.hasExport ? { export: { svg: (props: unknown) => exportFor(n.type, props).svg!, lottie: (props: unknown) => exportFor(n.type, props).lottie as unknown[] } } : {}),
    };
  };
  const modifierOf = (m: SchemaModifier): ModifierType => ({ ...m, apply: () => { throw new Error("a modifier's code does not cross the sandbox"); } }) as unknown as ModifierType;
  return {
    ...(decl.meta ? { meta: decl.meta } : {}),
    nodes: decl.nodes.map(nodeOf),
    effects: decl.effects.map((e) => ({ ...e })) as unknown as EffectType[],
    modifiers: decl.modifiers.map(modifierOf),
    ...(decl.tours.length ? { tours: decl.tours } : {}),
    ...(decl.messages ? { messages: decl.messages } : {}),
  } as PluginModule;
}

const FALLING: Rect = { x: -60, y: -60, w: 120, h: 120 };

function drawSandboxed(ctx: CanvasRenderingContext2D, host: Host, node: NodeType, props: unknown) {
  const entry = ready.get(host.layerId);
  if (entry && entry.frame === host.frame) {
    if (entry.err || !entry.bitmap || !entry.area) throw new Error(entry.err ?? `${node.type} drew nothing`);
    ctx.drawImage(entry.bitmap, entry.area.x, entry.area.y, entry.area.w, entry.area.h);
    return;
  }
  const key = `${host.layerId}/${host.frame}`;
  let p = pending.get(key);
  if (!p) {
    p = request(host, node.type, props, entry?.frame);
    pending.set(key, p);
    void p.then((r) => {
      const old = ready.get(host.layerId);
      if (old?.bitmap && old.bitmap !== r.bitmap) (old.bitmap as { close?(): void }).close?.();
      ready.set(host.layerId, { ...r, frame: host.frame });
      if (r.handlesData) handlesCache.set(`${node.type}/${hash(props)}`, r.handlesData);
    }).catch(() => {}).finally(() => pending.delete(key));
    host.defer?.(p);
  }
  // the last picture stands in until the fresh one has crossed
  if (entry?.bitmap && entry.area) ctx.drawImage(entry.bitmap, entry.area.x, entry.area.y, entry.area.w, entry.area.h);
}

async function request(host: Host, type: string, props: unknown, previousFrame?: number): Promise<Picture> {
  const e = env;
  if (!e) return { err: 'the plugin sandbox is not bound', frame: previousFrame ?? host.frame };
  const doc = e.context();
  if (!doc) return { err: 'no document to draw from', frame: previousFrame ?? host.frame };
  const h = e.host();
  ensureSandboxDoc(h, doc);
  // the other layers at this instant, for host.layer
  const comp = Object.values(doc.doc.compositions).find((c) => c.layers[host.layerId]);
  const layers = (comp?.order ?? []).map((id) => { const l = host.layer?.(id); return l ? { id, ...l } : null; }).filter((l) => !!l);
  const results = await h.draw({
    frame: host.frame,
    comp: { width: host.width, height: host.height, duration: host.duration, fps: host.fps },
    layers,
    items: [{ id: host.layerId, type, props, state: host.state?.(), t: host.t, frame: host.frame }],
  });
  const r = results.find((x) => x.id === host.layerId);
  if (!r) return { err: 'the sandbox sent no picture', frame: host.frame };
  return {
    bitmap: r.bitmap as CanvasImageSource | undefined,
    area: r.area,
    pathData: r.path,
    handlesData: r.handles,
    err: r.ok ? undefined : r.err,
    frame: host.frame,
  };
}

/** the document's side, sent when the document (or an asset) changed */
let lastDoc: TrammeDoc | null = null;
const shipped = new WeakSet<object>();
/** make sure the sandbox holds the document and its assets (idempotent) */
export function ensureSandboxDoc(host: PluginHost, doc: SandboxContext) {
  if (doc.doc === lastDoc) return;
  lastDoc = doc.doc;
  const images: Record<string, unknown> = {}, json: Record<string, unknown> = {};
  const fonts: SandboxDoc['fonts'] = [];
  for (const [id, a] of Object.entries(doc.doc.assets)) {
    if (shipped.has(a)) continue;
    shipped.add(a);
    if (a.type === 'image' || a.type === 'json') {
      const v = doc.loaded(id);
      if (v !== null) (a.type === 'image' ? images : json)[id] = v;
    } else if (a.type === 'font') {
      fonts.push({ url: new URL(a.src, doc.docUrl).href, family: a.family ?? id, weight: a.weight });
    }
  }
  host.setDoc({ doc: doc.doc, docUrl: doc.docUrl, images, json, fonts });
}

/** a project change invalidates what crossed (the previews rebind) */
export function resetSandbox() {
  lastDoc = null;
  for (const [, p] of pending) p.catch(() => {});
  pending.clear();
  for (const [, pic] of ready) (pic.bitmap as { close?(): void } | undefined)?.close?.();
  ready.clear();
  handlesCache.clear();
  exportCache.clear();
  declareCache.clear();
}

/** the sandbox's requests for a document's plugins: id and url (the asset's own, resolved against the document) */
export function pluginItemsOf(doc: TrammeDoc, docUrl: string): { id: string; url: string }[] {
  return (doc.plugins ?? []).map((id) => ({ id, url: new URL(String(doc.assets[id]?.src ?? ''), docUrl).href })).filter((p) => !!p.url);
}

/**
 * Every video asset's exact frame at t, decoded on the page (the sandbox
 * does not decode): shipped with the sandbox's render request.
 */
export async function sandboxVideoFrames(r: Renderer, doc: TrammeDoc, t: number): Promise<Record<string, unknown>> {
  const videos: Record<string, unknown> = {};
  for (const [id, a] of Object.entries(doc.assets)) {
    if (a.type !== 'video') continue;
    try {
      const va = r.assets.get<{ request?(x: number): Promise<void>; frameAt(x: number): { image: CanvasImageSource | null } | null } | null>(id);
      if (!va) continue;
      await va.request?.(t);
      const fr = va.frameAt(t);
      if (fr?.image) videos[id] = fr.image;
    } catch { /* not decodable: the node's draw says so */ }
  }
  return videos;
}

/** the sandbox's finished picture, shown through the renderer's own compositor (its canvas is WebGL) */
export function blitSandboxFrame(r: Renderer, bitmap: unknown, t: number, checker: boolean) {
  r.compositor.begin();
  r.compositor.add(bitmap as OffscreenCanvas, 1);
  r.compositor.finish({ bloom: 0, bloomThreshold: 0.85, vignette: 0, grain: 0, exposure: 1 }, { bg: null, checker }, 1, { t, scale: r.scale, onError: (e: Error) => { throw e; } });
}

/**
 * The vector exports of a document's sandboxed nodes, computed in the
 * sandbox and cached by props: called before a vector export (svg, Lottie)
 * so the page's synchronous read finds them.
 */
export async function primeSandboxExports(doc: TrammeDoc, registry: Registry, t: number) {
  const e = env;
  if (!e) return;
  const h = e.host();
  const evaluator = new Evaluator(doc, registry);
  const jobs: Promise<void>[] = [];
  for (const [cid, comp] of Object.entries(doc.compositions)) {
    for (const [id, layer] of Object.entries(comp.layers)) {
      if (!registry.hasNode(layer.type)) continue;
      const node = registry.node(layer.type);
      if (!node.export) continue;
      const placed = evaluator.layerAt(id, t, cid);
      if (!placed) continue;
      const key = `${layer.type}/${hash(placed.props)}`;
      if (exportCache.has(key)) continue;
      jobs.push(
        h.exportOf(layer.type, placed.props)
          .then((r) => { if (!r.err) exportCache.set(key, { svg: r.svg, lottie: r.lottie }); })
          .catch(() => {}),
      );
    }
  }
  await Promise.all(jobs);
}
