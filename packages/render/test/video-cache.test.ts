import { afterEach, expect, it, vi } from 'vitest';
import * as cache from '../src/video-cache.ts';

afterEach(() => vi.unstubAllGlobals());
const load = (url: string) => (cache as { previewVideoBlob(url: string): Promise<Blob | null> }).previewVideoBlob(url);

function server(initial: Uint8Array) {
  let data = initial, version = '1';
  const ranges: string[] = [];
  vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(data.length), etag: version, 'accept-ranges': 'bytes', 'content-type': 'video/mp4' } });
    const range = new Headers(init?.headers).get('range')!;
    ranges.push(range);
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    const start = Number(from), end = Number(to);
    return new Response(data.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${data.length}` } });
  });
  return { ranges, replace(next: Uint8Array) { data = next; version = '2'; } };
}

it('loads a small preview in bounded parts and shares simultaneous reads', async () => {
  // two whole pieces and a short last one
  const P = cache.RANGE_PIECE, data = new Uint8Array(2 * P + 1000);
  // a 251-byte pattern doubled into the whole array (16 MB filled byte by byte is slow on a busy runner)
  for (let i = 0; i < 251; i++) data[i] = i;
  for (let n = 251; n < data.length; n *= 2) data.copyWithin(n, 0, Math.min(n, data.length - n));
  const fixture = server(data);
  const [first, second] = await Promise.all([load('https://tramme.test/preview-a.mp4'), load('https://tramme.test/preview-a.mp4')]);
  expect(first).toBe(second);
  // compared as bytes: a deep equality this long is slow enough to time out on a busy runner
  expect(Buffer.from(await first!.arrayBuffer()).equals(Buffer.from(data))).toBe(true);
  expect(fixture.ranges).toEqual([`bytes=0-${P - 1}`, `bytes=${P}-${2 * P - 1}`, `bytes=${2 * P}-${2 * P + 999}`]);
});

it('invalidates a cached preview when its server version changes', async () => {
  const fixture = server(new Uint8Array([1, 2, 3]));
  const before = await load('https://tramme.test/preview-b.mp4');
  expect(await load('https://tramme.test/preview-b.mp4')).toBe(before);
  expect(fixture.ranges).toHaveLength(1);
  fixture.replace(new Uint8Array([4, 5, 6]));
  expect([...new Uint8Array(await (await load('https://tramme.test/preview-b.mp4'))!.arrayBuffer())]).toEqual([4, 5, 6]);
  expect(fixture.ranges).toHaveLength(2);
});

it('keeps a large original streaming instead of downloading it whole', async () => {
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
    requests.push(init?.method ?? 'GET');
    return new Response(null, { headers: { 'content-length': '373179626', etag: 'original', 'accept-ranges': 'bytes' } });
  });
  expect(await load('https://tramme.test/original.mp4')).toBeNull();
  expect(requests).toEqual(['HEAD']);
});
