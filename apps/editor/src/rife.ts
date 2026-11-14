// The frames between two frames by RIFE (hzwer's Practical-RIFE weights,
// MIT), run in the browser with onnxruntime: the two frames stacked as six
// planes of 0..1 and a time between them in, the frame at that time out,
// at any size (the graph pads and crops itself). A large frame (4K) is made
// in overlapping tiles blended over their overlap: a whole one asks the GPU
// for more than the system lets a single pass take, and it resets the
// device. A model that cannot load is no reason to stop: the caller falls
// back on the core's block-matching motion.

import { segmentsOf, weightAt, type Segment } from '@tramme/core';
import type { ModelEntry } from './models.ts';
import { dropSession, sessionOf } from './onnx-session.ts';

export interface Rgba { width: number; height: number; data: Uint8ClampedArray }

/** the largest frame made whole (1080p), the largest side of a tile beyond it, and the share of a tile two overlap by: wide enough to hold a fast move across the seam */
export const WHOLE = 1920 * 1088, TILE = 1280, TILE_OVERLAP = 0.2;

/** a region of a frame */
export interface Region { x: number; y: number; width: number; height: number }

/** two pictures of one size as six planes of 0..1, the first's red, green, blue, then the second's; of `r` alone when given */
export function stacked(a: Rgba, b: Rgba, r: Region = { x: 0, y: 0, width: a.width, height: a.height }): Float32Array {
  const plane = r.width * r.height, out = new Float32Array(6 * plane);
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
    const o = y * r.width + x, i = ((r.y + y) * a.width + r.x + x) * 4;
    out[o] = a.data[i] / 255; out[plane + o] = a.data[i + 1] / 255; out[2 * plane + o] = a.data[i + 2] / 255;
    out[3 * plane + o] = b.data[i] / 255; out[4 * plane + o] = b.data[i + 1] / 255; out[5 * plane + o] = b.data[i + 2] / 255;
  }
  return out;
}

/** three planes of 0..1 back to an opaque picture */
export function fromPlanes(planes: ArrayLike<number>, width: number, height: number): Rgba {
  const plane = width * height, data = new Uint8ClampedArray(plane * 4);
  for (let o = 0; o < plane; o++) {
    const i = o * 4;
    data[i] = planes[o] * 255; data[i + 1] = planes[plane + o] * 255; data[i + 2] = planes[2 * plane + o] * 255; data[i + 3] = 255;
  }
  return { width, height, data };
}

/** the tiles covering a frame, no side over `size`, neighbours overlapping; one tile for a frame up to 1080p */
export function tilesOf(width: number, height: number, size = width * height <= WHOLE ? Infinity : TILE, overlap = TILE_OVERLAP): { region: Region; xs: [Segment, number, number]; ys: [Segment, number, number] }[] {
  const xs = segmentsOf(width, size, overlap), ys = segmentsOf(height, size, overlap);
  return ys.flatMap((y, j) => xs.map((x, i) => ({ region: { x: x.from, y: y.from, width: x.length, height: y.length }, xs: [x, i, xs.length] as [Segment, number, number], ys: [y, j, ys.length] as [Segment, number, number] })));
}

/**
 * A frame laid back from its tiles' planes: each tile's pixels added with
 * the crossfade weight of their place along both sides, then divided by the
 * weights' sum, so the seams blend.
 */
export class TileBlend {
  readonly width: number;
  readonly height: number;
  private rgb: Float32Array;
  private sum: Float32Array;
  constructor(width: number, height: number) {
    this.width = width; this.height = height;
    this.rgb = new Float32Array(3 * width * height); this.sum = new Float32Array(width * height);
  }
  add(tile: ReturnType<typeof tilesOf>[number], planes: ArrayLike<number>, overlap = TILE_OVERLAP) {
    const { region: r, xs: [sx, i, nx], ys: [sy, j, ny] } = tile, plane = r.width * r.height;
    const fx = Math.round(sx.length * overlap), fy = Math.round(sy.length * overlap);
    for (let y = 0; y < r.height; y++) {
      const wy = weightAt(y, r.height, fy, j === 0, j === ny - 1);
      for (let x = 0; x < r.width; x++) {
        const w = wy * weightAt(x, r.width, fx, i === 0, i === nx - 1), o = y * r.width + x, p = (r.y + y) * this.width + r.x + x;
        this.rgb[3 * p] += planes[o] * w; this.rgb[3 * p + 1] += planes[plane + o] * w; this.rgb[3 * p + 2] += planes[2 * plane + o] * w;
        this.sum[p] += w;
      }
    }
  }
  done(): Rgba {
    const n = this.width * this.height, data = new Uint8ClampedArray(n * 4);
    for (let p = 0; p < n; p++) {
      const w = this.sum[p] || 1;
      data[4 * p] = (this.rgb[3 * p] / w) * 255; data[4 * p + 1] = (this.rgb[3 * p + 1] / w) * 255; data[4 * p + 2] = (this.rgb[3 * p + 2] / w) * 255; data[4 * p + 3] = 255;
    }
    return { width: this.width, height: this.height, data };
  }
}

/** the frames at times `ts` (strictly between 0 and 1) between a and b, made by the model, tile by tile on a large frame */
export async function betweenWithModel(entry: ModelEntry, a: Rgba, b: Rgba, ts: number[], signal?: AbortSignal, opts: { cpu?: boolean; tile?: number } = {}): Promise<Rgba[]> {
  if (entry.adapter.kind !== 'rife') throw new Error(`${entry.name} is not a frame interpolation model`);
  const { session, ort } = await sessionOf(entry, opts);
  const tiles = tilesOf(a.width, a.height, opts.tile);
  if (tiles.length === 1) {
    const input = new ort.Tensor('float32', stacked(a, b), [1, 6, a.height, a.width]), out: Rgba[] = [];
    for (const t of ts) {
      if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
      const r = await session.run({ input, timestep: new ort.Tensor('float32', new Float32Array([t]), []) });
      out.push(fromPlanes(r[session.outputNames[0]].data, a.width, a.height));
    }
    return out;
  }
  const blends = ts.map(() => new TileBlend(a.width, a.height));
  for (const tile of tiles) {
    const input = new ort.Tensor('float32', stacked(a, b, tile.region), [1, 6, tile.region.height, tile.region.width]);
    for (let k = 0; k < ts.length; k++) {
      if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
      const r = await session.run({ input, timestep: new ort.Tensor('float32', new Float32Array([ts[k]]), []) });
      blends[k].add(tile, r[session.outputNames[0]].data);
    }
  }
  return blends.map((x) => x.done());
}

/**
 * The model run over a whole video, frame pair after frame pair: a pair that
 * fails (the GPU lost, its device reset by the system) is made again on a
 * new session, then on the processor, which every later pair keeps. `made`
 * counts the pairs the model made, so a caller knows whether it may still
 * hand the whole video to another engine or must stop and resume later.
 */
export class RifeRun {
  made = 0;
  cpu = false;
  readonly entry: ModelEntry;
  constructor(entry: ModelEntry) { this.entry = entry; }
  async between(a: Rgba, b: Rgba, ts: number[], signal?: AbortSignal): Promise<Rgba[]> {
    for (let attempt = 0; ; attempt++) {
      try {
        const out = await betweenWithModel(this.entry, a, b, ts, signal, { cpu: this.cpu });
        this.made++;
        return out;
      } catch (e) {
        if ((e as Error).name === 'AbortError' || signal?.aborted) throw e;
        dropSession(this.entry, { cpu: this.cpu });
        // once more on a new session, then on the processor
        if (attempt === 0) continue;
        if (!this.cpu) { this.cpu = true; continue; }
        throw e;
      }
    }
  }
}
