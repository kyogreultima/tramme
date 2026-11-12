import { describe, expect, it } from 'vitest';
import { SUBJECT_LEAST, rhythmLines, rhythmOf, rhythmTimes, type Frame } from '../src/critic/rhythm.ts';

const W = 96, H = 54;
/** a frame of one background with a filled box, its corners in cells of the frame */
function frame(t: number, box: [number, number, number, number] | null, bg = [20, 20, 30], ink = [240, 200, 60]): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, inside = box && x >= box[0] && x < box[2] && y >= box[1] && y < box[3];
    const c = inside ? ink : bg;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { t, data, width: W, height: H };
}
const film = (seconds: number, at: (t: number) => Frame) => rhythmOf(rhythmTimes(seconds).map(at), seconds);

describe('the rhythm of a film', () => {
  it('measures up to four frames a second, at most 160 in all', () => {
    expect(rhythmTimes(5)).toHaveLength(20);
    expect(rhythmTimes(120)).toHaveLength(160);
    expect(rhythmTimes(0)).toEqual([]);
  });

  it('finds the longest stretch where nothing moves, its closing hold left out', () => {
    // a box moves for 2 s, then holds until the end of a 12 s film
    const r = film(12, (t) => frame(t, [Math.round(Math.min(t, 2) * 10), 20, Math.round(Math.min(t, 2) * 10) + 20, 34]));
    expect(r.frozen!.from).toBeCloseTo(2, 0);
    expect(r.frozen!.to).toBeLessThanOrEqual(12 - 2.5);
    expect(r.still).toBeGreaterThan(0.7);
    const { defects } = rhythmLines(r);
    expect(defects.some((d) => d.startsWith('nothing moves for'))).toBe(true);
    expect(defects.some((d) => d.includes('stands still'))).toBe(true);
  });

  it('lets a film that keeps moving and a closing hold pass', () => {
    const r = film(10, (t) => frame(t, t < 8 ? [Math.round(t * 8), 5, Math.round(t * 8) + 30, 50] : [64, 5, 94, 50]));
    expect(r.still).toBeLessThan(0.1);
    expect(rhythmLines(r).defects).toEqual([]);
  });

  it('reads a small subject in a large empty frame, and a film that is one picture', () => {
    const r = film(8, (t) => frame(t, [44 + (Math.round(t * 4) % 2), 24, 52 + (Math.round(t * 4) % 2), 30]));
    expect(r.subject).toBeLessThan(0.05);
    expect(r.looks).toBe(1);
    const { facts } = rhythmLines(r);
    expect(facts.some((f) => f.includes('the subject reads small'))).toBe(true);
    expect(facts.some((f) => f.includes('one picture'))).toBe(true);
  });

  it('counts the different pictures of a film that cuts', () => {
    const r = film(8, (t) => (t < 4 ? frame(t, [0, 0, 96, 54 - Math.round(t)], [20, 20, 30], [230, 80, 60]) : frame(t, [10, 10, 86, 44 + Math.round(t - 4)], [240, 235, 220], [30, 40, 200])));
    expect(r.looks).toBeGreaterThanOrEqual(2);
    expect(r.subject).toBeGreaterThan(SUBJECT_LEAST);
  });
});
