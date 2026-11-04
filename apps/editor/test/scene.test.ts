import { describe, expect, it } from 'vitest';
import { at, itemsFor, layoutOf, lookOf, progressOf, wiresFor, ILLUSTRATIONS, KINDS } from '../src/ui/scene.ts';

const ends = (d: string) => {
  const n = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  return { start: [n[0], n[1]], end: [n[n.length - 2], n[n.length - 1]] };
};

describe('the wires behind the sign-in card', () => {
  it('is a wide scene on a landscape screen and a tall one on a phone', () => {
    expect(layoutOf(1280, 860)).toBe('wide');
    expect(layoutOf(1920, 1080)).toBe('wide');
    expect(layoutOf(390, 844)).toBe('tall');
    expect(layoutOf(800, 850)).toBe('wide');
  });

  it('brings every input wire from outside the screen to the card, and takes every output wire from the card out', () => {
    for (const [W, H] of [[1280, 860], [1920, 1080], [390, 844]]) {
      const cx = W / 2, cy = H * 0.4;
      const { inputs, outputs } = wiresFor(W, H, cx, cy);
      expect(inputs.length).toBeGreaterThanOrEqual(5);
      expect(outputs.length).toBeGreaterThanOrEqual(3);
      for (const d of inputs) {
        const { start, end } = ends(d);
        expect(end).toEqual([cx, cy]);
        expect(start[0] < 0 || start[1] < 0, `${W}x${H} starts off screen: ${start}`).toBe(true);
      }
      for (const d of outputs) {
        const { start, end } = ends(d);
        expect(start).toEqual([cx, cy]);
        expect(end[0] > W || end[1] > H, `${W}x${H} ends off screen: ${end}`).toBe(true);
      }
    }
  });

  it('spreads the wires so that no two start at the same place', () => {
    const { inputs, outputs } = wiresFor(1280, 860, 640, 340);
    expect(new Set(inputs.map((d) => ends(d).start.join())).size).toBe(inputs.length);
    expect(new Set(outputs.map((d) => ends(d).end.join())).size).toBe(outputs.length);
  });
});

describe('the things that travel', () => {
  it('puts several things on every wire, of every kind, and never two alike side by side', () => {
    const items = itemsFor(7, 4);
    for (let w = 0; w < 7; w++) expect(items.filter((i) => i.side === 'in' && i.wire === w).length).toBeGreaterThanOrEqual(2);
    for (let w = 0; w < 4; w++) expect(items.filter((i) => i.side === 'out' && i.wire === w).length).toBeGreaterThanOrEqual(1);
    expect(new Set(items.filter((i) => i.side === 'in').map((i) => i.kind))).toEqual(new Set(KINDS));
    const inputs = items.filter((i) => i.side === 'in');
    for (let i = 1; i < inputs.length; i++) expect(inputs[i].kind).not.toBe(inputs[i - 1].kind);
  });

  it('shows every drawing once among the films, in the three formats', () => {
    const films = itemsFor(7, 4).filter((i) => i.side === 'out');
    expect(films.map((f) => f.film).sort()).toEqual([...ILLUSTRATIONS].sort());
    expect(new Set(films.map((f) => f.kind))).toEqual(new Set(['16:9', '9:16', '1:1']));
  });

  it('does not set them off together: the phases differ', () => {
    const phases = itemsFor(7, 4).filter((i) => i.side === 'in').map((i) => i.phase.toFixed(3));
    expect(new Set(phases).size).toBeGreaterThan(phases.length * 0.8);
  });

  it('is calm: a crossing takes ten seconds at least', () => {
    for (const item of itemsFor(7, 4)) expect(item.seconds).toBeGreaterThanOrEqual(10);
  });
});

describe('progress along a wire', () => {
  const item = { side: 'in' as const, wire: 0, kind: 'photo', seconds: 10, phase: 0.25 };

  it('starts where its phase says, and goes on at a steady pace', () => {
    expect(progressOf(item, 0)).toBeCloseTo(0.25);
    expect(progressOf(item, 5000)).toBeCloseTo(0.75);
  });

  it('starts over at the beginning of the wire once it has crossed', () => {
    expect(progressOf(item, 7500)).toBeCloseTo(0);
    expect(progressOf(item, 10_000)).toBeCloseTo(0.25);
    for (let ms = 0; ms < 60_000; ms += 1370) {
      const t = progressOf(item, ms);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
    }
  });
});

describe('how a thing looks along its wire', () => {
  const grid = Array.from({ length: 101 }, (_, i) => i / 100);

  it('comes in whole and disappears into the card, never the other way round', () => {
    expect(lookOf('in', 0.3)).toEqual({ scale: 1, opacity: 1 });
    expect(lookOf('in', 0).opacity).toBe(0);
    expect(lookOf('in', 0.99).opacity).toBe(0);
    expect(lookOf('in', 0.95).scale).toBeLessThan(1);
  });

  it('comes out small from behind the card, grows, and fades at the edge of the screen', () => {
    expect(lookOf('out', 0).opacity).toBe(0);
    expect(lookOf('out', 0.02).scale).toBeLessThan(0.6);
    expect(lookOf('out', 0.5)).toEqual({ scale: 1, opacity: 1 });
    expect(lookOf('out', 0.99).opacity).toBe(0);
  });

  it('only grows on the way out, and stays within 0 and 1', () => {
    let last = 0;
    for (const t of grid) {
      const { scale, opacity } = lookOf('out', t);
      expect(scale).toBeGreaterThanOrEqual(last - 1e-9);
      last = scale;
      expect(opacity).toBeGreaterThanOrEqual(0);
      expect(opacity).toBeLessThanOrEqual(1);
    }
    for (const t of grid) {
      const { scale, opacity } = lookOf('in', t);
      expect(scale).toBeGreaterThan(0);
      expect(opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe('a point at a distance along a wire', () => {
  const points: [number, number][] = [[0, 0], [10, 0], [10, 20]];

  it('is found between the samples', () => {
    expect(at(points, 0)).toEqual([0, 0]);
    expect(at(points, 0.5)).toEqual([10, 0]);
    expect(at(points, 0.25)).toEqual([5, 0]);
    expect(at(points, 0.75)).toEqual([10, 10]);
    expect(at(points, 1)).toEqual([10, 20]);
  });

  it('stays on the wire for a progress outside it', () => {
    expect(at(points, -1)).toEqual([0, 0]);
    expect(at(points, 2)).toEqual([10, 20]);
  });
});
