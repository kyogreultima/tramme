import { describe, expect, it } from 'vitest';
import { createPitchShifter, PITCH_WORKLET } from '../src/pitch.ts';

const RATE = 48000;

/** the main frequency of a signal, by its zero crossings */
function pitchOf(x: Float32Array, from: number): number {
  let crossings = 0;
  for (let i = from + 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++;
  return crossings / ((x.length - from) / RATE);
}

function shifted(freq: number, ratio: number, seconds = 1) {
  const n = RATE * seconds, input = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * freq * i) / RATE));
  const output = new Float32Array(n), shifter = createPitchShifter(RATE);
  // in blocks of 128, as an AudioWorklet runs
  for (let i = 0; i < n; i += 128) shifter.process(input.subarray(i, i + 128), output.subarray(i, i + 128), ratio);
  return output;
}

describe('the pitch shift', () => {
  it('raises a tone by its ratio and keeps its length', () => {
    const out = shifted(220, 1.5);
    expect(out.length).toBe(RATE);
    expect(pitchOf(out, RATE / 4)).toBeGreaterThan(310);
    expect(pitchOf(out, RATE / 4)).toBeLessThan(350);
  });

  it('lowers it an octave', () => {
    expect(pitchOf(shifted(440, 0.5), RATE / 4)).toBeCloseTo(220, -1);
  });

  it('leaves it as it is at 1', () => {
    expect(pitchOf(shifted(330, 1), 0)).toBeCloseTo(330, -1);
  });

  it('is the worklet’s own code', () => {
    expect(PITCH_WORKLET).toContain('registerProcessor');
    expect(() => new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', PITCH_WORKLET)(class {}, () => {}, RATE)).not.toThrow();
  });
});
