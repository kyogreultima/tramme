// The export in the cloud from end to end, on this machine, before a deploy:
//
//   pnpm test:cloud                     every case below
//   CLOUD_CASES=showreel pnpm test:cloud  the cases whose name contains one of the words (comma separated)
//
// Nothing is stood in for: the Worker's routes take the project (POST, PUT of
// its files), the job is queued, runJob reads the project's .tramme archive
// from storage and sends it to the real renderer (apps/renderer/server.ts),
// which unpacks it and renders it with the command line, Chrome and ffmpeg. The
// film that comes back is read from the project's renders/ and checked: its
// size, frames, duration, and its sound when the project has some. A project
// that cannot be rendered must fail with its reason (an asset, an issue), never
// a call stack.
//
// The cases are the examples (plugins, expressions, fonts, sounds, 2.5D,
// motion blur), the plugin fixture, and a film made as the assistant makes
// them: Voice, Sound and Scenes groups, a narration and effects, a font, a PNG
// and an SVG logo, footage starting after the film does, isolated by an
// expression or not. CHROME_PATH points at Chrome where it is not found.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryRecords, recordBucket } from '@tramme/api';
import worker from '../../worker/src/index.ts';
import type { Env } from '../../worker/src/http.ts';
import { rendererOf, runJob, SERVER, type Job } from '../../worker/src/renders.ts';
import { CHROME } from '../../../packages/cli/src/browser.ts';
import { FFMPEG } from '../../../packages/cli/src/media.ts';
import { verifyMedia, mediaReport } from '../../../packages/cli/src/verify-media.ts';
import { server as renderer } from '../server.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** a film of a minute takes a few minutes on a laptop: each case may take this long */
const CASE_MS = 20 * 60_000;
/** launch-film (45 s, 1000 layers, isolated by its expressions, motion blur up to 24 samples) renders in about 17 minutes on a laptop */
const LONG_MS: Record<string, number> = { 'launch-film': 45 * 60_000 };

let files: ReturnType<typeof recordBucket>, env: Env, tmp = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => renderer.listen(0, '127.0.0.1', resolve));
  const port = (renderer.address() as AddressInfo).port;
  files = recordBucket(memoryRecords());
  env = {
    FILES: files, DEV_OPEN: '1', RENDERER_URL: `http://127.0.0.1:${port}`,
    ASSETS: { fetch: async () => new Response('') },
    RENDER_QUEUE: { idFromName: () => 'q', get: () => ({ fetch: async () => new Response(null, { status: 202 }) }) },
  } as unknown as Env;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-cloud-e2e-'));
});
afterAll(() => { renderer.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

const call = (route: string, init: RequestInit = {}) => worker.fetch(new Request(`http://localhost:8787${route}`, init), env);

/** every file of a project folder (renders/ and local state left out), by its path in the project */
function folder(dir: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!['renders', 'node_modules', '.tramme'].includes(p)) walk(p); }
      else if (!['tramme.json', 'tramme.config.json', 'README.md'].includes(p)) out.set(p, new Uint8Array(fs.readFileSync(path.join(dir, p))));
    }
  };
  walk('');
  return out;
}

/** the project brought in as the editor brings one: created, then each of its files written */
async function upload(name: string, project: Map<string, Uint8Array>): Promise<string> {
  const res = await call('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
  expect(res.status, await res.clone().text()).toBe(201);
  const { id } = await res.json() as { id: string };
  for (const [p, data] of project) {
    const put = await call(`/api/projects/${id}/files/${p.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: data as Uint8Array<ArrayBuffer> });
    expect(put.status, `${p}: ${await put.clone().text()}`).toBe(200);
  }
  return id;
}

/** the export asked for as the editor asks for it, then run as the queue runs it */
async function exportInTheCloud(id: string): Promise<Job> {
  const asked = await call(`/api/projects/${id}/renders`, { method: 'POST', body: '{}' });
  expect(asked.status).toBe(202);
  const job = await asked.json() as Job;
  const done = await runJob(files, SERVER, job.id, rendererOf(env), 1000);
  expect(done).not.toBeNull();
  // the job's record as the editor reads it
  return await (await call(`/api/renders/${job.id}`)).json() as Job;
}

/** the film of a job, written out to be checked */
async function filmOf(id: string, job: Job): Promise<string> {
  const res = await call(`/api/projects/${id}/files/${job.file}`);
  expect(res.status).toBe(200);
  const out = path.join(tmp, `${id}.mp4`);
  fs.writeFileSync(out, new Uint8Array(await res.arrayBuffer()));
  return out;
}

const hasSound = (film: string) => /Stream #\d+:\d+.*Audio:/.test(spawnSync(FFMPEG, ['-hide_banner', '-i', film], { encoding: 'utf8' }).stderr);

/** a project rendered in the cloud: done, its film the size, length and frames of its document, its sound there when it has some */
async function rendersWell(name: string, project: Map<string, Uint8Array>) {
  const doc = JSON.parse(new TextDecoder().decode(project.get('document.tramme.json')));
  const comp = doc.compositions[doc.root];
  const id = await upload(name, project);
  const job = await exportInTheCloud(id);
  expect(job.error ?? '', `${name}: the export failed`).toBe('');
  expect(job.status).toBe('done');
  const film = await filmOf(id, job);
  const check = await verifyMedia(film, { width: comp.width, height: comp.height, fps: comp.fps, frames: Math.round(comp.duration * comp.fps), duration: comp.duration });
  expect(check.ok, mediaReport(check)).toBe(true);
  const sounds = Object.values(comp.layers as Record<string, { type: string }>).some((l) => l.type === 'audio') || Object.values(doc.assets as Record<string, { type: string }>).some((a) => a.type === 'audio');
  if (sounds) expect(hasSound(film), `${name}: the film has no sound`).toBe(true);
}

// ── a film as the assistant makes one ──

/** a tone of `seconds` as a 16-bit mono WAV (a narration, an effect: what matters is that it plays) */
function wav(seconds: number, hz: number, rate = 24_000): Uint8Array {
  const n = Math.round(seconds * rate), out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 2, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) out.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 8000 * Math.min(1, i / 600, (n - i) / 600)), 44 + i * 2);
  return new Uint8Array(out);
}

/** footage: a test pattern of `seconds`, H.264 */
function footage(seconds: number): Uint8Array {
  const out = path.join(tmp, `footage-${seconds}.mp4`);
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  if (r.status !== 0) throw new Error(`footage: ${r.stderr}`);
  return new Uint8Array(fs.readFileSync(out));
}

function assistantFilm({ isolated }: { isolated: boolean }): Map<string, Uint8Array> {
  const read = (p: string) => new Uint8Array(fs.readFileSync(path.join(ROOT, p)));
  const W = 1280, H = 720, duration = 4;
  const doc = {
    schema: 'tramme/1', meta: { title: 'Every day, ideas are born' }, tokens: {}, root: 'main',
    assets: {
      inter: { type: 'font', src: 'assets/fonts/Inter.ttf', family: 'Inter', weight: '100 900' },
      logo: { type: 'image', src: 'assets/logo-on-dark.svg' },
      mark: { type: 'image', src: 'assets/mark-teal.png' },
      clip: { type: 'video', src: 'assets/footage/clip.mp4' },
      narration: { type: 'audio', src: 'assets/voice/narration.wav', name: 'Narration' },
      whoosh: { type: 'audio', src: 'assets/sounds/whoosh.wav', name: 'Whoosh' },
      music: { type: 'audio', src: 'assets/sounds/music.wav', name: 'Music' },
    },
    compositions: {
      main: {
        name: 'Film', width: W, height: H, fps: 30, duration, background: '#0B0F14', motionBlur: { samples: 4, shutter: 0.5 },
        order: ['voice', 'sound', 'scenes'],
        layers: {
          voice: { type: 'group', name: 'Voice', children: ['narration'] },
          narration: { type: 'audio', name: 'Narration', in: 0.3, out: 3.3, props: { audio: 'narration', role: 'voice' } },
          sound: { type: 'group', name: 'Sound', children: ['music', 'whoosh'] },
          music: { type: 'audio', name: 'Music', in: 0, out: duration, props: { audio: 'music', gain: -12, fadeIn: 0.5 } },
          whoosh: { type: 'audio', name: 'Whoosh', in: 1.9, out: 2.6, props: { audio: 'whoosh' } },
          scenes: { type: 'group', name: 'Scenes', children: ['footage', 'title', 'logo', 'mark'] },
          // the footage starts after the film does: the frame it shows is its own time, not the film's
          footage: { type: 'video', name: 'Footage', in: 1, out: duration, transform: { position: [W / 2, H / 2] }, props: { video: 'clip', start: 0.5, size: [W, H], fit: 'cover' } },
          title: {
            type: 'text', name: 'Title', transform: { position: [W / 2, H / 2], opacity: { $k: [{ t: 0, v: 0 }, { t: 0.6, v: 1 }] } },
            props: { align: 'center', baseline: 'middle', text: isolated ? { $expr: "'Every day, ideas are born'.slice(0, Math.max(1, Math.floor(t * 20)))" } : 'Every day, ideas are born', font: 'inter', size: 64, weight: 600, color: '#FFFFFF' },
          },
          logo: { type: 'image', name: 'Logo', transform: { position: [W - 160, 60] }, props: { image: 'logo', size: [220, 60], fit: 'contain' } },
          mark: { type: 'image', name: 'Mark', in: 2, transform: { position: [120, H - 100], rotation: { $k: [{ t: 2, v: -20 }, { t: 3, v: 0 }] } }, props: { image: 'mark', size: [120, 120], fit: 'contain' } },
        },
      },
    },
  };
  return new Map<string, Uint8Array>([
    ['document.tramme.json', new TextEncoder().encode(JSON.stringify(doc, null, 2))],
    ['assets/fonts/Inter.ttf', read('examples/launch-film/assets/fonts/Inter.ttf')],
    ['assets/logo-on-dark.svg', read('brand/svg/logo-on-dark.svg')],
    ['assets/mark-teal.png', read('brand/png/mark-teal.png')],
    ['assets/footage/clip.mp4', footage(4)],
    ['assets/voice/narration.wav', wav(3, 220)],
    ['assets/sounds/whoosh.wav', wav(0.7, 880)],
    ['assets/sounds/music.wav', wav(duration, 110)],
  ]);
}

const wanted = (process.env.CLOUD_CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const run = (name: string) => (!wanted.length || wanted.some((w) => name.includes(w)) ? it : it.skip);

describe.skipIf(!CHROME)('the export in the cloud, from end to end', () => {
  run('assistant film')('a film made as the assistant makes one: voice, sounds, font, PNG and SVG, footage', () => rendersWell('assistant film', assistantFilm({ isolated: false })), CASE_MS);
  run('assistant film isolated')('the same film isolated by an expression: drawn in the sandbox, its footage at the layer\'s own time', () => rendersWell('assistant film isolated', assistantFilm({ isolated: true })), CASE_MS);
  run('night-sky')('a project plugin (night-sky)', () => rendersWell('night sky', folder(path.join(ROOT, 'packages/cli/test/fixtures/night-sky'))), CASE_MS);
  for (const example of ['showreel', 'anime', 'launch-film']) {
    run(example)(`the example ${example}`, () => rendersWell(example, folder(path.join(ROOT, 'examples', example))), LONG_MS[example] ?? CASE_MS);
  }

  run('failure')('a project that cannot be rendered fails with its reason, never a call stack', async () => {
    const project = assistantFilm({ isolated: false });
    project.delete('assets/voice/narration.wav');
    const job = await exportInTheCloud(await upload('broken', project));
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/narration/);
    expect(job.error).not.toMatch(/page\.js|127\.0\.0\.1|\bat\s+\S+\s+\(/);
  }, CASE_MS);
});
