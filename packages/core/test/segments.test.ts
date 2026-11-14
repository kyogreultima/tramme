import { describe, expect, it } from 'vitest';
import { segmentsOf, weightAt } from '../src/segments.ts';

describe('a long run cut in overlapping segments', () => {
  it('covers the sound with overlapping segments, the last ending at the end', () => {
    expect(segmentsOf(100, 40)).toEqual([{ from: 0, length: 40 }, { from: 30, length: 40 }, { from: 60, length: 40 }]);
    expect(segmentsOf(105, 40)).toEqual([{ from: 0, length: 40 }, { from: 30, length: 40 }, { from: 60, length: 40 }, { from: 65, length: 40 }]);
    expect(segmentsOf(25, 40)).toEqual([{ from: 0, length: 25 }]);
  });

  it('fades a segment in and out over its overlap, never the ends of the run', () => {
    expect(weightAt(0, 40, 10, true, false)).toBe(1);
    expect(weightAt(0, 40, 10, false, false)).toBeCloseTo(0.05);
    expect(weightAt(39, 40, 10, false, true)).toBe(1);
    expect(weightAt(20, 40, 10, false, false)).toBe(1);
  });

});
