import { fft } from './spectrum.ts';

export interface MusicKey { tonic: number; mode: 'major' | 'minor'; confidence: number }
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const SIZE = 8192, HOP = 4096;

const correlation = (a: number[], b: number[]): number => {
  const am = a.reduce((s, x) => s + x, 0) / a.length, bm = b.reduce((s, x) => s + x, 0) / b.length;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - am, y = b[i] - bm; dot += x * y; aa += x * x; bb += y * y; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
};

/** Estimate the key of music from chroma, leaving ambiguous or noisy audio unlabelled. */
export function keyOf(samples: Float32Array, rate: number): MusicKey | null {
  if (samples.length < SIZE || rate <= 0) return null;
  const chroma = Array(12).fill(0) as number[], re = new Float64Array(SIZE), im = new Float64Array(SIZE);
  let frames = 0;
  for (let start = 0; start + SIZE <= samples.length; start += HOP) {
    for (let i = 0; i < SIZE; i++) { re[i] = samples[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / SIZE)); im[i] = 0; }
    fft(re, im);
    const magnitudes = new Float64Array(SIZE / 2);
    for (let bin = 1; bin < magnitudes.length; bin++) magnitudes[bin] = Math.hypot(re[bin], im[bin]);
    for (let bin = 2; bin < magnitudes.length - 1; bin++) {
      const hz = bin * rate / SIZE;
      if (hz < 55 || hz > 2000 || magnitudes[bin] < magnitudes[bin - 1] || magnitudes[bin] < magnitudes[bin + 1]) continue;
      const midi = 69 + 12 * Math.log2(hz / 440), pitch = ((Math.round(midi) % 12) + 12) % 12;
      if (Math.abs(midi - Math.round(midi)) > 0.35) continue;
      chroma[pitch] += magnitudes[bin] / Math.sqrt(hz);
    }
    frames++;
  }
  const total = chroma.reduce((a, b) => a + b, 0);
  if (!frames || total < 1e-5 || Math.max(...chroma) / total < 0.14) return null;
  const scores: { tonic: number; mode: MusicKey['mode']; score: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) for (const [mode, profile] of [['major', MAJOR], ['minor', MINOR]] as const) {
    scores.push({ tonic, mode, score: correlation(chroma, profile.map((_, i) => profile[(i - tonic + 12) % 12])) });
  }
  scores.sort((a, b) => b.score - a.score);
  const confidence = scores[0].score - scores[1].score;
  return confidence >= 0.05 ? { tonic: scores[0].tonic, mode: scores[0].mode, confidence } : null;
}

/** YIN pitch estimate in a short window following the sound's peak. */
export function pitchOf(samples: Float32Array, rate: number): { midi: number; confidence: number } | null {
  if (!samples.length || rate <= 0) return null;
  let peak = 0;
  for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i]) > Math.abs(samples[peak])) peak = i;
  const end = Math.min(samples.length, peak + Math.round(rate * 0.2)), length = end - peak;
  const minLag = Math.max(2, Math.floor(rate / 2093)), maxLag = Math.min(Math.floor(rate / 65), Math.floor(length / 2));
  if (maxLag <= minLag) return null;
  const differences = new Float64Array(maxLag + 1), cumulative = new Float64Array(maxLag + 1);
  let running = 0, bestLag = 0, best = Infinity;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < length - maxLag; i++) { const delta = samples[peak + i] - samples[peak + i + lag]; sum += delta * delta; }
    differences[lag] = sum;
    running += sum;
    cumulative[lag] = running ? sum * lag / running : 1;
    if (lag >= minLag && cumulative[lag] < best) { best = cumulative[lag]; bestLag = lag; }
  }
  if (!bestLag || 1 - best < 0.8) return null;
  const midi = 69 + 12 * Math.log2(rate / bestLag / 440);
  return midi >= 36 && midi <= 96 ? { midi, confidence: 1 - best } : null;
}

export function scaleOf(key: MusicKey): number[] {
  const intervals = key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  return intervals.map((step) => (key.tonic + step) % 12);
}
