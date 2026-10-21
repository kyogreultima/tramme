import { describe, expect, it } from 'vitest';
import { SPEED_PRESETS, speedKeys } from '../src/speed.ts';

describe('the speed presets', () => {
  it('put their shape around the moment', () => {
    expect(speedKeys('rampIn', 3, 0, 10).map((k) => [k.t, k.v])).toEqual([[2.2, 1], [3, 0.3]]);
    expect(speedKeys('hero', 5, 0, 10).map((k) => [k.t, k.v])).toEqual([[4, 2], [4.75, 0.25], [5.25, 0.25], [6, 2]]);
  });

  it('ease every key but the last', () => {
    const keys = speedKeys('bullet', 5, 0, 10);
    expect(keys.slice(0, -1).every((k) => Array.isArray(k.ease))).toBe(true);
    expect(keys.at(-1)!.ease).toBeUndefined();
  });

  it('stay inside the layer: moved near its ends, squeezed when it is too short', () => {
    for (const p of SPEED_PRESETS) {
      for (const [at, from, to] of [[0.1, 0, 10], [9.9, 0, 10], [2, 1.5, 2.5]]) {
        const keys = speedKeys(p, at, from, to);
        expect(keys[0].t, `${p} at ${at}`).toBeGreaterThanOrEqual(from);
        expect(keys.at(-1)!.t, `${p} at ${at}`).toBeLessThan(to);
        expect(keys.every((k, i) => i === 0 || k.t > keys[i - 1].t)).toBe(true);
      }
    }
  });
});
