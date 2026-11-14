import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backAction, deviceFileOf, deviceTarget, deviceWritable, saveChoices } from '../src/device.ts';

describe('what the sheet offers for a file', () => {
  it('a video or a picture goes to the gallery, the rest to the downloads, and any can be shared', () => {
    expect(saveChoices('video/mp4')).toEqual(['gallery', 'share']);
    expect(saveChoices('video/webm')).toEqual(['gallery', 'share']);
    expect(saveChoices('image/png')).toEqual(['gallery', 'share']);
    expect(saveChoices('application/zip')).toEqual(['downloads', 'share']);
    expect(saveChoices('')).toEqual(['downloads', 'share']);
  });
});

let calls: { url: string; method: string; size: number }[];
let answer: () => Response;

beforeEach(() => {
  calls = [];
  answer = () => new Response(null, { status: 204 });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = init?.body as Uint8Array | undefined;
    calls.push({ url, method: init?.method ?? 'GET', size: body?.byteLength ?? 0 });
    return answer();
  });
});
afterEach(() => vi.unstubAllGlobals());

const puts = () => calls.filter((c) => c.method === 'PUT');
const chunk = (position: number, size: number) => ({ type: 'write' as const, data: new Uint8Array(size), position });

describe('an export written to the exports folder', () => {
  it('sends each write at the position it is given, in order', async () => {
    const { writable } = deviceWritable('a.mp4');
    const w = writable.getWriter();
    await w.write(chunk(0, 10));
    await w.write(chunk(100, 10));
    await w.write(chunk(4, 2));
    await w.close();
    expect(puts().map((c) => c.url)).toEqual(['/api/device/exports/a.mp4?at=0', '/api/device/exports/a.mp4?at=100', '/api/device/exports/a.mp4?at=4']);
  });

  it('clears an earlier export of the same name first, so no tail is left behind', async () => {
    const { writable } = deviceWritable('a.mp4');
    const w = writable.getWriter();
    await w.write(chunk(0, 1));
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: '/api/device/exports/a.mp4' });
    await w.close();
  });

  it('cuts a large write into requests of at most 8 MB, at consecutive positions', async () => {
    const { writable } = deviceWritable('big.mp4');
    const w = writable.getWriter();
    const MB = 1 << 20;
    await w.write(chunk(50, 20 * MB));
    await w.close();
    expect(puts().map((c) => c.size)).toEqual([8 * MB, 8 * MB, 4 * MB]);
    expect(puts().map((c) => c.url.split('at=')[1])).toEqual([String(50), String(50 + 8 * MB), String(50 + 16 * MB)]);
  });

  it('names the file safely in the address', async () => {
    const { writable } = deviceWritable('Mon film été.mp4');
    const w = writable.getWriter();
    await w.write(chunk(0, 1));
    await w.close();
    expect(puts()[0].url).toBe('/api/device/exports/Mon%20film%20%C3%A9t%C3%A9.mp4?at=0');
  });

  it('says in plain words when the phone refuses a write', async () => {
    answer = () => new Response('{"error":"storage error"}', { status: 500 });
    const { writable } = deviceWritable('a.mp4');
    const w = writable.getWriter();
    await expect(w.write(chunk(0, 1))).rejects.toThrow(/could not be saved/);
  });

  it('reads the finished file back, and remembers which file the blob came from', async () => {
    const { finish } = deviceWritable('a.mp4');
    answer = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'video/mp4' } });
    const blob = await finish();
    expect(blob.size).toBe(3);
    expect(blob.type).toBe('video/mp4');
    expect(deviceFileOf(blob)).toBe('a.mp4');
    expect(deviceFileOf(new Blob(['x']))).toBeUndefined();
  });

  it('is a mediabunny target', async () => {
    const { target } = await deviceTarget('a.mp4');
    expect(target.constructor.name).toBe('StreamTarget');
  });
});

describe('the back button', () => {
  it('closes what is open on top first, wherever the user is', () => {
    expect(backAction({ overlayOpen: true, path: '/p/abc' })).toBe('escape');
    expect(backAction({ overlayOpen: true, path: '/' })).toBe('escape');
  });

  it('then goes back through the pages', () => {
    expect(backAction({ overlayOpen: false, path: '/p/abc' })).toBe('history');
    expect(backAction({ overlayOpen: false, path: '/space' })).toBe('history');
  });

  it('then leaves the app, from the projects only', () => {
    expect(backAction({ overlayOpen: false, path: '/' })).toBe('exit');
  });
});
