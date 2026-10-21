// The parallel export (docs/performance-roadmap.md, step 2): the film cut
// into segments rendered by pages of the same Chrome at once. Its frames are
// the ones a single page draws, simulations included (the load case of
// particles, cloth, a rope and a flock, started in the middle by the later
// pages); an MP4 made so has every frame and the whole sound.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCases } from '../../../bench/load/cases.ts';
import { CHROME, launch } from '../src/browser.ts';
import { defaultPages, renderVideo, segmentsOf } from '../src/jobs.ts';
import { FFMPEG } from '../src/media.ts';
import { readConfig, Server } from '../src/server.ts';

describe('segments of a parallel export', () => {
  it('cut the frames into nearly equal spans, end to end', () => {
    expect(segmentsOf(0, 10, 3)).toEqual([[0, 3], [3, 7], [7, 10]]);
    expect(segmentsOf(30, 90, 2)).toEqual([[30, 60], [60, 90]]);
    expect(segmentsOf(0, 2, 4)).toEqual([[0, 1], [1, 2]]);
  });

  it('go as wide as the machine allows: half its cores, its free memory, six at most', () => {
    expect(defaultPages(1920, 1080, 16, 64e9)).toBe(6);
    expect(defaultPages(1920, 1080, 4, 64e9)).toBe(2);
    expect(defaultPages(3840, 2160, 16, 2e9)).toBe(1);
    expect(defaultPages(1920, 1080, 1, 64e9)).toBe(1);
  });
});

describe.skipIf(!CHROME)('a parallel export, rendered', () => {
  let dir = '', server: Server, close: () => Promise<void>, page: import('puppeteer-core').Page;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-parallel-'));
    const sim = loadCases().find((c) => c.id === 'simulation')!;
    fs.writeFileSync(path.join(dir, 'sim.tramme.json'), JSON.stringify(sim.doc));
    // a moving square and a tone
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '48000', path.join(dir, 'tone.wav')]);
    fs.writeFileSync(path.join(dir, 'tone.tramme.json'), JSON.stringify({
      schema: 'tramme/1', meta: { title: 'tone' }, tokens: {}, assets: { tone: { type: 'audio', src: 'tone.wav' } }, root: 'main',
      compositions: { main: { name: 'Main', width: 320, height: 180, fps: 30, duration: 3, background: '#000000', order: ['box', 'snd'], layers: {
        box: { type: 'shape.rect', transform: { position: { $k: [{ t: 0, v: [40, 90] }, { t: 3, v: [280, 90] }] } }, props: { size: [40, 40], fill: '#2EC4B6' } },
        snd: { type: 'audio', props: { audio: 'tone' } },
      } } },
    }));
    server = new Server(readConfig(path.join(dir, 'sim.tramme.json')));
    await server.start();
    const b = await launch();
    page = b.page;
    close = async () => { await b.browser.close(); server.close(); };
  }, 120_000);
  afterAll(async () => { await close?.(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('draws the frames a single page draws, simulations started in the middle included', async () => {
    const sim = loadCases().find((c) => c.id === 'simulation')!;
    const job = { docUrl: '/project/sim.tramme.json', doc: sim.doc, format: 'png' as const };
    await renderVideo(server, page, { ...job, out: path.join(dir, 'one') });
    // two seconds: two segments of a second (a segment is a second at least)
    const r = await renderVideo(server, page, { ...job, out: path.join(dir, 'three'), pages: 3 });
    expect('pages' in r && r.pages).toBe(2);
    const files = fs.readdirSync(path.join(dir, 'one')).sort();
    expect(files).toHaveLength(60);
    expect(fs.readdirSync(path.join(dir, 'three')).sort()).toEqual(files);
    const differ = files.filter((f) => !fs.readFileSync(path.join(dir, 'one', f)).equals(fs.readFileSync(path.join(dir, 'three', f))));
    expect(differ).toEqual([]);
  }, 300_000);

  it('joins its segments into one MP4 with every frame and the sound mixed once', async () => {
    const out = path.join(dir, 'tone.mp4');
    const r = await renderVideo(server, page, { docUrl: '/project/tone.tramme.json', doc: {} as never, out, pages: 3 });
    expect(r.audio).toBe(true);
    // ffmpeg reads it through: every frame of the video, the sound over the whole length
    const read = (map: string) => spawnSync(FFMPEG, ['-hide_banner', '-i', out, '-map', map, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    // the last progress line: a slow machine prints frame=0 first
    expect(Number([...read('0:v').matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1])).toBe(90);
    expect(/time=00:00:0(2\.9\d|3\.0\d)/.test(read('0:a'))).toBe(true);
    expect(read('0:v')).not.toMatch(/error|corrupt/i);
  }, 300_000);
});
