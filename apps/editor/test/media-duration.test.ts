import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeVideo } from '@tramme/render';

const { mediaDuration } = await import('../src/perception.ts');

// a real video of the repository, served with ranges as the Worker serves a project's files
const FILE = new URL('../../site/src/videos/assistant.mp4', import.meta.url);
const bytes = fs.readFileSync(FILE);
let server: http.Server, base = '';
const requests: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.headers.range ?? 'whole');
    if (req.url !== '/assistant.mp4') { res.writeHead(404).end(); return; }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    if (!m) { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': bytes.length, 'accept-ranges': 'bytes' }).end(bytes); return; }
    const from = Number(m[1]), to = m[2] ? Math.min(Number(m[2]), bytes.length - 1) : bytes.length - 1;
    res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': `bytes ${from}-${to}/${bytes.length}`, 'content-length': to - from + 1, 'accept-ranges': 'bytes' }).end(bytes.subarray(from, to + 1));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('the length of a media file', () => {
  it('is read from the file itself, the same as the import reads it', async () => {
    const length = await mediaDuration(`${base}/assistant.mp4`);
    expect(length).toBeGreaterThan(0);
    expect(length).toBeCloseTo((await probeVideo(new Blob([bytes]))).duration, 3);
  });

  it('is 0 for a file that is not there, without throwing', async () => {
    expect(await mediaDuration(`${base}/missing.mp4`)).toBe(0);
  });

  it('is 0 for a server that does not answer', async () => {
    expect(await mediaDuration('http://127.0.0.1:9/nothing.mp4')).toBe(0);
  });
});
