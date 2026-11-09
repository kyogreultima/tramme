import { DEFAULT_PERSPECTIVE, layerQuad, type Evaluator, type Quad, type Vec2 } from '@tramme/core';

/** Four evaluated corners of a layer, including its node bounds and camera. */
export function quadAt(ev: Evaluator, compId: string, id: string, t: number): Quad {
  const frame = ev.frame(t, compId), L = frame.layers.find((x) => x.id === id);
  if (!L) throw new Error(`${id}: not drawn at ${t.toFixed(2)} s (outside its in and out points, or hidden)`);
  const host = { layerId: id, t, frame: Math.round(t * frame.comp.fps), fps: frame.comp.fps, width: frame.comp.width, height: frame.comp.height, duration: frame.comp.duration, asset: () => null, assetInfo: () => undefined, assetUrl: () => '' };
  let box = null;
  try { box = L.node.bounds?.(L.props, host as never) ?? null; } catch { box = null; }
  const size = L.props.size as Vec2 | undefined;
  box ??= size ? { x: -size[0] / 2, y: -size[1] / 2, w: size[0], h: size[1] } : null;
  if (!box) throw new Error(`${id}: a layer with no size cannot be followed`);
  return layerQuad(L, box, [1, 0, 0, 1, 0, 0], frame.camera?.perspective ?? DEFAULT_PERSPECTIVE);
}
