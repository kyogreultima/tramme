import type { MusicCutPlan } from './music-plan.ts';

export interface MusicChunk { text: string; duration_ms: number; positive_styles: string[]; negative_styles: string[]; context_adherence: 'high' }
export interface MusicStructure { chunks: MusicChunk[] }

/** A duration-bounded instrumental score, with sections at the picture's strongest moments. */
export function musicSections(film: MusicCutPlan, prompt: string): MusicStructure {
  const total = Math.round(film.duration * 1000);
  const landmarks = [...new Set([...film.cuts, ...film.markers, ...film.heroes].map((t) => Math.round(t * 1000)))].sort((a, b) => a - b);
  const boundaries = [0];
  for (const t of landmarks) {
    if (t - boundaries.at(-1)! >= 3000 && total - t >= 3000) boundaries.push(t);
  }
  boundaries.push(total);
  // Split each long gap evenly; a greedy 120s split would leave a forbidden 1s tail at 121s.
  for (let i = boundaries.length - 1; i > 0; i--) {
    const start = boundaries[i - 1], gap = boundaries[i] - start, count = Math.ceil(gap / 120000);
    if (count > 1) boundaries.splice(i, 0, ...Array.from({ length: count - 1 }, (_, part) => start + Math.round(gap * (part + 1) / count)));
  }
  // Keep the strongest picture landmarks within the provider's thirty-section ceiling.
  while (boundaries.length > 31) {
    let remove = -1, penalty = Infinity;
    for (let i = 1; i < boundaries.length - 1; i++) {
      const merged = boundaries[i + 1] - boundaries[i - 1];
      if (merged > 120000) continue;
      const t = boundaries[i];
      const importance = film.heroes.some((v) => Math.abs(v * 1000 - t) < 500) ? 2
        : film.markers.some((v) => Math.abs(v * 1000 - t) < 500) ? 1 : 0;
      const cost = importance * 1000000 + merged;
      if (cost < penalty) { penalty = cost; remove = i; }
    }
    if (remove < 0) throw new Error('film cannot fit the provider section limits');
    boundaries.splice(remove, 1);
  }
  const chunks = boundaries.slice(1).map((end, index): MusicChunk => {
    const start = boundaries[index], last = index === boundaries.length - 2;
    const reveal = film.heroes.some((t) => Math.abs(t * 1000 - start) < 500);
    const name = index === 0 ? 'Intro' : last ? 'End card' : reveal ? 'Reveal' : 'Build';
    const direction = name === 'Intro' ? 'A quiet, calm opening with space for the first images.'
      : name === 'Reveal' ? 'A strong musical accent at the hero reveal, then carry the pulse forward.'
        : name === 'End card' ? 'A decisive final hit, then resolve cleanly for the end card.'
          : 'Gradually rise in energy toward the next picture change.';
    return { text: `[${name}] ${direction}`, duration_ms: end - start,
      positive_styles: [prompt, ...(film.tempo ? [`${film.tempo} BPM`] : []), 'instrumental', name === 'Intro' ? 'restrained' : name === 'Reveal' ? 'accented' : name === 'End card' ? 'resolved' : 'building'],
      negative_styles: ['vocals', 'lyrics'], context_adherence: 'high' };
  });
  if (chunks.length > 30 || chunks.some((chunk) => chunk.duration_ms < 3000 || chunk.duration_ms > 120000)) throw new Error('film cannot fit the provider section limits');
  return { chunks };
}
