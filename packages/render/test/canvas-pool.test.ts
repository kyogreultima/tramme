import { describe, expect, it } from 'vitest';
import { CanvasPool } from '../src/canvas2d.ts';

describe('the isolated renderer canvas pool', () => {
  it('releases surfaces beyond its retention limit', () => {
    const pool = new CanvasPool(false, 1);
    const first = { canvas: { width: 4096, height: 4096 } } as unknown as CanvasRenderingContext2D;
    const excess = { canvas: { width: 4096, height: 4096 } } as unknown as CanvasRenderingContext2D;
    pool.release(first);
    pool.release(excess);
    expect(first.canvas.width).toBe(4096);
    expect(excess.canvas.width).toBe(0);
    expect(excess.canvas.height).toBe(0);
  });
});
