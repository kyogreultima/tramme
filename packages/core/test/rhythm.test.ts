import { describe, expect, it } from 'vitest';
import { outOfProfile, profileOf, rhythmOf, type RhythmFigures } from '../src/index.ts';

const figures = (patch: Partial<RhythmFigures> = {}): RhythmFigures => ({ perTen: 6, gapMedian: 1, gapMax: 2, spreadDb: 5, lowShare: 0.2, floorDb: -35, digitalSilence: 1, ...patch });

describe('sound rhythm against references', () => {
  it('counts regular clicks over ten seconds', () => {
    const rate = 48000, samples = new Float32Array(rate * 10);
    for (let second = 0; second < 10; second += 2) for (let i = 0; i < 120; i++) samples[second * rate + i] = Math.sin(2 * Math.PI * 1500 * i / rate) * (1 - i / 120);
    expect(rhythmOf([samples], rate).perTen).toBeCloseTo(5, 0);
  });
  it('widens a two-film reference range by fifteen percent', () => {
    expect(profileOf([figures({ perTen: 4 }), figures({ perTen: 8 })]).perTen).toEqual([3.4, 8.6]);
  });
  it('flags only measures outside the reference range', () => {
    expect(outOfProfile(figures({ perTen: 12 }), profileOf([figures({ perTen: 4 }), figures({ perTen: 8 })]))).toEqual(['perTen']);
  });
});
