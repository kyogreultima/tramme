/** Read a film's musical landmarks before requesting a paid score. */
export type MusicLandmark = { t: number; kind: 'cut' | 'marker' | 'hero' };
export interface MusicCutPlan { duration: number; fps: number; cuts: number[]; markers: number[]; heroes: number[]; tempo: number | null; aligned: number }

export function musicCutPlan(duration: number, fps: number, landmarks: readonly MusicLandmark[]): MusicCutPlan {
  if (!Number.isFinite(duration) || duration < 3 || duration > 600 || !Number.isFinite(fps) || fps <= 0) throw new Error('music duration must be 3–600 seconds and frame rate positive');
  const groups = { cut: new Set<number>(), marker: new Set<number>(), hero: new Set<number>() };
  for (const { t, kind } of landmarks) {
    if (!Number.isFinite(t) || t < 0 || t >= duration || !(kind in groups)) throw new Error('invalid music landmark');
    groups[kind].add(Math.round(t * fps) / fps);
  }
  const cuts = [...groups.cut].filter((t) => t > 0).sort((a, b) => a - b);
  const markers = [...groups.marker].sort((a, b) => a - b);
  const heroes = [...groups.hero].sort((a, b) => a - b);
  if (!cuts.length) return { duration, fps, cuts, markers, heroes, tempo: null, aligned: 0 };
  let chosen = 120, best = -Infinity, aligned = 0;
  for (let bpm = 60; bpm <= 180; bpm++) {
    const beat = 60 / bpm;
    const distances = cuts.map((t) => Math.abs(t - Math.round(t / beat) * beat));
    const hits = distances.filter((d) => d <= 1 / fps + 1e-9).length;
    const score = hits * 1000 - distances.reduce((sum, d) => sum + Math.min(d, beat / 2), 0) - Math.abs(bpm - 120) / 1000;
    if (score > best) { chosen = bpm; best = score; aligned = hits; }
  }
  return { duration, fps, cuts, markers, heroes, tempo: chosen, aligned };
}
