import { describe, expect, it } from 'vitest';
import { anchorPoint, areaCandidates, isLoop, marksOf, needsConfirm, simplify, summaryOf, type Pin, type Placed } from '../src/retouch.ts';

const placed = (id: string, box: [number, number, number, number] | null, extra: Partial<Placed> = {}): Placed => ({ id, name: id.toUpperCase(), type: 'shape.rect', box: box && { x: box[0], y: box[1], w: box[2], h: box[3] }, opacity: 1, ...extra });
const FRAME = { w: 1000, h: 500 };

describe('a stroke', () => {
  it('is simplified to its shape: a straight line to its two ends, a bend kept', () => {
    const line = Array.from({ length: 50 }, (_, i) => [i / 49, 0.5] as [number, number]);
    expect(simplify(line)).toEqual([[0, 0.5], [1, 0.5]]);
    const bend = [...Array.from({ length: 20 }, (_, i) => [i / 40, 0.5] as [number, number]), ...Array.from({ length: 20 }, (_, i) => [0.5, 0.5 + i / 40] as [number, number])];
    expect(simplify(bend).length).toBeGreaterThanOrEqual(3);
  });

  it('never keeps more than the cap, ends included', () => {
    const wave = Array.from({ length: 400 }, (_, i) => [i / 399, 0.5 + 0.3 * Math.sin(i / 8)] as [number, number]);
    const s = simplify(wave, 16);
    expect(s.length).toBeLessThanOrEqual(16);
    expect(s[0]).toEqual(wave[0]);
    expect(s.at(-1)).toEqual(wave.at(-1));
  });

  it('is a loop when it comes back near where it began', () => {
    expect(isLoop([[0.2, 0.2], [0.6, 0.2], [0.6, 0.6], [0.22, 0.58]])).toBe(true);
    expect(isLoop([[0.1, 0.5], [0.4, 0.5], [0.9, 0.5]])).toBe(false);
  });
});

describe('the layers an area proposes', () => {
  // a loop round the left half of the frame, in composition pixels
  const loop: [number, number][] = [[20, 20], [480, 20], [480, 480], [20, 480], [22, 22]];
  const placedAll = [
    placed('inside', [100, 100, 100, 100]),
    placed('mostly', [400, 200, 100, 100]),
    placed('barely', [450, 200, 400, 100]),
    placed('outside', [600, 100, 100, 100]),
    placed('background', [0, 0, 1000, 500]),
    placed('hidden', [100, 300, 50, 50], { opacity: 0 }),
    placed('locked', [100, 350, 50, 50], { locked: true }),
    placed('nobox', null),
    placed('nested/child', [120, 120, 20, 20]),
  ];

  it('are those mostly inside a loop, never the ones it only touches, nor a background, a hidden, a locked or a nested layer', () => {
    const r = areaCandidates(placedAll, loop, FRAME);
    expect(r.tooMany).toBe(false);
    expect(r.layers.map((l) => l.id).sort()).toEqual(['inside', 'mostly']);
  });

  it('are those a line passes through, when it is a line', () => {
    const line: [number, number][] = [[50, 150], [900, 150]];
    const r = areaCandidates(placedAll, line, FRAME);
    expect(r.layers.map((l) => l.id).sort()).toEqual(['inside', 'outside']);
  });

  it('wait for a narrower stroke when more than eight qualify', () => {
    const many = Array.from({ length: 12 }, (_, i) => placed(`l${i}`, [20 + i * 30, 100, 20, 20]));
    const r = areaCandidates(many, [[0, 0], [900, 0], [900, 300], [0, 300], [2, 2]], FRAME);
    expect(r.tooMany).toBe(true);
    expect(r.count).toBe(12);
    expect(r.layers).toEqual([]);
  });
});

describe('the confirmation step, as the settings say it', () => {
  it('is always asked, or only for more than three layers, or never', () => {
    expect(needsConfirm('always', 1)).toBe(true);
    expect(needsConfirm('many', 3)).toBe(false);
    expect(needsConfirm('many', 4)).toBe(true);
    expect(needsConfirm('never', 7)).toBe(false);
  });
});

describe('pins as the list shows them and as the assistant reads them', () => {
  const pins: Pin[] = [
    { id: 'a', kind: 'point', at: [0.5, 0.5], under: { id: 't', name: 'T', type: 'text' } },
    { id: 'b', kind: 'path', points: [[0.1, 0.1], [0.9, 0.9]] },
    { id: 'c', kind: 'area', points: [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4]], layers: [{ id: 'x', name: 'X', type: 'image' }] },
  ];

  it('are numbered from where the message starts, one mark each', () => {
    const marks = marksOf(pins, 4);
    expect(marks.map((m) => [m.n, m.kind])).toEqual([[4, 'point'], [5, 'path'], [6, 'area']]);
  });

  it('are summed up in a few words', () => {
    expect(summaryOf(pins)).toBe('1 point · 1 path · 1 selection of 1 layer');
    expect(summaryOf([])).toBe('');
  });

  it('have an anchor on the picture for their badge: the point, the start of a path, the middle of an area', () => {
    expect(anchorPoint(pins[0])).toEqual([0.5, 0.5]);
    expect(anchorPoint(pins[1])).toEqual([0.1, 0.1]);
    const c = anchorPoint(pins[2]);
    expect(c[0]).toBeCloseTo(0.3, 2);
  });
});
