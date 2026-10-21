// Canvas2D backend: draws an evaluated frame, layer by layer, each in its
// local space (translate position, rotate, scale, minus anchor).
// A layer with effects is drawn alone on an offscreen canvas of the frame's
// size, its effects applied, then composited with its opacity, blend mode and
// filters. Without effects, a group's opacity multiplies into each child (no
// offscreen pass), so overlapping children of a half-transparent group show
// through each other; give the group an effect to composite it as one.
// Effects written in GLSL run on the layer's pixels through the GPU, with
// the layers their props name drawn alone beside it (mattes, displacement).
// When the environment isolates errors (the editor's preview), a layer that
// fails is drawn as a red frame and reported; the rest of the frame renders.

import { layerMatrix, pathD, type BlendMode, type Lut3D, type PathValue, type EvaluatedFrame, type EvaluatedLayer, type EvaluatedTransform, type Host, type Registry } from '@tramme/core';
import { glPass, nodeContext, resizeNode } from './gpu.ts';

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  darken: 'darken', lighten: 'lighten', add: 'lighter',
};

export const localMatrix = (tr: EvaluatedTransform): DOMMatrix => new DOMMatrix(layerMatrix(tr));

export type HostFactory = (layerId: string) => Host;

/** offscreen canvases for layer effects, reused from frame to frame */
export class CanvasPool {
  private free: HTMLCanvasElement[] = [];
  private cpu: boolean;
  constructor(cpu = true) { this.cpu = cpu; }
  /** the canvas class a pool builds (a worker builds OffscreenCanvases) */
  protected make(): HTMLCanvasElement { return document.createElement('canvas'); }
  get(w: number, h: number): CanvasRenderingContext2D {
    const c = this.free.pop() ?? this.make();
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d', { alpha: true, willReadFrequently: this.cpu })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }
  release(ctx: CanvasRenderingContext2D) { this.free.push(ctx.canvas); }
}

export interface DrawEnv {
  host: HostFactory;
  registry: Registry;
  pool: CanvasPool;
  /** canvas pixels per composition pixel (previews draw smaller); [1, 1] for exports */
  scale?: [number, number];
  /** set: a layer that fails is drawn as a red frame and reported here instead of failing the frame */
  onError?: (layerId: string, error: Error) => void;
  /** a layer of the composition evaluated at this instant, even hidden (layer inputs of effects) */
  layerAt?: (layerId: string) => EvaluatedLayer | null;
  /** the composition time of the frame (GLSL effects' uTime) */
  t?: number;
}

/** a layer that failed: its outline in red, hatched, so the problem shows where it is */
function drawFailure(ctx: CanvasRenderingContext2D, L: EvaluatedLayer, env: DrawEnv) {
  let b: { x: number; y: number; w: number; h: number } | null = null;
  try { b = L.node.bounds?.(L.props, env.host(L.id)) ?? null; } catch { b = null; }
  b ??= { x: -60, y: -60, w: 120, h: 120 };
  ctx.save();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.strokeStyle = '#FF3B30'; ctx.fillStyle = 'rgba(255,59,48,0.18)'; ctx.lineWidth = 4;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.w, b.y + b.h); ctx.moveTo(b.x + b.w, b.y); ctx.lineTo(b.x, b.y + b.h); ctx.stroke();
  ctx.restore();
}

/** the node and its children, in the layer's local space (transform already applied) */
function drawContent(ctx: CanvasRenderingContext2D, L: EvaluatedLayer, env: DrawEnv) {
  const draw = L.node.render.canvas2d;
  if (draw) {
    ctx.save();
    try { draw(ctx, L.props, env.host(L.id)); }
    catch (e) {
      if (!env.onError) throw e;
      ctx.restore(); ctx.save();
      drawFailure(ctx, L, env);
      env.onError(L.id, e as Error);
    }
    ctx.restore();
  }
  const glo = L.node.render.gl;
  if (glo) {
    // the node's own WebGL2 context, sized to its bounds (at most 2048: a zoomed or huge node would ask the GPU for a canvas as big as the frame); the picture lands on the layer over the area
    const k = env.scale ? (env.scale[0] + env.scale[1]) / 2 : 1;
    const b = L.node.bounds?.(L.props, env.host(L.id)) ?? { x: -60, y: -60, w: 120, h: 120 };
    const w = Math.min(2048, Math.max(1, Math.round(b.w * k))), h = Math.min(2048, Math.max(1, Math.round(b.h * k)));
    ctx.save();
    try {
      const g = nodeContext(L.node.type);
      resizeNode(g, w, h);
      glo(g, L.props, env.host(L.id), b);
      // the node drew its corner of the shared canvas: w × h from GL's bottom left, the top of the canvas below it
      ctx.drawImage(g.canvas as CanvasImageSource, 0, g.canvas.height - h, w, h, b.x, b.y, b.w, b.h);
    } catch (e) {
      if (!env.onError) throw e;
      drawFailure(ctx, L, env);
      env.onError(L.id, e as Error);
    }
    ctx.restore();
  }
  for (const child of L.children) drawLayer(ctx, child, env);
}

/** another layer drawn alone on a canvas of the frame's size, as it shows in the frame (an effect's layer input) */
function layerPicture(like: CanvasRenderingContext2D, id: string, env: DrawEnv): CanvasRenderingContext2D | null {
  const L = env.layerAt?.(id);
  if (!L) return null;
  const off = env.pool.get(like.canvas.width, like.canvas.height);
  if (env.scale) off.setTransform(env.scale[0], 0, 0, env.scale[1], 0, 0);
  // drawn even when hidden: a matte layer is usually hidden
  drawLayer(off, { ...L, layer: { ...L.layer, visible: true } }, env);
  return off;
}

/**
 * A layer's drawn masks, applied to its picture (`off`, in canvas pixels):
 * each mask's outline drawn in the layer's space (`at`: the canvas transform
 * of the layer), grown or shrunk, feathered, inverted, at its opacity, then
 * combined with the masks before it (add: union; subtract: taken out;
 * intersect: kept where both are). The picture keeps what they let through.
 */
function applyMasks(off: CanvasRenderingContext2D, masks: EvaluatedLayer['masks'], at: DOMMatrix, env: DrawEnv) {
  const { width: w, height: h } = off.canvas;
  const k = env.scale ? (env.scale[0] + env.scale[1]) / 2 : 1;
  const all = env.pool.get(w, h), one = env.pool.get(w, h);
  masks.forEach((mk, i) => {
    const p = mk.props, mode = String(p.mode ?? 'add');
    const feather = Math.max(0, Number(p.feather) || 0), grow = Number(p.expansion) || 0, opacity = Math.min(1, Math.max(0, Number(p.opacity ?? 1)));
    const outline = new Path2D(pathD(p.path as PathValue));
    one.setTransform(1, 0, 0, 1, 0, 0);
    one.globalCompositeOperation = 'source-over';
    one.filter = 'none';
    one.clearRect(0, 0, w, h);
    one.setTransform(at);
    one.fillStyle = one.strokeStyle = '#ffffff';
    one.lineJoin = 'round';
    if (feather > 0) one.filter = `blur(${(feather * k) / 2}px)`;
    one.fill(outline);
    // grown: its edge stroked on; shrunk: its edge stroked off
    if (grow !== 0) {
      one.lineWidth = Math.abs(grow) * 2;
      one.globalCompositeOperation = grow > 0 ? 'source-over' : 'destination-out';
      one.stroke(outline);
    }
    // inverted: what lies outside it
    if (p.invert === true) {
      one.setTransform(1, 0, 0, 1, 0, 0);
      one.filter = 'none';
      one.globalCompositeOperation = 'xor';
      one.fillStyle = '#ffffff';
      one.fillRect(0, 0, w, h);
    }
    // what the masks before it let through: everything, when the first one takes away or intersects
    if (i === 0 && mode !== 'add') all.fillRect(0, 0, w, h);
    all.globalAlpha = opacity;
    all.globalCompositeOperation = mode === 'subtract' ? 'destination-out' : mode === 'intersect' ? 'destination-in' : 'source-over';
    all.drawImage(one.canvas, 0, 0);
  });
  off.save();
  off.setTransform(1, 0, 0, 1, 0, 0);
  off.globalAlpha = 1;
  off.filter = 'none';
  off.globalCompositeOperation = 'destination-in';
  off.drawImage(all.canvas, 0, 0);
  off.restore();
  env.pool.release(one);
  env.pool.release(all);
}

/** the LUT tables an effect's lut props name, as the asset store loaded them */
const lutsOf = (env: DrawEnv, id: string) => (_name: string, value: unknown): Lut3D | null => {
  if (typeof value !== 'string' || !value) return null;
  try { const v = env.host(id).asset<Lut3D>(value); return v && v.kind === 'lut3d' ? v : null; } catch { return null; }
};

function drawLayer(ctx: CanvasRenderingContext2D, L: EvaluatedLayer, env: DrawEnv) {
  if (L.transform.opacity <= 0) return;
  if (!L.node.render.canvas2d && !L.node.render.gl && !L.children.length) return;
  ctx.save();
  if (L.clip?.node.path) {
    const outline = L.clip.node.path(L.clip.props, env.host(L.clip.id));
    if (outline) {
      const p = new Path2D();
      p.addPath(outline, localMatrix(L.clip.transform));
      ctx.clip(p);
    }
  }
  const m = localMatrix(L.transform);
  const fx = L.effects
    .map((e) => ({ e, type: env.registry.hasEffect(e.type) ? env.registry.effect(e.type) : null }))
    .filter((x) => x.type?.stage === 'layer' && (x.type.canvas2d || x.type.gl));
  const masks = L.masks ?? [];
  if (fx.length || masks.length) {
    const { width: w, height: h } = ctx.canvas;
    const off = env.pool.get(w, h);
    off.setTransform(ctx.getTransform());
    off.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    const at = off.getTransform();
    drawContent(off, L, env);
    // the masks cut the picture before its effects: a feathered mask then blurs with the layer, as in an editor
    if (masks.length) applyMasks(off, masks, at, env);
    // effect sizes are in composition pixels: they follow the render scale
    const k = env.scale ? (env.scale[0] + env.scale[1]) / 2 : 1;
    for (const { e, type } of fx) {
      try {
        if (type!.gl) {
          // the layers named by the effect's layer props, drawn alone beside it
          const inputs: Record<string, CanvasRenderingContext2D | null> = {};
          for (const [name, d] of Object.entries(type!.props)) if (d.type === 'layer' && typeof e.props[name] === 'string' && e.props[name] !== L.id) inputs[name] = layerPicture(off, e.props[name] as string, env);
          glPass(off, type!.gl.code, type!.props, e.props, env.t ?? 0, k, Object.fromEntries(Object.entries(inputs).map(([n, c]) => [n, c?.canvas ?? null])), L.layer.in ?? 0, lutsOf(env, L.id));
          for (const c of Object.values(inputs)) if (c) env.pool.release(c);
        } else type!.canvas2d?.apply?.(off, e.props, k, env.host(L.id));
      } catch (err) {
        if (!env.onError) throw err;
        env.onError(L.id, new Error(`effect ${e.type}: ${(err as Error).message}`));
      }
    }
    const filter = fx.map(({ e, type }) => type!.canvas2d?.filter?.(e.props, k) ?? '').filter(Boolean).join(' ');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= L.transform.opacity;
    if (L.layer.blend && L.layer.blend !== 'normal') ctx.globalCompositeOperation = BLEND[L.layer.blend];
    if (filter) ctx.filter = filter;
    // a filter runs over what it is given: the layer's box grown by the filters' reach, not the whole frame (outside it the layer is empty)
    const box = filter ? filterBox(L, env, at, fx, k, w, h) : null;
    if (box) {
      // clipped too: the filter's own layer is as large as the clip
      if (box.w > 0 && box.h > 0) { ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip(); ctx.drawImage(off.canvas, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h); }
    }
    else ctx.drawImage(off.canvas, 0, 0);
    env.pool.release(off);
  } else {
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.globalAlpha *= L.transform.opacity;
    if (L.layer.blend && L.layer.blend !== 'normal') ctx.globalCompositeOperation = BLEND[L.layer.blend];
    drawContent(ctx, L, env);
  }
  ctx.restore();
}

type Box = { x: number; y: number; w: number; h: number };
/** what a node may draw past its bounds (a stroke's half, a glyph's overhang), in its own pixels */
const INK = 48;

/** a layer's box on the canvas (`at`: its canvas transform), its children's included; null when one of them cannot say (no bounds, effects of its own) */
function canvasBox(L: EvaluatedLayer, env: DrawEnv, at: DOMMatrix): Box | null {
  let b: Box | null = null;
  if (L.node.render.canvas2d || L.node.render.gl) {
    // a node's bounds are its box, not always its ink: what simulates or holds a composition may draw anywhere
    if (!L.node.bounds || L.node.simulate || L.node.composes || L.layer.type === 'comp') return null;
    try { b = L.node.bounds(L.props, env.host(L.id)); } catch { return null; }
    if (!b) return null;
    // strokes, glyphs and antialiasing reach past the box: a margin in composition pixels
    const m = INK + 0.05 * Math.max(b.w, b.h);
    b = { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  if (b) for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
    const px = at.a * x + at.c * y + at.e, py = at.b * x + at.d * y + at.f;
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  for (const c of L.children) {
    if (c.effects.length || c.node.composes) return null;
    const m = localMatrix(c.transform), cb = canvasBox(c, env, at.multiply(m));
    if (!cb) return null;
    x0 = Math.min(x0, cb.x); y0 = Math.min(y0, cb.y); x1 = Math.max(x1, cb.x + cb.w); y1 = Math.max(y1, cb.y + cb.h);
  }
  return x0 === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The part of a layer's picture its filters need to run over: its box grown
 * by what each filter spreads, in whole pixels, within the canvas (empty
 * when it falls outside); null for the whole frame, when a filter does not
 * say how far it reaches or an effect draws by code.
 */
export function filterBox(L: EvaluatedLayer, env: DrawEnv, at: DOMMatrix, fx: { e: { props: Record<string, unknown> }; type: { canvas2d?: { filter?: unknown; reach?: (p: any, k: number) => number; apply?: unknown }; gl?: unknown } | null }[], k: number, w: number, h: number): Box | null {
  let reach = 0;
  for (const { e, type } of fx) {
    if (type!.gl || type!.canvas2d?.apply || !type!.canvas2d?.reach) return null;
    reach += type!.canvas2d.reach(e.props, k);
  }
  const b = canvasBox(L, env, at);
  if (!b || !Number.isFinite(reach)) return null;
  const x0 = Math.max(0, Math.floor(b.x - reach)), y0 = Math.max(0, Math.floor(b.y - reach));
  const x1 = Math.min(w, Math.ceil(b.x + b.w + reach)), y1 = Math.min(h, Math.ceil(b.y + b.h + reach));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** draw layers over what the context already holds (nested compositions) */
export function drawLayers(ctx: CanvasRenderingContext2D, layers: EvaluatedLayer[], env: DrawEnv) {
  for (const L of layers) {
    if (L.node.composes === 'adjust') adjustOver(ctx, L, env);
    else drawLayer(ctx, L, env);
  }
}

/**
 * An adjustment layer: everything already drawn on the context is run once
 * more through the layer's effects, then composited back with its opacity and
 * blend mode. The frame is copied only when such a layer exists and carries
 * effects — a composition without one pays nothing.
 */
function adjustOver(ctx: CanvasRenderingContext2D, L: EvaluatedLayer, env: DrawEnv) {
  const fx = L.effects
    .map((e) => ({ e, type: env.registry.hasEffect(e.type) ? env.registry.effect(e.type) : null }))
    .filter((x) => x.type?.stage === 'layer' && (x.type.canvas2d || x.type.gl));
  if (!fx.length || L.transform.opacity <= 0) return;
  const { width: w, height: h } = ctx.canvas;
  const off = env.pool.get(w, h);
  off.drawImage(ctx.canvas, 0, 0);
  // effect sizes are in composition pixels: they follow the render scale
  const k = env.scale ? (env.scale[0] + env.scale[1]) / 2 : 1;
  for (const { e, type } of fx) {
    try {
      if (type!.gl) {
        const inputs: Record<string, CanvasRenderingContext2D | null> = {};
        for (const [name, d] of Object.entries(type!.props)) if (d.type === 'layer' && typeof e.props[name] === 'string' && e.props[name] !== L.id) inputs[name] = layerPicture(off, e.props[name] as string, env);
        glPass(off, type!.gl.code, type!.props, e.props, env.t ?? 0, k, Object.fromEntries(Object.entries(inputs).map(([n, c]) => [n, c?.canvas ?? null])), L.layer.in ?? 0, lutsOf(env, L.id));
        for (const c of Object.values(inputs)) if (c) env.pool.release(c);
      } else type!.canvas2d?.apply?.(off, e.props, k, env.host(L.id));
    } catch (err) {
      if (!env.onError) throw err;
      env.onError(L.id, new Error(`effect ${e.type}: ${(err as Error).message}`));
    }
  }
  const filter = fx.map(({ e, type }) => type!.canvas2d?.filter?.(e.props, k) ?? '').filter(Boolean).join(' ');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= L.transform.opacity;
  if (L.layer.blend && L.layer.blend !== 'normal') ctx.globalCompositeOperation = BLEND[L.layer.blend];
  if (filter) ctx.filter = filter;
  ctx.drawImage(off.canvas, 0, 0);
  ctx.restore();
  env.pool.release(off);
}

/**
 * The layers through the composition's 2.5D camera: each root layer at its
 * depth d is scaled by zoom · p / (p + d) around the point the camera looks
 * at, so far layers move less (parallax), and blurred by its distance to the
 * focus. Children follow their parent.
 */
function drawThroughCamera(ctx: CanvasRenderingContext2D, frame: EvaluatedFrame, env: DrawEnv) {
  const cam = frame.camera!, { width: W, height: H } = frame.comp;
  const k = env.scale ? (env.scale[0] + env.scale[1]) / 2 : 1;
  /** a root layer as the camera sees it; null at or behind the eye */
  const place = (L: EvaluatedLayer): EvaluatedLayer | null => {
    const d = L.transform.depth ?? 0;
    if (cam.perspective + d <= 1) return null;
    const s = (cam.zoom * cam.perspective) / (cam.perspective + d);
    const [x, y] = L.transform.position, [sx, sy] = L.transform.scale;
    return { ...L, transform: { ...L.transform, position: [W / 2 + (x - W / 2 - cam.pan[0]) * s, H / 2 + (y - H / 2 - cam.pan[1]) * s] as [number, number], scale: [sx * s, sy * s] as [number, number] } };
  };
  // a root layer drawn alone for an effect (a matte, a displacement map) goes through the camera too, so it lines up with what it shapes
  const roots = new Set(frame.comp.order);
  const seen: DrawEnv = { ...env, layerAt: (id) => { const L = env.layerAt?.(id) ?? null; return L && roots.has(id) ? place(L) : L; } };
  for (const L of frame.layers) {
    const placed = place(L);
    if (!placed) continue;
    const d = L.transform.depth ?? 0;
    const blur = cam.blur > 0 ? (cam.blur * Math.abs(d - cam.focus)) / 1000 : 0;
    ctx.filter = blur > 0.25 ? `blur(${blur * k}px)` : 'none';
    drawLayer(ctx, placed, seen);
  }
  ctx.filter = 'none';
}

/** the layers of a frame over what the context holds, through its composition's camera when it has one (nested compositions too) */
export function drawComposed(ctx: CanvasRenderingContext2D, frame: EvaluatedFrame, env: DrawEnv) {
  if (frame.camera) drawThroughCamera(ctx, frame, env);
  else drawLayers(ctx, frame.layers, env);
}

/** clear the canvas and draw the frame's layers (the background plate is the compositor's job) */
export function drawFrame(ctx: CanvasRenderingContext2D, frame: EvaluatedFrame, env: DrawEnv) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (env.scale) ctx.setTransform(env.scale[0], 0, 0, env.scale[1], 0, 0);
  drawComposed(ctx, frame, env);
}
