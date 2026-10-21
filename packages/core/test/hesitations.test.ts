import { describe, expect, it } from 'vitest';
import { energySpeech, hesitationsOf, joinAcross, keepsAround, spansOf } from '../src/index.ts';

const w = (word: string, s: number, e: number) => ({ w: word, s, e });

describe('hesitations', () => {
  it('are the speech no word covers, neither too short nor too long', () => {
    const words = [w('So', 0.5, 0.8), w('today', 0.85, 1.3), w('we', 2.0, 2.2), w('start.', 2.25, 2.8)];
    // speech heard: the words, an "uh" between 1.45 and 1.85, a breath of 0.1 s at 3.0, a passage the transcript missed from 4 to 6
    const speech = [{ from: 0.48, to: 1.85 }, { from: 1.98, to: 2.82 }, { from: 3.0, to: 3.1 }, { from: 4, to: 6 }];
    expect(hesitationsOf(words, speech)).toEqual([{ from: 1.36, to: 1.85 }]);
    // inside a part of the file only
    expect(hesitationsOf(words, speech, { from: 1.6 })).toEqual([{ from: 1.6, to: 1.85 }]);
  });

  it('are found by the energy of the sound when no model can listen', () => {
    const rate = 16000, x = new Float32Array(rate * 3);
    let s = 1;
    for (let i = 0; i < x.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const t = i / rate, loud = (t > 0.5 && t < 1.2) || (t > 1.6 && t < 1.9);
      x[i] = 0.001 * ((s / 2 ** 32) * 2 - 1) + (loud ? 0.3 * Math.sin(2 * Math.PI * 150 * t) : 0);
    }
    const spans = energySpeech(x, rate);
    expect(spans).toHaveLength(2);
    expect(spans[0].from).toBeCloseTo(0.5, 1);
    expect(spans[0].to).toBeCloseTo(1.2, 1);
    expect(spans[1].from).toBeCloseTo(1.6, 1);
  });

  it('bridges short dips and drops short bursts', () => {
    const on = [0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0].map(Boolean);
    expect(spansOf(on, 0.05, 0.06, 0.08)).toEqual([{ from: 0.05, to: 0.3 }]);
  });

  it('are cut out of a file span, a little kept on both sides, and joined again when put back', () => {
    const cuts = [{ from: 2, to: 2.5 }, { from: 5, to: 5.4 }];
    const keeps = keepsAround(1, 8, cuts);
    expect(keeps).toEqual([{ from: 1, to: 2.02 }, { from: 2.48, to: 5.02 }, { from: 5.38, to: 8 }]);
    expect(joinAcross(keeps, [cuts[1]])).toEqual([{ from: 1, to: 2.02 }, { from: 2.48, to: 8 }]);
    expect(joinAcross(keeps, cuts)).toEqual([{ from: 1, to: 8 }]);
  });
});
