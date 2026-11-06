import type { MusicCutPlan } from './music-plan.ts';

export interface MusicAlignment { before: number; after: number; total: number; rate: number; keepPitch: boolean }

/** Score actual decoded beats against film cuts, then try only a small, pitch-preserving speed change. */
export function alignMusicBeats(film: MusicCutPlan, heardBeats: readonly number[], at = 0): MusicAlignment {
  const beats = [...new Set(heardBeats.filter((t) => Number.isFinite(t) && t >= 0))].sort((a, b) => a - b);
  const cuts = film.cuts.map((t) => t - at).filter((t) => t >= 0 && t < film.duration);
  const nearest = (target: number) => {
    let lo = 0, hi = beats.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (beats[mid] < target) lo = mid + 1; else hi = mid; }
    return Math.min(Math.abs((beats[lo] ?? Infinity) - target), Math.abs((beats[lo - 1] ?? -Infinity) - target));
  };
  const hits = (rate: number) => cuts.filter((cut) => nearest(cut * rate) <= rate / film.fps + 1e-9).length;
  const before = beats.length ? hits(1) : 0;
  let best = 1, after = before;
  if (beats.length && cuts.length && before < cuts.length) {
    const candidates = new Set<number>([1]);
    for (const cut of cuts) {
      if (cut <= 0) continue;
      for (const beat of beats) {
        if (beat < cut * 0.98 - 1 / film.fps || beat > cut * 1.02 + 1 / film.fps) continue;
        candidates.add(Math.max(0.98, Math.min(1.02, +((beat / cut).toFixed(4)))));
      }
    }
    for (const rate of candidates) {
      const n = hits(rate);
      if (n > after || (n === after && n > before && Math.abs(rate - 1) < Math.abs(best - 1))) { best = rate; after = n; }
    }
  }
  return { before, after, total: cuts.length, rate: best, keepPitch: best !== 1 };
}
