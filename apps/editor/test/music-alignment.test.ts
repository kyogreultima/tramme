import { expect, it } from 'vitest';
import { musicCutPlan } from '../src/music-plan.ts';
import { alignMusicBeats } from '../src/music-alignment.ts';

it('measures six cuts and fixes a small tempo drift without changing pitch', () => {
  const film = musicCutPlan(18, 30, [2, 4, 6, 8, 10, 12].map((t) => ({ t, kind: 'cut' as const })));
  const beats = Array.from({ length: 35 }, (_, i) => i * 0.5 * 1.01);
  const result = alignMusicBeats(film, beats);
  expect(result.before).toBeLessThan(5);
  expect(result.after).toBe(6);
  expect(result.rate).toBeCloseTo(1.01, 3);
  expect(result.keepPitch).toBe(true);
});

it('leaves a well-aligned score untouched', () => {
  const film = musicCutPlan(18, 30, [2, 4, 6, 8, 10, 12].map((t) => ({ t, kind: 'cut' as const })));
  const result = alignMusicBeats(film, Array.from({ length: 36 }, (_, i) => i * 0.5));
  expect(result).toMatchObject({ before: 6, after: 6, rate: 1, keepPitch: false });
});

it('reports a missing pulse honestly and never stretches beyond two percent', () => {
  const film = musicCutPlan(18, 30, [2, 4, 6, 8, 10, 12].map((t) => ({ t, kind: 'cut' as const })));
  expect(alignMusicBeats(film, [])).toMatchObject({ before: 0, after: 0, rate: 1 });
  const far = alignMusicBeats(film, Array.from({ length: 30 }, (_, i) => i * 0.5 * 1.08));
  expect(far.rate).toBeGreaterThanOrEqual(0.98);
  expect(far.rate).toBeLessThanOrEqual(1.02);
  expect(far.after).toBeGreaterThanOrEqual(far.before);
});

it('measures beats at the placed music layer time rather than film zero', () => {
  const film = musicCutPlan(20, 30, [5, 7, 9, 11, 13, 15].map((t) => ({ t, kind: 'cut' as const })));
  const beats = Array.from({ length: 38 }, (_, i) => 0.4 + i * 0.5);
  expect(alignMusicBeats(film, beats, 3.1)).toMatchObject({ before: 6, after: 6, rate: 1 });
});
