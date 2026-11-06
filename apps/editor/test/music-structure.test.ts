// Copy into apps/editor/test/music-structure.test.ts after iteration-7 commit.
import { expect, it } from 'vitest';
import { musicCutPlan } from '../src/music-plan.ts';
import { musicSections } from '../src/music-structure.ts';

it('turns six picture cuts into valid, exact-duration instrumental sections', () => {
  const film = musicCutPlan(18, 30, [2, 4, 6, 8, 10, 12].map((t) => ({ t, kind: 'cut' as const })));
  const request = musicSections(film, 'warm piano and quiet strings');
  expect(request.chunks.length).toBeGreaterThanOrEqual(3);
  expect(request.chunks.length).toBeLessThanOrEqual(30);
  expect(request.chunks.reduce((sum, chunk) => sum + chunk.duration_ms, 0)).toBe(18000);
  expect(request.chunks.every((chunk) => chunk.duration_ms >= 3000 && chunk.duration_ms <= 120000)).toBe(true);
  expect(request.chunks.every((chunk) => chunk.positive_styles.some((style) => style.includes('BPM')))).toBe(true);
  expect(request.chunks[0].text).toMatch(/^\[Intro\]/);
  expect(request.chunks[0].text).toMatch(/quiet|calm/i);
  expect(request.chunks.some((chunk) => /\[Build\].*ris/i.test(chunk.text))).toBe(true);
  expect(request.chunks.at(-1)!.text).toMatch(/^\[End/);
  expect(request.chunks.at(-1)!.text).toMatch(/hit|resolve/i);
});

it('marks a hero reveal as the strongest section and respects a late end card', () => {
  const film = musicCutPlan(24, 30, [{ t: 6, kind: 'cut' }, { t: 14, kind: 'hero' }, { t: 20, kind: 'marker' }]);
  const request = musicSections(film, 'cinematic pulse');
  expect(request.chunks.map((chunk) => chunk.text).join(' ')).toMatch(/Reveal/);
  expect(request.chunks.at(-1)!.text).toMatch(/End/);
  expect(request.chunks.reduce((sum, chunk) => sum + chunk.duration_ms, 0)).toBe(24000);
});

it('splits long films into bounded chunks and leaves the source plan untouched', () => {
  const film = musicCutPlan(300, 30, [{ t: 100, kind: 'cut' }]);
  const before = structuredClone(film);
  const request = musicSections(film, 'minimal ambient bed');
  expect(request.chunks.length).toBeGreaterThan(2);
  expect(request.chunks.every((chunk) => chunk.duration_ms <= 120000)).toBe(true);
  expect(request.chunks.reduce((sum, chunk) => sum + chunk.duration_ms, 0)).toBe(300000);
  expect(film).toEqual(before);
});

it('balances a 121-second gap within the provider section limit', () => {
  const film = musicCutPlan(121, 30, []);
  const chunks = musicSections(film, 'minimal ambient bed').chunks;
  expect(chunks.every((chunk) => chunk.duration_ms >= 3000 && chunk.duration_ms <= 120000)).toBe(true);
  expect(chunks.reduce((sum, chunk) => sum + chunk.duration_ms, 0)).toBe(121000);
});

it('keeps a hero reveal when a densely cut film exceeds thirty sections', () => {
  const film = musicCutPlan(300, 30, [
    ...Array.from({ length: 59 }, (_, i) => ({ t: (i + 1) * 5, kind: 'cut' as const })),
    { t: 155, kind: 'hero' as const },
  ]);
  const chunks = musicSections(film, 'cinematic pulse').chunks;
  expect(chunks.length).toBeLessThanOrEqual(30);
  expect(chunks.every((chunk) => chunk.duration_ms >= 3000 && chunk.duration_ms <= 120000)).toBe(true);
  expect(chunks.reduce((sum, chunk) => sum + chunk.duration_ms, 0)).toBe(300000);
  expect(chunks.some((chunk) => /^\[Reveal\].*accent/i.test(chunk.text))).toBe(true);
});
