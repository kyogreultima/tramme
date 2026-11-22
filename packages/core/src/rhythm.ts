import { analyseAudio } from './analysis.ts';
import { loudnessSeries } from './loudness.ts';

export interface RhythmFigures {
  perTen: number;
  gapMedian: number;
  gapMax: number;
  spreadDb: number;
  lowShare: number;
  floorDb: number;
  digitalSilence: number;
}
export type RhythmProfile = { [K in keyof RhythmFigures]: [number, number] };
const KEYS: (keyof RhythmFigures)[] = ['perTen', 'gapMedian', 'gapMax', 'spreadDb', 'lowShare', 'floorDb', 'digitalSilence'];
const SINGLE: RhythmFigures = { perTen: 0.3, gapMedian: 0.3, gapMax: 0.3, spreadDb: 3, lowShare: 0.1, floorDb: 6, digitalSilence: 0.5 };
const percentile = (values: number[], q: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
};

/** Measured timing, levels, bass and silence of a sound mix. */
export function rhythmOf(channels: Float32Array[], rate: number): RhythmFigures {
  const length = channels[0]?.length ?? 0;
  if (!length || rate <= 0) return { perTen: 0, gapMedian: 0, gapMax: 0, spreadDb: 0, lowShare: 0, floorDb: -120, digitalSilence: 0 };
  const mono = new Float32Array(length);
  for (const c of channels) for (let i = 0; i < length; i++) mono[i] += (c[i] ?? 0) / channels.length;
  const onsets = analyseAudio(mono, rate).onsets;
  // analyseAudio's peak picker starts at frame 1; retain a genuine attack on frame 0.
  const first = Math.min(length, Math.round(rate * 0.01)), following = Math.min(length, Math.round(rate * 0.1));
  let attack = 0, tail = 0;
  for (let i = 0; i < first; i++) attack += mono[i] * mono[i];
  for (let i = first; i < following; i++) tail += mono[i] * mono[i];
  if (attack / Math.max(1, first) > 1e-4 && attack / Math.max(1, first) > 4 * tail / Math.max(1, following - first) && (onsets[0] ?? Infinity) > 0.08) onsets.unshift(0);
  const gaps = onsets.slice(1).map((t, i) => t - onsets[i]);
  const peaks = onsets.map((t) => {
    const from = Math.max(0, Math.floor(t * rate)), to = Math.min(length, from + Math.round(rate * 0.04));
    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(mono[i]));
    return 20 * Math.log10(Math.max(peak, 1e-9));
  });
  let low = 0, energy = 0, lowEnergy = 0, silent = 0;
  const alpha = Math.exp(-2 * Math.PI * 120 / rate);
  for (const sample of mono) {
    low = (1 - alpha) * sample + alpha * low;
    energy += sample * sample; lowEnergy += low * low;
    if (Math.abs(sample) < 1e-5) silent++;
  }
  const loudness = loudnessSeries(channels, rate, 'short-term').map((x) => x.lufs).filter(Number.isFinite);
  return {
    perTen: onsets.length * 10 / (length / rate),
    gapMedian: percentile(gaps, 0.5), gapMax: Math.max(0, ...gaps),
    spreadDb: percentile(peaks, 0.75) - percentile(peaks, 0.25),
    lowShare: energy ? Math.min(1, lowEnergy / energy) : 0,
    floorDb: loudness.length ? percentile(loudness, 0.1) : -120,
    digitalSilence: silent / rate,
  };
}

export function profileOf(refs: RhythmFigures[]): RhythmProfile {
  if (!refs.length) throw new Error('a rhythm profile needs a reference');
  return Object.fromEntries(KEYS.map((key) => {
    const values = refs.map((r) => r[key]), min = Math.min(...values), max = Math.max(...values);
    const margin = refs.length === 1 ? (['perTen', 'gapMedian', 'gapMax'].includes(key) ? Math.abs(min) * SINGLE[key] : SINGLE[key]) : (max - min) * 0.15;
    return [key, [min - margin, max + margin]];
  })) as RhythmProfile;
}

export function outOfProfile(figures: RhythmFigures, profile: RhythmProfile): (keyof RhythmFigures)[] {
  return KEYS.filter((key) => figures[key] < profile[key][0] || figures[key] > profile[key][1]);
}
