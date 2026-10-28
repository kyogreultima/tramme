import { describe, expect, it } from 'vitest';
import { syncDelta, syncOffset } from '../src/index.ts';

const RATE = 8000;

/** a deterministic noise generator, so a failure can be run again */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 31 - 1; };
}

/** something like speech: noise in bursts of different loudness and length, `seconds` long */
function bursts(seconds: number, seed: number): Float32Array {
  const r = noise(seed), out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length;) {
    const len = Math.round((0.05 + 0.25 * Math.abs(r())) * RATE), gain = Math.abs(r()) > 0.3 ? 0.2 + 0.8 * Math.abs(r()) : 0.02;
    for (let k = 0; k < len && i < out.length; k++, i++) out[i] = gain * r();
  }
  return out;
}

/** the signal heard `delay` seconds later (its start filled with the room's quiet), with a little noise of its own */
function delayed(a: Float32Array, delay: number, hiss = 0.01): Float32Array {
  const r = noise(99), lag = Math.round(delay * RATE), out = new Float32Array(a.length + Math.max(0, lag));
  for (let i = 0; i < out.length; i++) out[i] = (i >= lag && i - lag < a.length ? a[i - lag] : 0) + hiss * r();
  return out;
}

describe('the offset between two recordings of the same thing', () => {
  const a = bursts(12, 7);

  it('finds a shift of 0.8 s, the same sound happening later in the second', () => {
    const r = syncOffset(a, delayed(a, 0.8), RATE, 5);
    expect(r.offset).toBeCloseTo(0.8, 2);
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it('finds it negative when the second one is the one that started late', () => {
    const r = syncOffset(delayed(a, 1.25), a, RATE, 5);
    expect(r.offset).toBeCloseTo(-1.25, 2);
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it('finds the same take recorded at another volume and with more hiss', () => {
    const quiet = delayed(a.map((x) => x * 0.25), 0.4, 0.03);
    const r = syncOffset(a, quiet, RATE, 5);
    expect(r.offset).toBeCloseTo(0.4, 2);
    expect(r.confidence).toBeGreaterThan(0.6);
  });

  it('is not sure of two unrelated sounds', () => {
    expect(syncOffset(a, bursts(12, 123), RATE, 5).confidence).toBeLessThan(0.3);
  });

  it('only looks as far as it is told to', () => {
    const r = syncOffset(a, delayed(a, 3), RATE, 1);
    expect(r.confidence).toBeLessThan(0.5);
  });

  it('says nothing of silence, or of a sound too short to compare', () => {
    expect(syncOffset(new Float32Array(RATE * 5), a, RATE, 2)).toEqual({ offset: 0, confidence: 0 });
    expect(syncOffset(new Float32Array(100), new Float32Array(100), RATE, 2)).toEqual({ offset: 0, confidence: 0 });
  });
});

describe('lining a clip up with another by their sound', () => {
  it('moves the second clip earlier by the shift found, when both start together', () => {
    expect(syncDelta({ in: 0 }, { in: 0 }, 0.8)).toBeCloseTo(-0.8);
    expect(syncDelta({ in: 0 }, { in: 0 }, -1.25)).toBeCloseTo(1.25);
  });

  it('counts where each clip is on the timeline', () => {
    // the second begins at 10 s, its sound is 0.5 s behind the first's, which begins at 2 s
    expect(syncDelta({ in: 2 }, { in: 10 }, 0.5)).toBeCloseTo(-8.5);
  });
});
