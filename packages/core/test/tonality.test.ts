import { describe, expect, it } from 'vitest';
import { keyOf, pitchOf, scaleOf } from '../src/index.ts';

const rate = 48000;
const note = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const chords = (notes: number[][]) => Float32Array.from({ length: notes.length * rate }, (_, i) => {
  const chord = notes[Math.floor(i / rate)], t = (i % rate) / rate;
  return chord.reduce((sum, midi) => sum + Math.sin(2 * Math.PI * note(midi) * t), 0) * 0.12;
});
const noise = (seconds: number) => {
  let state = 7;
  return Float32Array.from({ length: seconds * rate }, () => { state = (1664525 * state + 1013904223) >>> 0; return (state / 2 ** 32 - 0.5) * 0.5; });
};

describe('tonality of recorded sound', () => {
  it('finds C major from a C F G C progression', () => {
    expect(keyOf(chords([[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]]), rate)).toMatchObject({ tonic: 0, mode: 'major' });
  });
  it('finds A minor from an Am Dm E Am progression', () => {
    expect(keyOf(chords([[57, 60, 64], [62, 65, 69], [64, 68, 71], [57, 60, 64]]), rate)).toMatchObject({ tonic: 9, mode: 'minor' });
  });
  it('has no key or pitch for noise', () => {
    expect(keyOf(noise(2), rate)).toBeNull();
    expect(pitchOf(noise(0.5), rate)).toBeNull();
  });
  it('hears A4 in a plucked tone', () => {
    const pluck = Float32Array.from({ length: rate }, (_, i) => Math.sin(2 * Math.PI * 440 * i / rate) * Math.exp(-i / rate * 3));
    expect(pitchOf(pluck, rate)?.midi).toBeCloseTo(69, 0);
  });
  it('lists D major pitch classes', () => {
    expect(scaleOf({ tonic: 2, mode: 'major', confidence: 1 })).toEqual([2, 4, 6, 7, 9, 11, 1]);
  });
});
