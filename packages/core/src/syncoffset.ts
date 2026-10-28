// Lining two recordings of the same thing up by their sound: the camera's
// sound and a separate recorder's, two cameras filming one scene. The sounds
// are reduced to their loudness over time (so a different microphone, a
// different volume, a different hiss still agree) and compared at every shift
// by a normalised cross-correlation, computed with an FFT.

import { fft } from './spectrum.ts';

/** the loudness is read this many times a second */
const ENV_RATE = 400;
/** two recordings must share this much (s) at a shift to be compared there */
const MIN_OVERLAP = 1;

/** the loudness over time: the mean absolute value of each block of samples, centred and scaled to a variance of one (empty for a silence) */
function envelope(x: Float32Array, rate: number): Float64Array {
  const block = Math.max(1, Math.round(rate / ENV_RATE)), n = Math.floor(x.length / block), out = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * block, e = j + block; j < e; j++) s += Math.abs(x[j]); out[i] = s / block; }
  let mean = 0;
  for (const v of out) mean += v;
  mean /= n || 1;
  let sq = 0;
  for (let i = 0; i < n; i++) { out[i] -= mean; sq += out[i] * out[i]; }
  const sd = Math.sqrt(sq / (n || 1));
  if (sd < 1e-9) return new Float64Array(0);
  for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

/** how far the second clip moves (s) so that its sound agrees with the first's: they begin at `in`, and the same sound happens `offset` s later in the second */
export const syncDelta = (a: { in: number }, b: { in: number }, offset: number): number => a.in - b.in - offset;

/**
 * How much later the same sound happens in `b` than in `a` (seconds: moving
 * `b` that much earlier lines them up, negative when `b` is the one that began
 * first), searched within ±`maxSeconds`, and how sure that is, from 0 to 1 (the
 * correlation at the best shift). Nothing (0, 0) for a silence or a sound too
 * short to compare.
 */
export function syncOffset(a: Float32Array, b: Float32Array, rate: number, maxSeconds: number): { offset: number; confidence: number } {
  const x = envelope(a, rate), y = envelope(b, rate), none = { offset: 0, confidence: 0 };
  const need = Math.round(MIN_OVERLAP * ENV_RATE);
  if (x.length < need || y.length < need) return none;
  let size = 1;
  while (size < x.length + y.length) size <<= 1;
  const ar = new Float64Array(size), ai = new Float64Array(size), br = new Float64Array(size), bi = new Float64Array(size);
  ar.set(x); br.set(y);
  fft(ar, ai); fft(br, bi);
  // conj(A) · B, brought back by a forward FFT of its conjugate: r[k] = Σ x[i] y[i + k]
  const cr = new Float64Array(size), ci = new Float64Array(size);
  for (let i = 0; i < size; i++) { cr[i] = ar[i] * br[i] + ai[i] * bi[i]; ci[i] = -(ar[i] * bi[i] - ai[i] * br[i]); }
  fft(cr, ci);
  const r = (k: number) => cr[((k % size) + size) % size] / size;
  // the energy of what two recordings share at each shift, from running sums of squares
  const px = new Float64Array(x.length + 1), py = new Float64Array(y.length + 1);
  for (let i = 0; i < x.length; i++) px[i + 1] = px[i] + x[i] * x[i];
  for (let i = 0; i < y.length; i++) py[i + 1] = py[i] + y[i] * y[i];
  const limit = Math.round(maxSeconds * ENV_RATE);
  let best = -Infinity, at = 0;
  const score = (k: number) => {
    const from = Math.max(0, -k), to = Math.min(x.length, y.length - k);
    if (to - from < need) return -Infinity;
    const ex = px[to] - px[from], ey = py[to + k] - py[from + k];
    return ex > 1e-9 && ey > 1e-9 ? r(k) / Math.sqrt(ex * ey) : -Infinity;
  };
  for (let k = -limit; k <= limit; k++) { const s = score(k); if (s > best) { best = s; at = k; } }
  if (!(best > -Infinity)) return none;
  // between two samples: the parabola through the peak and its neighbours
  const l = score(at - 1), h = score(at + 1);
  const d = l > -Infinity && h > -Infinity && l + h - 2 * best < -1e-12 ? (0.5 * (l - h)) / (l - 2 * best + h) : 0;
  return { offset: +((at + d) / ENV_RATE).toFixed(4), confidence: Math.max(0, Math.min(1, best)) };
}
