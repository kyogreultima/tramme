import { describe, expect, it } from 'vitest';
import { pathD } from '@tramme/core';
import { parsePathData, readSvg } from '../src/svg.ts';
import type { PathValue } from '@tramme/core';

describe('the SVG path data parser', () => {
  it('reads a mixed path back exactly', () => {
    const pv: PathValue = { v: [[0, 0], [100, 0], [100, 100]], i: [[0, 0], [0, 10]], o: [[-20, 0], [10, 0]], closed: false };
    expect(parsePathData(pathD(pv))[0]).toEqual(pv);
  });

  it('splits contours at every move', () => {
    const out = parsePathData('M0,0L10,0M20,10L30,10Z M40,40L50,40');
    expect(out).toHaveLength(3);
    expect(out[1].closed).toBe(true);
    expect(out[2].v[0]).toEqual([40, 40]);
  });

  it('handles relative commands, shorthand and verticals', () => {
    const [p] = parsePathData('m10,10 l20,0 h5 v4 c1,1 2,2 3,3 s1,1 2,2 q1,1 2,2 t2,2 z');
    expect(p.v[0]).toEqual([10, 10]);
    expect(p.v.at(-1)).toEqual([10 + 20 + 5 + 3 + 2 + 2 + 2, 10 + 4 + 3 + 2 + 2 + 2]);
    expect(p.closed).toBe(true);
  });

  it('turns arcs into cubics that land on their end', () => {
    const [q] = parsePathData('M0,0 A25,25 0 0 1 25,25');
    expect(q.v.at(-1)).toEqual([25, 25]);
    // every vertex stays on the circle of radius 25 about its centre (25,0)
    for (const [x, y] of q.v) expect(Math.hypot(x - 25, y)).toBeCloseTo(25, 1);
    const [half] = parsePathData('M0,0 A50,50 0 0 1 100,0');
    expect(half.v.length).toBeGreaterThanOrEqual(3);
    expect(half.v.at(-1)).toEqual([100, 0]);
  });

  it('reads arc flags written against what follows them', () => {
    // svgo writes "0 012 2" for the flags 0 and 1 then x = 2: the L after it must stay a line
    const [p] = parsePathData('M2 2a2 2 0 012 2L8 8');
    expect(p.v.at(-1)).toEqual([8, 8]);
    expect(p.v.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(p.v).toContainEqual([4, 4]); // the arc lands two units on, as its spaced twin does
    expect(parsePathData('M2 2a2 2 0 0 1 2 2L8 8')).toEqual(parsePathData('M2 2a2 2 0 012 2L8 8'));
  });

  it('skips numbers after a close instead of looping on them', () => {
    const out = parsePathData('M0 0L10 0L10 10Z 5 5');
    expect(out).toHaveLength(1);
    expect(out[0].closed).toBe(true);
  });
});

/** the point halfway along segment a → a+1 of a path (a cubic's midpoint) */
function midOf(p: PathValue, a: number): [number, number] {
  const b = (a + 1) % p.v.length;
  const o = p.o?.[a] ?? [0, 0], i = p.i?.[b] ?? [0, 0];
  const P0 = p.v[a], P3 = p.v[b];
  const P1 = [P0[0] + o[0], P0[1] + o[1]], P2 = [P3[0] + i[0], P3[1] + i[1]];
  return [(P0[0] + 3 * P1[0] + 3 * P2[0] + P3[0]) / 8, (P0[1] + 3 * P1[1] + 3 * P2[1] + P3[1]) / 8];
}

describe('the SVG reader, shapes and sizes', () => {
  it('bends a circle round: every quarter passes through the circle', () => {
    const [{ path }] = readSvg('<svg width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>').shapes;
    for (let a = 0; a < 4; a++) {
      const [x, y] = midOf(path, a);
      expect(Math.hypot(x - 12, y - 12)).toBeCloseTo(10, 1);
    }
  });

  it('keeps a rounded rectangle\'s edges straight and its corners round', () => {
    const [{ path }] = readSvg('<svg width="24" height="24"><rect x="2" y="2" width="20" height="20" rx="4"/></svg>').shapes;
    // the vertices run: top edge (0→1), corner (1→2), right edge (2→3), corner (3→4)…
    const centres = [[18, 6], [18, 18], [6, 18], [6, 6]];
    for (let c = 0; c < 4; c++) {
      const [x, y] = midOf(path, 2 * c + 1);
      expect(Math.hypot(x - centres[c][0], y - centres[c][1])).toBeCloseTo(4, 1);
    }
    expect(midOf(path, 0)).toEqual([12, 2]); // the top edge, straight
    expect(midOf(path, 2)).toEqual([22, 12]); // the right edge, straight
  });

  it('fills an unstyled shape in black, as SVG does', () => {
    const r = readSvg('<svg viewBox="0 0 24 24"><path d="M0 0L10 0L10 10Z"/><path d="M0 0L5 5" fill="none" stroke="red"/></svg>');
    expect(r.shapes[0].fill).toBe('#000000');
    expect(r.shapes[0].stroke).toBeNull();
    expect(r.shapes[1].fill).toBeNull();
  });

  it('maps the viewBox into the size, and reads the size from the root alone', () => {
    const big = readSvg('<svg width="32" height="32" viewBox="0 0 512 512"><rect x="0" y="0" width="512" height="512"/></svg>');
    expect(big.width).toBe(32);
    expect(Math.max(...big.shapes[0].path.v.map((q) => q[0]))).toBe(32);
    const moved = readSvg('<svg viewBox="100 100 50 50"><rect x="100" y="100" width="10" height="10"/></svg>');
    expect([moved.width, moved.height]).toEqual([50, 50]);
    expect(moved.shapes[0].path.v[0]).toEqual([0, 0]);
    const stroked = readSvg('<svg stroke-width="2" width="24" height="24"><rect width="4" height="4"/></svg>');
    expect(stroked.width).toBe(24);
    const one = readSvg('<svg width="48" viewBox="0 0 24 12"><rect width="24" height="12"/></svg>');
    expect([one.width, one.height]).toEqual([48, 24]);
  });
});

describe('the SVG reader', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
    <g fill="red" stroke="blue" stroke-width="3" transform="translate(10,20)">
      <rect id="box" x="0" y="0" width="40" height="20" rx="5"/>
      <circle cx="10" cy="10" r="5" fill="none"/>
      <path d="M1 1C2 2 3 3 4 4" stroke="green"/>
      <rect x="0" y="0" width="5" height="5" display="none"/>
    </g>
    <defs><linearGradient id="g"><stop stop-color="white"/></linearGradient></defs>
    <rect x="70" y="0" width="10" height="10" fill="url(#g)"/>
    <polyline points="0,0 10,10 20,0" stroke="black" fill="none"/>
  </svg>`;

  it('reads the shapes with their inherited presentation and transforms', () => {
    const r = readSvg(svg);
    expect(r.width).toBe(200);
    expect(r.height).toBe(100);
    expect(r.shapes).toHaveLength(5); // the hidden rect and the defs are out; the referenced fill leaves its shape with none
    const [box, dot, line, , open] = r.shapes;
    expect(box.id).toBe('box');
    expect(box.fill).toBe('red');
    expect(box.stroke).toBe('blue');
    expect(box.strokeWidth).toBe(3);
    expect(box.path.v[0]).toEqual([15, 20]); // the rounded corner, moved by the group
    expect(dot.fill).toBeNull();
    expect(dot.path.v).toHaveLength(4);
    expect(line.stroke).toBe('green');
    expect(line.fill).toBe('red'); // inherited from the group
    expect(open.stroke).toBe('black');
    expect(open.fill).toBeNull();
    expect(open.path.closed).toBe(false);
  });

  it('reports the paints it cannot carry', () => {
    const r = readSvg(svg);
    expect(r.warnings.join(' ')).toContain('by reference');
  });

  it('nests transforms down the groups', () => {
    const r = readSvg(`<svg width="10" height="10"><g transform="translate(5,0)"><g transform="scale(2)"><rect x="1" y="1" width="2" height="2"/></g></g></svg>`);
    expect(r.shapes[0].path.v[0]).toEqual([7, 2]); // (1,1) scaled by 2 then moved by 5
  });
});
