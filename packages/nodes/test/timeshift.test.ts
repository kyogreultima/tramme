// The cut per pixel (docs/components-roadmap.md, step 6): which moments of
// its source the time displacement keeps, and at what size.

import { describe, expect, it } from 'vitest';
import { builtinRegistry, MAX_SLICES, sliceFrames, sliceSize } from '../src/index.ts';

describe('the time displacement', () => {
  it('keeps slices on the source\'s frames, from now back to the delay, never before 0', () => {
    expect(sliceFrames(2, 24, 1, 5)).toEqual([48, 42, 36, 30, 24]);
    expect(sliceFrames(0.25, 24, 1, 3)).toEqual([6, 0, 0]);
    expect(sliceFrames(2, 24, 1, 500)).toHaveLength(MAX_SLICES);
    // one frame later, every slice but the newest is one the frame before had: the ring draws one
    const a = new Set(sliceFrames(2, 24, 1, 25)), b = sliceFrames(2 + 1 / 24, 24, 1, 25);
    expect(b.filter((f) => !a.has(f))).toEqual([49]);
  });

  it('keeps its slices within the memory budget, at most the layer\'s size', () => {
    expect(sliceSize(640, 360, 24)).toEqual([640, 360]);
    const [w, h] = sliceSize(3840, 2160, 48);
    expect(w * h * 4 * 48).toBeLessThanOrEqual(192 * 1024 * 1024);
    expect(w / h).toBeCloseTo(16 / 9, 2);
  });

  it('is in the vocabulary, with notes for the assistant', () => {
    const n = builtinRegistry().node('time.shift');
    expect(n.ai?.when).toMatch(/slit-scan/);
    expect(n.bounds?.({ comp: 'shot' } as never, { compositionSize: () => ({ width: 640, height: 360, duration: 2 }) } as never)).toEqual({ x: -320, y: -180, w: 640, h: 360 });
  });
});
