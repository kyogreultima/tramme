// The part of a layer its Canvas 2D filters run over (docs/performance-roadmap.md,
// step 4): the layer's box on the canvas, grown by a margin for its ink and by
// what each filter spreads, or the whole frame when one of them cannot say.

import { describe, expect, it } from 'vitest';
import { EFFECTS } from '@tramme/nodes';
import { filterBox } from '../src/canvas2d.ts';

const fxOf = (t: string) => EFFECTS.find((e) => e.type === t)!;
const blur = fxOf('fx.blur'), glow = fxOf('fx.glow'), shadow = fxOf('fx.shadow');
const at = { a: 1, b: 0, c: 0, d: 1, e: 500, f: 300 } as DOMMatrix;
const layer = (over: Record<string, unknown> = {}) => ({ id: 'l', layer: { type: 'shape.ellipse' }, props: {}, children: [], node: { render: { canvas2d: () => {} }, bounds: () => ({ x: -50, y: -50, w: 100, h: 100 }) }, ...over }) as never;
const env = { host: () => ({}) } as never;

describe('the box a layer is filtered over', () => {
  it('is its box with a margin for ink, grown by each filter\'s reach, within the canvas', () => {
    const fx = [{ e: { props: { radius: 10 } }, type: blur }] as never;
    // ink margin 48 + 5 % of 100, then the blur's 3 σ + 2
    expect(filterBox(layer(), env, at, fx, 1, 1920, 1080)).toEqual({ x: 500 - 50 - 53 - 32, y: 300 - 50 - 53 - 32, w: 100 + 2 * 53 + 2 * 32, h: 100 + 2 * 53 + 2 * 32 });
    const big = [{ e: { props: { radius: 600 } }, type: blur }] as never;
    expect(filterBox(layer(), env, at, big, 1, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('adds the reaches of the filters chained, the glow\'s shadows each', () => {
    const one = filterBox(layer(), env, at, [{ e: { props: { radius: 10, strength: 1, color: '#fff' } }, type: glow }] as never, 1, 4000, 4000)!;
    const four = filterBox(layer(), env, at, [{ e: { props: { radius: 10, strength: 4, color: '#fff' } }, type: glow }] as never, 1, 4000, 4000)!;
    expect(four.w - one.w).toBe(2 * 3 * 30);
    const both = filterBox(layer(), env, at, [{ e: { props: { radius: 10, strength: 1, color: '#fff' } }, type: glow }, { e: { props: { blur: 10, offset: [0, 20], color: '#000' } }, type: shadow }] as never, 1, 4000, 4000)!;
    expect(both.w - one.w).toBe(2 * (20 + 30 + 2));
  });

  it('is the whole frame when something cannot say where it draws', () => {
    const fx = [{ e: { props: { radius: 10 } }, type: blur }] as never;
    expect(filterBox(layer({ node: { render: { canvas2d: () => {} } } }), env, at, fx, 1, 1920, 1080)).toBeNull();
    expect(filterBox(layer({ node: { render: { canvas2d: () => {} }, bounds: () => null, simulate: {} } }), env, at, fx, 1, 1920, 1080)).toBeNull();
    expect(filterBox(layer(), env, at, [{ e: { props: {} }, type: { canvas2d: { filter: () => 'sepia(1)' } } }] as never, 1, 1920, 1080)).toBeNull();
    expect(filterBox(layer(), env, at, [{ e: { props: {} }, type: { canvas2d: { apply: () => {} } } }] as never, 1, 1920, 1080)).toBeNull();
  });
});
