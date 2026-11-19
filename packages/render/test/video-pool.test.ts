import { describe, expect, it } from 'vitest';
import { KEEP, MAX_READERS, ReaderPool, type PoolFrame } from '../src/video-pool.ts';

const FPS = 30, LENGTH = 20;

/** a fake decoder: frames of 1/30 s from the one shown at t to the end of a 20 s file; counts the frames it decodes */
function fakeFile() {
  const stats = { decoded: 0 };
  const newReader = () => async function* (t: number): AsyncGenerator<PoolFrame<string>, void, unknown> {
    for (let i = Math.floor(t * FPS + 1e-9); i < LENGTH * FPS; i++) {
      stats.decoded++;
      yield { timestamp: i / FPS, duration: 1 / FPS, picture: `frame ${i}` };
    }
  };
  return { newReader, stats };
}

/** the picture a layer gets at t, decoded if it has to be */
async function show(pool: ReaderPool<PoolFrame<string>>, t: number) {
  await pool.read(t);
  return pool.find(t)?.picture;
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
    expect(pool.find(5 + 1 / FPS)?.picture).toBe('frame 151');
    expect(pool.find(9 + 1 / FPS)?.picture).toBe('frame 271');
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
    expect(pool.nearest(3.5)?.picture).toBe('frame 90');
    expect(pool.nearest(9)?.picture).toBe('frame 300');
  });

  it('stop at the end of the file without a frame past it', async () => {
    const { newReader } = fakeFile();
    const pool = new ReaderPool(newReader);
    expect(await show(pool, LENGTH + 1)).toBeUndefined();
  });

  it('hands each frame it lets go to drop once, and keeps the ones it holds open', async () => {
    const { newReader } = fakeFile();
    const dropped: string[] = [];
    const pool = new ReaderPool(newReader, MAX_READERS, (f) => dropped.push(f.picture));
    // playing forward: past KEEP frames, the oldest go
    for (let k = 0; k < KEEP + 4; k++) await show(pool, 1 + k / FPS);
    expect(dropped).toEqual(['frame 30', 'frame 31', 'frame 32', 'frame 33']);
    // one decoder for it all: a time on the end of the last frame (1 + k/30 in floating point) continues it
    expect(pool.opened).toBe(1);
    // what is kept is never dropped
    for (let k = 4; k < KEEP + 4; k++) expect(pool.find(1 + k / FPS)?.picture).toBe(`frame ${30 + k}`);
    // more places than readers: the least used starts over and its frames go
    await show(pool, 5); await show(pool, 10); await show(pool, 15);
    expect(dropped).toContain(`frame ${30 + KEEP + 3}`);
    // closing: everything still held goes, each frame once
    pool.dispose();
    expect(new Set(dropped).size).toBe(dropped.length);
    expect(dropped).toContain('frame 450');
  });

  it('decode the next shot before its cut while the shot playing goes on, each reader on its own', async () => {
    // a decoder that takes 5 ms a frame: a start decodes from the keyframe a second back before the frame asked
    const order: string[] = [];
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const newReader = () => async function* (t: number): AsyncGenerator<PoolFrame<string>, void, unknown> {
      if (t > 5) await wait(30 * 5);
      for (let i = Math.floor(t * FPS + 1e-9); i < LENGTH * FPS; i++) {
        await wait(5);
        yield { timestamp: i / FPS, duration: 1 / FPS, picture: `frame ${i}` };
      }
    };
    const pool = new ReaderPool(newReader);
    await show(pool, 2);
    // the next shot (9 s) asked ahead; the shot playing keeps asking for its frames meanwhile
    const next = pool.read(9, 'ahead').then(() => order.push('next'));
    for (let k = 1; k <= 3; k++) await pool.read(2 + k / FPS).then(() => order.push(`playing ${k}`));
    await next;
    // the frames playing came while the next shot was still decoding
    expect(order).toEqual(['playing 1', 'playing 2', 'playing 3', 'next']);
    expect(pool.find(9)?.picture).toBe('frame 270');
    expect(pool.opened).toBe(2);
  });

  it('give two requests for one moment, made at once, to one reader', async () => {
    const { newReader, stats } = fakeFile();
    const pool = new ReaderPool(newReader);
    await Promise.all([pool.read(7), pool.read(7), pool.read(7 + 1 / FPS)]);
    expect(pool.opened).toBe(1);
    expect(stats.decoded).toBe(2);
    expect(pool.find(7 + 1 / FPS)?.picture).toBe('frame 211');
  });

  it('leave the reader a playback is on when the next shot is cued a moment later in the same file', async () => {
    const { newReader } = fakeFile();
    const pool = new ReaderPool(newReader);
    for (let k = 0; k < 4; k++) await show(pool, 7 + k / FPS);
    // the next shot starts 0.8 s further in the file: cued on a reader of its own
    await pool.read(7.9, 'ahead');
    expect(pool.opened).toBe(2);
    // the playing shot goes on from its own reader, its frames still there
    expect(await show(pool, 7 + 4 / FPS)).toBe('frame 214');
    expect(pool.find(7 + 3 / FPS)?.picture).toBe('frame 213');
    expect(pool.opened).toBe(2);
    // its next frame, cued: on the same reader
    await pool.read(7 + 5 / FPS, 'ahead');
    expect(pool.opened).toBe(2);
  });

  it('give the requests from the side (thumbnails along the file) a reader of their own', async () => {
    const { newReader } = fakeFile();
    const pool = new ReaderPool(newReader);
    for (let k = 0; k < 3; k++) await show(pool, 4 + k / FPS);
    // thumbnails all along the file, many places
    for (const t of [1, 3, 6, 9, 12, 15, 18]) await pool.read(t, 'side');
    // the frames playing stay, and their reader goes on
    const opened = pool.opened;
    expect(await show(pool, 4 + 3 / FPS)).toBe('frame 123');
    expect(pool.opened).toBe(opened);
    expect(pool.size).toBe(1);
    // what the side reader decoded serves anyone
    expect(pool.find(18)?.picture).toBe('frame 540');
  });
});
