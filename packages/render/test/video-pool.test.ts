import { describe, expect, it } from 'vitest';
import { ReaderPool, type PoolFrame } from '../src/video-pool.ts';

const FPS = 30, LENGTH = 20;

/** a fake decoder: frames of 1/30 s from the one shown at t to the end of a 20 s file; counts the frames it decodes */
function fakeFile() {
  const stats = { decoded: 0 };
  const newReader = () => async function* (t: number): AsyncGenerator<PoolFrame<string>, void, unknown> {
    for (let i = Math.floor(t * FPS + 1e-9); i < LENGTH * FPS; i++) {
      stats.decoded++;
      yield { timestamp: i / FPS, duration: 1 / FPS, canvas: `frame ${i}` };
    }
  };
  return { newReader, stats };
}

/** the picture a layer gets at t, decoded if it has to be */
async function show(pool: ReaderPool<PoolFrame<string>>, t: number) {
  await pool.read(t);
  return pool.find(t)?.canvas;
}

describe('the readers of one video file', () => {
  it('play two moments of one file at once, each reading forward', async () => {
    const { newReader, stats } = fakeFile();
    const pool = new ReaderPool(newReader);
    for (let k = 0; k < 60; k++) {
      // a crossfade between two shots of one take: 2 s and 9 s into the file, every frame
      expect(await show(pool, 2 + k / FPS)).toBe(`frame ${60 + k}`);
      expect(await show(pool, 9 + k / FPS)).toBe(`frame ${270 + k}`);
    }
    expect(pool.opened).toBe(2);
    expect(pool.size).toBe(2);
    expect(stats.decoded).toBe(120);
  });

  it('seek at every frame with a single reader, as before the pool', async () => {
    const { newReader } = fakeFile();
    const pool = new ReaderPool(newReader, 1);
    for (let k = 0; k < 30; k++) { await show(pool, 2 + k / FPS); await show(pool, 9 + k / FPS); }
    expect(pool.opened).toBe(60);
  });

  it('share a frame between layers asking for the same moment', async () => {
    const { newReader, stats } = fakeFile();
    const pool = new ReaderPool(newReader);
    for (let k = 0; k < 30; k++) {
      const t = 4 + k / FPS;
      expect(await show(pool, t)).toBe(await show(pool, t));
    }
    expect(pool.opened).toBe(1);
    expect(stats.decoded).toBe(30);
  });

  it('stay bounded: the least recently used reader starts over elsewhere', async () => {
    const { newReader } = fakeFile();
    const pool = new ReaderPool(newReader, 3);
    for (const t of [1, 5, 9]) await show(pool, t);
    await show(pool, 5 + 1 / FPS); // the reader at 5 s is used again
    await show(pool, 9 + 1 / FPS); // and the one at 9 s
    expect(await show(pool, 14)).toBe('frame 420'); // a fourth moment: the reader at 1 s goes
    expect(pool.size).toBe(3);
    expect(pool.find(1)).toBeUndefined();
    expect(pool.find(5 + 1 / FPS)?.canvas).toBe('frame 151');
    expect(pool.find(9 + 1 / FPS)?.canvas).toBe('frame 271');
  });

  it('keep a reader’s frames when another reads elsewhere (a step back on one layer)', async () => {
    const { newReader } = fakeFile();
    const pool = new ReaderPool(newReader);
    for (let k = 0; k < 6; k++) await show(pool, 2 + k / FPS);
    for (let k = 0; k < 20; k++) await show(pool, 12 + k / FPS);
    const opened = pool.opened;
    expect(await show(pool, 2 + 1 / FPS)).toBe('frame 61');
    expect(pool.opened).toBe(opened);
  });

  it('jump back on one reader and find the frame it jumped to', async () => {
    const { newReader } = fakeFile();
    const pool = new ReaderPool(newReader, 1);
    for (let k = 0; k < 10; k++) await show(pool, 6 + k / FPS);
    expect(await show(pool, 1)).toBe('frame 30');
  });

  it('give the nearest frame decoded while the right one comes', async () => {
    const { newReader } = fakeFile();
    const pool = new ReaderPool(newReader);
    await show(pool, 3);
    await show(pool, 10);
    expect(pool.nearest(3.5)?.canvas).toBe('frame 90');
    expect(pool.nearest(9)?.canvas).toBe('frame 300');
  });

  it('stop at the end of the file without a frame past it', async () => {
    const { newReader } = fakeFile();
    const pool = new ReaderPool(newReader);
    expect(await show(pool, LENGTH + 1)).toBeUndefined();
  });
});
