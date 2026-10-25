import { describe, expect, it } from 'vitest';
import { isTrimmed, pathLength, pathRuns, trimRuns } from '../src/path.ts';

describe('the trim of a stroke', () => {
  it('leaves the defaults whole and the empty window empty', () => {
    expect(trimRuns({ trimStart: 0, trimEnd: 1, trimOffset: 0 })).toBeNull();
    expect(isTrimmed({ trimStart: 0, trimEnd: 1, trimOffset: 0 })).toBe(false);
    expect(trimRuns({ trimStart: 0, trimEnd: 0, trimOffset: 0 })).toEqual([]);
    expect(isTrimmed({ trimStart: 0, trimEnd: 0, trimOffset: 0 })).toBe(true);
    // start and end clamp to the outline, as lottie-web's trim does
    expect(trimRuns({ trimStart: 0.3, trimEnd: 1.4, trimOffset: 0 })).toEqual([[0.3, 1]]);
    expect(trimRuns({ trimStart: 1.2, trimEnd: -1.4, trimOffset: 0 })).toBeNull(); // clamped and swapped: 0 to 1, the whole
  });

  it('cuts the window, shifts it, and wraps it around the end', () => {
    expect(trimRuns({ trimStart: 0, trimEnd: 0.5, trimOffset: 0 })).toEqual([[0, 0.5]]);
    expect(trimRuns({ trimStart: 0.1, trimEnd: 0.6, trimOffset: 0 })).toEqual([[0.1, 0.6]]);
    expect(trimRuns({ trimStart: 0, trimEnd: 0.5, trimOffset: 0.25 })).toEqual([[0.25, 0.75]]);
    // the end before the start swaps them, as Lottie does: the same stretch as start 0.25, end 0.75
    expect(trimRuns({ trimStart: 0.75, trimEnd: 0.25, trimOffset: 0 })).toEqual([[0.25, 0.75]]);
    // a window shifted past the end comes back at the head
    expect(trimRuns({ trimStart: 0.25, trimEnd: 0.75, trimOffset: 0.5 })).toEqual([[0.75, 1], [0, 0.25]]);
    expect(trimRuns({ trimStart: 0.25, trimEnd: 0.75, trimOffset: 0.5 })).toEqual(trimRuns({ trimStart: 0.25, trimEnd: 0.75, trimOffset: 1.5 }));
  });

  it('measures a path along its length', () => {
    expect(pathLength({ v: [[0, 0], [30, 0], [30, 40]], closed: false })).toBeCloseTo(70);
    expect(pathLength({ v: [[0, 0], [100, 0], [100, 100], [0, 100]], closed: true })).toBeCloseTo(400);
    // a cubic bowing far from its chord is longer than the chord
    const bowed = pathLength({ v: [[0, 0], [100, 0]], o: [[0, 50]], closed: false });
    expect(bowed).toBeGreaterThan(100);
    const { total } = pathRuns({ v: [[0, 0], [100, 0]], closed: false });
    expect(total).toBeCloseTo(100);
  });

  it('caches each fineness apart', () => {
    const curve = { v: [[0, 0], [100, 0]] as [number, number][], o: [[0, 80]] as [number, number][], closed: false };
    const coarse = pathRuns(curve, 2), fine = pathRuns(curve, 24);
    expect(coarse.pts).toHaveLength(3);
    expect(fine.pts).toHaveLength(25);
    expect(pathRuns(curve, 2)).toBe(coarse);
  });
});
