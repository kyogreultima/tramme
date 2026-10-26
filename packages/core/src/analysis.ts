// What a sound is made of, over time: its loudness in three bands, the
// onsets (hits), the tempo, the beats and the bars, and its sections. The
// analysis runs once at authoring time (the editor decodes the audio and
// calls analyseAudio) and is saved as a JSON asset; the render reads it with
// pure functions of t (audioReader), so a picture can follow the music while
// every frame stays a function of time.

import { lastIndex } from './math.ts';

export interface AudioAnalysis {
  version: 1;
  kind: 'audio-analysis';
  /** asset id of the sound or video analysed */
  source?: string;
  duration: number;
  /** samples per second of the envelopes */
  rate: number;
  /** loudness 0..1 (normalised on the file) of the whole, the lows (< 150 Hz), the mids, the highs (> 2 kHz) */
  envelope: { rms: number[]; low: number[]; mid: number[]; high: number[] };
  /** hits: drums, plosives, notes (s) */
  onsets: number[];
  /** beats per minute, null when the sound has no steady pulse */
  tempo: number | null;
  beats: number[];
  /** the first beat of each bar (4 beats) */
  downbeats: number[];
  /** where the energy changes for good (verse, chorus, drop), with the loudness that follows */
  sections: { t: number; level: number }[];
  /** the energy of 32 log bands (40 Hz to 16 kHz), sampled at `bandsRate` (every fourth frame of the 50 Hz rate), each band normalised on its own loudest frame — the audiogram's wave reads them; absent from analyses made before 0.14 */
  bands?: number[][];
  /** how many band frames a second (12.5) */
  bandsRate?: number;
}

export const isAudioAnalysis = (x: unknown): x is AudioAnalysis =>
  !!x && typeof x === 'object' && (x as AudioAnalysis).kind === 'audio-analysis' && Array.isArray((x as AudioAnalysis).beats);

export type Band = 'rms' | 'low' | 'mid' | 'high';

// ── analysis ─────────────────────────────────────────────────
const RATE = 50;

/** one-pole low-pass, in place copy */
function lowpass(x: Float32Array, rate: number, cutoff: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * cutoff) / rate), y = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) { s = (1 - a) * x[i] + a * s; y[i] = s; }
  return y;
}

/** root mean square over hops of 1/RATE s */
function rmsOf(x: Float32Array, hop: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0, n = 0;
    for (let i = f * hop, end = Math.min(x.length, (f + 1) * hop); i < end; i++, n++) s += x[i] * x[i];
    out[f] = n ? Math.sqrt(s / n) : 0;
  }
  return out;
}

const normalise = (x: Float32Array) => { let m = 0; for (const v of x) m = Math.max(m, v); return Array.from(x, (v) => (m > 0 ? +(v / m).toFixed(3) : 0)); };
const mean = (a: ArrayLike<number>, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i]; return to > from ? s / (to - from) : 0; };

/** times of the peaks of a novelty curve above a moving threshold, at least `gap` s apart */
function peaks(nov: Float32Array, gap: number): number[] {
  const out: number[] = [], w = RATE, minGap = Math.round(gap * RATE);
  let last = -Infinity;
  for (let i = 1; i < nov.length - 1; i++) {
    if (nov[i] <= nov[i - 1] || nov[i] < nov[i + 1]) continue;
    const from = Math.max(0, i - w), to = Math.min(nov.length, i + w);
    const m = mean(nov, from, to);
    let v = 0;
    for (let k = from; k < to; k++) v += (nov[k] - m) ** 2;
    const sd = Math.sqrt(v / (to - from));
    if (nov[i] > m + 1.2 * sd && nov[i] > 0.02 && i - last >= minGap) { out.push(i / RATE); last = i; }
  }
  return out;
}

// ── the spectrum: 32 log bands ───────────────────────────────
/** an iterative radix-2 FFT of a real window, as magnitudes (n a power of two) */
function magnitudes(window: Float32Array): Float32Array {
  const n = window.length, re = Float64Array.from(window), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  const out = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) out[k] = Math.hypot(re[k], im[k]);
  return out;
}

/** the bands are kept for every fourth frame of the analysis' rate: 12.5 a second at 50 Hz */
const BANDS_EVERY = 4;

/**
 * A spectrum's energy in `count` bands on a log scale from 40 Hz to 16 kHz:
 * the mean magnitude of the bins each band spans (at least one), raw (the
 * analysis normalises them over the whole sound, so a quiet frame stays quiet).
 */
export function logBands(spectrum: Float32Array, sampleRate: number, count = 32): number[] {
  const binHz = sampleRate / 2 / spectrum.length;
  const lo = 40, hi = Math.min(16000, sampleRate / 2 - 1);
  const out = new Array<number>(count).fill(0);
  for (let b = 0; b < count; b++) {
    const f0 = lo * Math.pow(hi / lo, b / count), f1 = lo * Math.pow(hi / lo, (b + 1) / count);
    const i0 = Math.max(1, Math.floor(f0 / binHz)), i1 = Math.max(i0 + 1, Math.min(spectrum.length, Math.ceil(f1 / binHz)));
    let s = 0;
    for (let i = i0; i < i1; i++) s += spectrum[i];
    out[b] = s / (i1 - i0);
  }
  return out;
}

/**
 * The analysis of a mono sound. The tempo comes from the autocorrelation of
 * the onset curve (60 to 190 bpm, leaning to 120), the beat grid from the
 * phase that hits the most onsets, the bars from the beat where the lows hit
 * hardest.
 */
export function analyseAudio(samples: Float32Array, sampleRate: number): AudioAnalysis {
  const hop = Math.max(1, Math.round(sampleRate / RATE)), frames = Math.max(1, Math.ceil(samples.length / hop));
  const lo = lowpass(samples, sampleRate, 150), lo2k = lowpass(samples, sampleRate, 2000);
  const hi = new Float32Array(samples.length), mid = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) { hi[i] = samples[i] - lo2k[i]; mid[i] = lo2k[i] - lo[i]; }
  const bands = { rms: rmsOf(samples, hop, frames), low: rmsOf(lo, hop, frames), mid: rmsOf(mid, hop, frames), high: rmsOf(hi, hop, frames) };

  // novelty: rise of the log energy in each band, the lows and highs weighted most (drums)
  const nov = new Float32Array(frames);
  const logd = (b: Float32Array, i: number) => Math.max(0, Math.log(b[i] + 1e-4) - Math.log(b[i - 1] + 1e-4));
  for (let i = 1; i < frames; i++) nov[i] = 1.2 * logd(bands.low, i) + 0.6 * logd(bands.mid, i) + 1 * logd(bands.high, i);
  const onsets = peaks(nov, 0.08);

  // tempo: autocorrelation of the novelty between 60 and 190 bpm, weighted around 120
  let tempo: number | null = null, period = 0;
  if (onsets.length >= 8 && frames > RATE * 4) {
    let best = 0, bestLag = 0;
    const minLag = Math.floor((60 / 190) * RATE), maxLag = Math.ceil((60 / 60) * RATE);
    const ac = new Float32Array(maxLag + 2);
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      let s = 0;
      for (let i = lag; i < frames; i++) s += nov[i] * nov[i - lag];
      ac[lag] = s / (frames - lag);
    }
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = (60 * RATE) / lag, w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
      // the double of the period backs a true beat
      const score = (ac[lag] + 0.5 * (ac[lag * 2] ?? 0)) * w;
      if (score > best) { best = score; bestLag = lag; }
    }
    // a pulse stands out of the average correlation
    if (bestLag && ac[bestLag] > 1.4 * mean(ac, minLag, maxLag + 1)) {
      // parabolic refinement of the lag
      const y0 = ac[bestLag - 1], y1 = ac[bestLag], y2 = ac[bestLag + 1], d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
      period = (bestLag + (Math.abs(d) < 1 ? d : 0)) / RATE;
      tempo = +(60 / period).toFixed(1);
    }
  }

  // beat grid: the phase that hits the most novelty, each beat pulled to a close onset
  const beats: number[] = [];
  if (tempo) {
    const steps = 40;
    let bestPhase = 0, bestScore = -1;
    for (let k = 0; k < steps; k++) {
      const ph = (period * k) / steps;
      let s = 0;
      for (let t = ph; t < samples.length / sampleRate; t += period) s += nov[Math.min(frames - 1, Math.round(t * RATE))];
      if (s > bestScore) { bestScore = s; bestPhase = ph; }
    }
    const dur = samples.length / sampleRate;
    for (let t = bestPhase; t < dur; t += period) {
      const near = onsets.find((o) => Math.abs(o - t) <= 0.06);
      beats.push(+(near ?? t).toFixed(3));
    }
  }

  // bars: the beat of four where the lows hit hardest
  let downbeats: number[] = [];
  if (beats.length >= 8) {
    let bestOff = 0, bestLow = -1;
    for (let off = 0; off < 4; off++) {
      let s = 0;
      for (let i = off; i < beats.length; i += 4) s += bands.low[Math.min(frames - 1, Math.round(beats[i] * RATE))];
      if (s > bestLow) { bestLow = s; bestOff = off; }
    }
    downbeats = beats.filter((_, i) => i % 4 === bestOff);
  }

  // sections: the loudness of each bar (or window of 2 s), relative to the loudest one, changing for good
  const rmsN = normalise(bands.rms), sections: { t: number; level: number }[] = [];
  const marks = downbeats.length >= 4 ? downbeats : Array.from({ length: Math.floor(frames / (RATE * 2)) }, (_, i) => i * 2);
  const raw = marks.map((m, i) => mean(rmsN, Math.round(m * RATE), Math.max(Math.round(m * RATE) + 1, Math.min(frames, Math.round((marks[i + 1] ?? m + 2) * RATE)))));
  const top = Math.max(...raw, 1e-9), level = raw.map((v) => v / top);
  // two bars before against two after
  const span = 2;
  for (let i = span; i + span <= marks.length; i++) {
    const before = mean(level, i - span, i), after = mean(level, i, i + span);
    if (Math.abs(after - before) > 0.25 && (!sections.length || marks[i] - sections.at(-1)!.t >= 4)) sections.push({ t: +marks[i].toFixed(3), level: +after.toFixed(2) });
  }

  // the 32 log bands: an FFT of 2048 samples on every fourth frame of the 50 Hz rate (12.5 Hz, only
  // the frames that are kept are computed), so a 30-minute analysis stays under 6 MB — the wave
  // reads them interpolated (the audiogram's barsAt)
  const N = 2048;
  const spec: number[][] = Array.from({ length: 32 }, () => []);
  const window = new Float32Array(N);
  for (let f = 0; f < frames; f += BANDS_EVERY) {
    const at = Math.min(samples.length - N, f * hop);
    if (at < 0) { for (let b = 0; b < 32; b++) spec[b].push(0); continue; }
    for (let i = 0; i < N; i++) { const v = samples[at + i]; window[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); }
    const frame = logBands(magnitudes(window), sampleRate);
    for (let b = 0; b < 32; b++) spec[b].push(frame[b]);
  }
  // each band on its own loudest frame (a quiet frame reads low, a silence reads 0), softened by
  // the band's share of the loudest one so a band holding only noise stays low
  const tops = spec.map((band) => band.reduce((m, v) => (v > m ? v : m), 0)), loudest = Math.max(1e-9, ...tops);
  const bandList = spec.map((band, b) => {
    const k = tops[b] > 1e-9 ? Math.sqrt(tops[b] / loudest) / tops[b] : 0;
    return band.map((v) => +(v * k).toFixed(2));
  });

  return {
    version: 1, kind: 'audio-analysis', duration: +(samples.length / sampleRate).toFixed(3), rate: RATE,
    envelope: { rms: rmsN, low: normalise(bands.low), mid: normalise(bands.mid), high: normalise(bands.high) },
    onsets: onsets.map((t) => +t.toFixed(3)), tempo, beats, downbeats, sections, bands: bandList, bandsRate: RATE / BANDS_EVERY,
  };
}

// ── reading at render time ───────────────────────────────────
export interface AudioReader {
  /** loudness 0..1 at t, interpolated */
  energy(band?: Band): number;
  /** 1 on each beat, fading to 0 with `decay` (s) */
  pulse(decay?: number): number;
  /** the same on each bar */
  barPulse(decay?: number): number;
  /** the same on each hit */
  hit(decay?: number): number;
  /** rank of the current beat (0 for the first, -1 before it) */
  beat: number;
  /** rank of the current bar */
  bar: number;
  /** progress inside the beat, 0..1 */
  phase: number;
  /** rank of the current section (0 before the first change) */
  section: number;
}

const silent: AudioReader = { energy: () => 0, pulse: () => 0, barPulse: () => 0, hit: () => 0, beat: -1, bar: -1, phase: 0, section: 0 };

/** what an analysis says at time t (time of the sound); neutral values when there is none */
export function audioReader(a: unknown, t: number): AudioReader {
  if (!isAudioAnalysis(a)) return silent;
  const fade = (list: number[], decay: number) => { const i = lastIndex(list, t); return i < 0 ? 0 : Math.exp(-(t - list[i]) / Math.max(1e-3, decay)); };
  const b = lastIndex(a.beats, t);
  const period = a.tempo ? 60 / a.tempo : 0;
  return {
    energy(band: Band = 'rms') {
      const env = a.envelope[band] ?? a.envelope.rms, x = t * a.rate, i = Math.floor(x);
      if (i < 0 || !env.length) return 0;
      if (i >= env.length - 1) return env[env.length - 1];
      return env[i] + (env[i + 1] - env[i]) * (x - i);
    },
    pulse: (decay = 0.2) => fade(a.beats, decay),
    barPulse: (decay = 0.4) => fade(a.downbeats, decay),
    hit: (decay = 0.15) => fade(a.onsets, decay),
    beat: b,
    bar: lastIndex(a.downbeats, t),
    phase: b < 0 || !period ? 0 : Math.min(1, (t - a.beats[b]) / ((a.beats[b + 1] ?? a.beats[b] + period) - a.beats[b])),
    section: lastIndex(a.sections.map((s) => s.t), t) + 1,
  };
}
