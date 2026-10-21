// Speed presets (docs/editing-roadmap.md, step 2): the speed curves an editor
// reaches for, written as `rate` keyframes around a moment of a video or
// sound layer (the playhead): a ramp into slow motion, a ramp out of it, the
// hero moment (fast, slow on the hit, fast) and the bullet (almost frozen).

import type { Keyframe } from '@tramme/core';

export type SpeedPreset = 'rampIn' | 'rampOut' | 'hero' | 'bullet';
export const SPEED_PRESETS: SpeedPreset[] = ['rampIn', 'rampOut', 'hero', 'bullet'];

const SMOOTH: [number, number, number, number] = [0.42, 0, 0.58, 1];

/** the shape of each preset: [seconds from the moment, speed], eased between */
const SHAPES: Record<SpeedPreset, [number, number][]> = {
  rampIn: [[-0.8, 1], [0, 0.3]],
  rampOut: [[0, 0.3], [0.8, 1]],
  hero: [[-1, 2], [-0.25, 0.25], [0.25, 0.25], [1, 2]],
  bullet: [[-0.5, 1], [-0.1, 0.05], [0.6, 0.05], [1, 1]],
};

/**
 * The rate keyframes of a preset around `at`, inside the layer's span
 * [from, to): the shape moved to fit when the moment is near an end, its
 * keys eased, the last one held as it is.
 */
export function speedKeys(preset: SpeedPreset, at: number, from: number, to: number): Keyframe[] {
  const shape = SHAPES[preset];
  const lo = shape[0][0], hi = shape[shape.length - 1][0];
  // the moment moved so the whole shape fits the layer (a layer too short for it squeezes the shape)
  const span = hi - lo, room = Math.max(0, to - from - 1e-3), k = span > room && span > 0 ? room / span : 1;
  const m = Math.min(Math.max(at, from - lo * k), to - 1e-3 - hi * k);
  return shape.map(([dt, v], i) => {
    const key: Keyframe = { t: +(m + dt * k).toFixed(4), v };
    return i < shape.length - 1 ? { ...key, ease: SMOOTH } : key;
  });
}
