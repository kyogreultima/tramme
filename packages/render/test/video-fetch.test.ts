import { afterEach, expect, it, vi } from 'vitest';
import { fetchVideoRange } from '../src/video.ts';

afterEach(() => vi.unstubAllGlobals());
const read = fetchVideoRange;

it('finishes a bounded video transfer before exposing its body to a paused decoder', async () => {
  let range = '', finished = false;
  const signal = new AbortController().signal;
  let receivedSignal: AbortSignal | null | undefined;
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    range = new Headers(init.headers).get('range')!;
    receivedSignal = init.signal;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); }, pull(controller) { finished = true; controller.close(); } });
    return new Response(body, { status: 206, headers: { 'content-range': 'bytes 1024-1026/373179626' } });
  });
  const response = await read('https://tramme.test/video.mp4', { headers: { range: 'bytes=1024-' }, signal });
  expect(range).toBe('bytes=1024-263167');
  expect(receivedSignal).toBe(signal);
  expect(finished).toBe(true);
  expect(response.headers.get('content-range')).toBe('bytes 1024-1026/373179626');
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
});

it('keeps non-range streaming responses unbuffered', async () => {
  const original = new Response('whole file', { status: 200 });
  vi.stubGlobal('fetch', async () => original);
  const response = await read('https://tramme.test/video.mp4', { headers: { range: 'bytes=0-' } });
  expect(response).toBe(original);
  expect(response.bodyUsed).toBe(false);
});

it('falls back to the original request when the server hides the total range size', async () => {
  const ranges: string[] = [];
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    ranges.push(new Headers(init.headers).get('range')!);
    return ranges.length === 1 ? new Response('part', { status: 206 }) : new Response('whole file', { status: 200 });
  });
  const response = await read('https://tramme.test/video.mp4', { headers: { range: 'bytes=0-' } });
  expect(ranges).toEqual(['bytes=0-262143', 'bytes=0-']);
  expect(await response.text()).toBe('whole file');
});
