import { BUILTIN_CHECKS, Registry } from '@tramme/core';
import { timeShift } from './timeshift.ts';
import { bloom, blur, chromatic, color, curves, depthBlur, displace, exposure, glow, grade, grain, key, lut, matte, parallax, pin, shadow, smooth, tint, transition, vignette, wheels } from './effects.ts';
import { comp } from './comp.ts';
import { particles } from './particles.ts';
import { shader } from './shader.ts';
import { image } from './image.ts';
import { model } from './model.ts';
import { solid } from './solid.ts';
import { sequence } from './sequence.ts';
import { video } from './video.ts';
import { callout } from './callout.ts';
import { captions } from './captions.ts';
import { receipt, tag } from './events.ts';
import { follow } from './follow.ts';
import { rope } from './rope.ts';
import { cloth } from './cloth.ts';
import { flock } from './flock.ts';
import { audio, code, group } from './misc.ts';
import { adjust } from './adjust.ts';
import { ellipse, path, rect } from './shapes.ts';
import { counter, text } from './text.ts';
import { EFFECT_NOTES, NODE_NOTES } from './notes.ts';

export { canvasPaint, fillStroke, toPath2D } from './paint.ts';
export type { CodeEntry } from './misc.ts';
export const NODES = [rect, ellipse, path, image, model, solid, sequence, video, text, captions, counter, tag, receipt, callout, group, comp, adjust, particles, shader, follow, rope, cloth, flock, code, audio, timeShift];
export const EFFECTS = [vignette, grain, bloom, exposure, chromatic, grade, blur, shadow, glow, color, tint, matte, smooth, displace, parallax, depthBlur, transition, key, lut, curves, wheels, pin];
// notes for the assistant (list_nodes)
for (const n of NODES) n.ai ??= NODE_NOTES[n.type];
for (const e of EFFECTS) e.ai ??= EFFECT_NOTES[e.type];
export { DEFAULT_SHADER } from './shader.ts';
export { receiptRows, rowStarts } from './events.ts';
export { CAP } from './text.ts';
export { localTime } from './comp.ts';
export { drawingRect } from './sequence.ts';

/** a registry holding every built-in node, effect and quality check */
export function builtinRegistry(): Registry {
  return new Registry().register(...NODES).registerEffect(...EFFECTS).registerCheck(...BUILTIN_CHECKS);
}
export { MAX_SLICES, sliceFrames, sliceSize } from './timeshift.ts';
