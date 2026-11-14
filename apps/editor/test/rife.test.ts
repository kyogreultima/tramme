import { describe, expect, it } from 'vitest';
import { fromPlanes, stacked, TILE, TileBlend, tilesOf } from '../src/rife.ts';
import { defaultModel, modelsFor } from '../src/models.ts';

describe('the frames RIFE takes and gives', () => {
  // 2 × 1: a red pixel then a blue one, and the same reversed
  const a = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) };
  const b = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 255, 255, 255, 0, 0, 255]) };

  it('stacks two pictures as six planes of 0..1, the first then the second', () => {
    expect([...stacked(a, b)]).toEqual([1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0]);
  });

  it('turns three planes back into an opaque picture', () => {
    expect(fromPlanes(stacked(a, b).slice(0, 6), 2, 1)).toEqual(a);
    expect(fromPlanes([1.2, -0.1, 0, 0, 0, 0.5], 2, 1).data).toEqual(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 128, 255]));
  });

  it('is offered for the slow motion beside the built-in matching, which stays the default', () => {
    expect(defaultModel('interpolate').id).toBe('block-motion');
    expect(modelsFor('interpolate').find((m) => m.id === 'rife')).toMatchObject({ licence: 'MIT', commercial: true, adapter: { kind: 'rife' } });
  });
});

describe('a large frame made in tiles', () => {
  it('covers a 4K frame with overlapping tiles no side over 1280, one tile for a frame that fits', () => {
    const tiles = tilesOf(3840, 2160);
    expect(tiles.length).toBe(8);
    expect(tiles.every((t) => t.region.width <= TILE && t.region.height <= TILE)).toBe(true);
    const seen = new Uint8Array(3840 * 2160);
    for (const { region: r } of tiles) for (let y = r.y; y < r.y + r.height; y++) seen.fill(1, y * 3840 + r.x, y * 3840 + r.x + r.width);
    expect(seen.every((v) => v === 1)).toBe(true);
    expect(tilesOf(1920, 1080)).toHaveLength(1);
  });

  it('lays the tiles back with no seam: a picture cut and blended is the picture', () => {
    const w = 300, h = 170, pic = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    for (let p = 0; p < w * h; p++) pic.data.set([(p * 7) % 256, (p * 13) % 256, (p * 3) % 256, 255], p * 4);
    const tiles = tilesOf(w, h, 100), blend = new TileBlend(w, h);
    for (const t of tiles) blend.add(t, stacked(pic, pic, t.region).slice(0, 3 * t.region.width * t.region.height));
    const back = blend.done().data, off: number[] = [];
    for (let i = 0; i < back.length; i++) if (back[i] !== pic.data[i]) off.push(i);
    expect(off.slice(0, 5).map((i) => [i, back[i], pic.data[i]])).toEqual([]);
  });
});

describe('RIFE over a whole video', () => {
  it('makes a pair again on a new session, then on the processor, when the GPU is lost', async () => {
    const { vi } = await import('vitest');
    const opened: boolean[] = [], dropped: boolean[] = [];
    let gpuFails = 2;
    vi.resetModules();
    vi.doMock('../src/onnx-session.ts', () => ({
      sessionOf: async (_e: unknown, o: { cpu?: boolean } = {}) => {
        opened.push(!!o.cpu);
        return {
          ort: { Tensor: class { data: unknown; constructor(_t: string, data: unknown) { this.data = data; } } },
          session: { outputNames: ['output'], run: async () => { if (!o.cpu && gpuFails-- > 0) throw new Error('device lost'); return { output: { data: new Float32Array(3) } }; } },
        };
      },
      dropSession: (_e: unknown, o: { cpu?: boolean } = {}) => { dropped.push(!!o.cpu); },
    }));
    const { RifeRun } = await import('../src/rife.ts');
    const { modelsFor } = await import('../src/models.ts');
    const run = new RifeRun(modelsFor('interpolate').find((m) => m.id === 'rife')!);
    const px = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    await run.between(px, px, [0.5]);
    expect(opened).toEqual([false, false, true]);
    expect(dropped).toEqual([false, false]);
    expect(run.cpu).toBe(true);
    expect(run.made).toBe(1);
    // the next pair stays on the processor
    await run.between(px, px, [0.5]);
    expect(opened.at(-1)).toBe(true);
    vi.doUnmock('../src/onnx-session.ts');
  });
});

describe('the size the slow motion is made at', () => {
  it('brings a 4K source down to cover a 1080p film, and never enlarges a small one', async () => {
    const { filmSize } = await import('../src/longtools.ts');
    const doc = (w: number, h: number) => ({ compositions: { a: { width: 640, height: 360 }, b: { width: w, height: h } } }) as never;
    expect(filmSize(doc(1920, 1080), 3840, 2160)).toEqual([1920, 1080]);
    // a portrait film from a landscape source: it covers the height
    expect(filmSize(doc(1080, 1920), 3840, 2160)).toEqual([3414, 1920]);
    expect(filmSize(doc(1920, 1080), 1280, 721)).toEqual([1280, 722]);
  });
});
