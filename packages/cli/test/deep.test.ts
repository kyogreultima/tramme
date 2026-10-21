// 10-bit exports (docs/editing-roadmap.md, step 14): the frames read from the
// compositor's half-float frame at 16 bits, not rounded to 8, then encoded at
// 10 bits. The vignette of the finish (a falloff computed in float) keeps
// its in-between levels in a 16-bit PNG; the MP4 is H.265 Main 10.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROME, launch } from '../src/browser.ts';
import { renderVideo } from '../src/jobs.ts';
import { FFMPEG } from '../src/media.ts';
import { readConfig, Server } from '../src/server.ts';

const doc = {
  schema: 'tramme/1', meta: { title: 'deep' }, tokens: {}, assets: {}, root: 'main',
  compositions: { main: { name: 'Main', width: 512, height: 64, fps: 30, duration: 0.2, background: '#404040', motionBlur: { samples: 1, shutter: 0 },
    effects: [{ id: 'v', type: 'look.vignette', props: { amount: 0.6 } }], order: [], layers: {} } },
};

describe.skipIf(!CHROME)('a 10-bit export', () => {
  let dir = '', server: Server, close: () => Promise<void>, page: import('puppeteer-core').Page;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-deep-'));
    fs.writeFileSync(path.join(dir, 'deep.tramme.json'), JSON.stringify(doc));
    server = new Server(readConfig(path.join(dir, 'deep.tramme.json')));
    await server.start();
    const b = await launch();
    page = b.page;
    close = async () => { await b.browser.close(); server.close(); };
  }, 120_000);
  // closing Chrome takes longer than the default hook's 10 s on a loaded machine
  afterAll(async () => { await close?.(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); }, 60_000);

  it('keeps the levels the half-float frame has, where 8 bits round them away', async () => {
    const out = path.join(dir, 'png10');
    await renderVideo(server, page, { docUrl: '/project/deep.tramme.json', doc: doc as never, format: 'png', depth: 10, out, to: 0.04 });
    const p = PNG.sync.read(fs.readFileSync(path.join(out, '00000.png')), { skipRescale: true });
    expect(p.depth).toBe(16);
    const row = Array.from({ length: p.width }, (_, x) => (p.data as unknown as ArrayLike<number>)[(32 * p.width + x) * 4 + 1]);
    // values between the 8-bit steps (a multiple of 257 is an 8-bit level), and a falloff without steps
    expect(row.filter((v) => v % 257 !== 0).length).toBeGreaterThan(row.length * 0.8);
    expect(new Set(row).size).toBeGreaterThan(40);
    for (let x = 1; x < row.length; x++) expect(Math.abs(row[x] - row[x - 1])).toBeLessThan(257);
  }, 120_000);

  it('writes H.265 Main 10', async () => {
    const out = path.join(dir, 'deep.mp4');
    await renderVideo(server, page, { docUrl: '/project/deep.tramme.json', doc: doc as never, depth: 10, out, mute: true });
    const info = spawnSync(FFMPEG, ['-hide_banner', '-i', out], { encoding: 'utf8' }).stderr;
    expect(info).toMatch(/hevc \(Main 10\)/);
    expect(info).toMatch(/yuv420p10le/);
  }, 120_000);
});
