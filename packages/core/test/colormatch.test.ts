import { describe, expect, it } from 'vitest';
import { lookStatsOf, matchGrade, wheelsApply, type LookStats } from '../src/index.ts';

const WHEELS_OFF = { lift: [0, 0], liftLevel: 0, gamma: [0, 0], gammaLevel: 0, gain: [0, 0], gainLevel: 0 };

describe('the look of a shot, read from its picture', () => {
  it('is the mean and the spread of each colour, transparent pixels left out', () => {
    // two opaque pixels, (0, 0.5, 1) and (1, 0.5, 0), and a transparent one that counts for nothing
    const px = new Uint8ClampedArray([0, 128, 255, 255, 255, 128, 0, 255, 90, 90, 90, 0]);
    const s = lookStatsOf(px);
    expect(s.mean[0]).toBeCloseTo(0.5, 2);
    expect(s.mean[1]).toBeCloseTo(0.502, 2);
    expect(s.std[0]).toBeCloseTo(0.5, 2);
    expect(s.std[1]).toBeCloseTo(0, 2);
  });
});

describe('matching the look of one shot to another', () => {
  const same: LookStats = { mean: [0.4, 0.45, 0.5], std: [0.2, 0.22, 0.18] };

  it('is nothing when the two looks are the same', () => {
    expect(matchGrade(same, same)).toEqual(WHEELS_OFF);
  });

  it('moves the mean of the shot onto the mean of the other, and spreads it like it', () => {
    const src: LookStats = { mean: [0.4, 0.45, 0.5], std: [0.2, 0.22, 0.18] }, ref: LookStats = { mean: [0.46, 0.44, 0.41], std: [0.22, 0.22, 0.22] };
    const p = matchGrade(ref, src);
    for (let ch = 0; ch < 3; ch++) {
      const at = (x: number) => { const c: [number, number, number] = [0.4, 0.45, 0.5].map((_, i) => (i === ch ? x : src.mean[i])) as [number, number, number]; return wheelsApply(c, p)[ch]; };
      expect(at(src.mean[ch])).toBeCloseTo(ref.mean[ch], 2);
      expect(at(src.mean[ch] + src.std[ch]) - at(src.mean[ch] - src.std[ch])).toBeCloseTo(2 * ref.std[ch], 1);
    }
  });

  it('keeps the wheels inside their ranges, for a look too far away to reach', () => {
    const p = matchGrade({ mean: [0.9, 0.1, 0.1], std: [0.01, 0.4, 0.4] }, { mean: [0.1, 0.9, 0.9], std: [0.4, 0.01, 0.01] });
    for (const w of [p.lift, p.gamma, p.gain]) expect(Math.hypot(w[0], w[1])).toBeLessThanOrEqual(1 + 1e-9);
    expect(Math.abs(p.liftLevel)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(p.gainLevel)).toBeLessThanOrEqual(1);
  });

  it('does not divide by the spread of a flat picture', () => {
    const p = matchGrade(same, { mean: [0.4, 0.45, 0.5], std: [0, 0, 0] });
    expect(Object.values(p).flat().every(Number.isFinite)).toBe(true);
  });
});

describe('the colour wheels, as the effect applies them', () => {
  it('leave a colour alone when they are off', () => {
    expect(wheelsApply([0.2, 0.5, 0.8], WHEELS_OFF as never).map((v) => +v.toFixed(6))).toEqual([0.2, 0.5, 0.8]);
  });

  it('raise the highlights with the gain level', () => {
    expect(wheelsApply([0.5, 0.5, 0.5], { ...WHEELS_OFF, gainLevel: 0.2 } as never)[0]).toBeCloseTo(0.6, 5);
  });
});
