// Render jobs shared by the command line and the editor's export.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'puppeteer-core';
import type { TrammeDoc } from '@tramme/core';
import type { FrameParts } from '@tramme/render/src/timing.ts';
import { openDoc, type DocInfo } from './browser.ts';
import { encoder, frameKind, joinSegments, type VideoFormat } from './media.ts';
import type { Server } from './server.ts';

export interface VideoJob {
  /** URL path of the document on the server: /project/film.tramme.json */
  docUrl: string;
  doc: TrammeDoc;
  compId?: string;
  format?: VideoFormat;
  samples?: number;
  from?: number;
  to?: number;
  crf?: number;
  mute?: boolean;
  /** target file (a folder for png) */
  out: string;
  /** pages of the same Chrome rendering segments at once (1: one after the other); defaultPages() is a fair choice */
  pages?: number;
  /** bits a channel: 10 reads the half-float frame at 16 bits and encodes at 10 (media.ts) */
  depth?: 8 | 10;
}

/**
 * How many pages may render at once on this machine: half its cores (each
 * page's rendering is one thread, its encoder another), as many as its free
 * memory holds (a page opens its own video decoders and frame buffers), at
 * most 6. The GPU is shared by them all; a machine whose GPU is the limit
 * gains less, and --pages says otherwise.
 */
export function defaultPages(width: number, height: number, cores = os.availableParallelism?.() ?? os.cpus().length, free = os.freemem()): number {
  const perPage = 350e6 + width * height * 4 * 24;
  return Math.max(1, Math.min(6, Math.floor(cores / 2), Math.floor((free * 0.6) / perPage)));
}

/** the frames [f0, f1) cut into n segments of nearly the same length */
export function segmentsOf(f0: number, f1: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = f0 + Math.round(((f1 - f0) * i) / n), b = f0 + Math.round(((f1 - f0) * (i + 1)) / n);
    if (b > a) out.push([a, b]);
  }
  return out;
}

/**
 * The sound over [from, to] mixed by the page (the mixer of the editor's
 * preview and exports), written to `out` as a WAV; false when there is none.
 */
async function mixTo(page: Page, from: number, to: number, out: string): Promise<boolean> {
  const b64: string | null = await page.evaluate((a) => (window as any).TRAMME.mix(a.from, a.to), { from, to });
  if (!b64) return false;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  return true;
}

export async function renderVideo(server: Server, page: Page, job: VideoJob, onProgress?: (done: number, total: number) => void) {
  const format = job.format ?? 'mp4';
  const info: DocInfo = await openDoc(page, server.port, job.docUrl, job.compId);
  const f0 = Math.round((job.from ?? 0) * info.fps);
  const f1 = job.to !== undefined ? Math.min(info.frames, Math.round(job.to * info.fps)) : info.frames;
  const mix = path.join(os.tmpdir(), `tramme-mix-${process.pid}-${Date.now()}.wav`);
  const audio = !job.mute && (format === 'mp4' || format === 'mov' || format === 'webm') && await mixTo(page, f0 / info.fps, f1 / info.fps, mix) ? mix : undefined;
  // a parallel export: segments of at least a second each, a GIF's palette is made over the whole film
  const n = format === 'gif' ? 1 : Math.min(job.pages ?? 1, Math.floor((f1 - f0) / Math.max(1, info.fps)));
  if (n > 1) {
    try { return await renderSegments(server, page, job, info, format, f0, f1, n, audio, onProgress); }
    finally { if (audio) fs.rmSync(mix, { force: true }); }
  }
  const enc = encoder({ format, W: info.width, H: info.height, fps: info.fps, frames: f1 - f0, out: job.out, audio, crf: job.crf, depth: job.depth });
  server.sink = enc.write;
  if (onProgress) await page.exposeFunction('__trammeProgress', onProgress).catch(() => {});
  const t0 = Date.now();
  try {
    const { ms, parts }: { ms: number; parts: FrameParts } = await page.evaluate((a) => (window as any).TRAMME.capture(a.f0, a.f1, a.opts, a.kind), { f0, f1, opts: { samples: job.samples }, kind: frameKind(format, job.depth) });
    await enc.end();
    return { info, frames: f1 - f0, audio: !!audio, msPerFrame: ms, parts, seconds: (Date.now() - t0) / 1000 };
  } finally {
    server.sink = null;
    if (audio) fs.rmSync(mix, { force: true });
  }
}

/**
 * The film cut into n segments, each rendered by a page of the same Chrome
 * and encoded on its own, at once, then joined without encoding them again.
 * The sound was mixed once over the whole film. A simulation started in the
 * middle steps from its start (the renderer's checkpoints), so each frame is
 * the one a single page would draw.
 */
async function renderSegments(server: Server, first: Page, job: VideoJob, info: DocInfo, format: VideoFormat, f0: number, f1: number, n: number, audio: string | undefined, onProgress?: (done: number, total: number) => void) {
  const spans = segmentsOf(f0, f1, n);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-segments-'));
  const browser = first.browser();
  const pages = [first, ...await Promise.all(spans.slice(1).map(() => browser.newPage()))];
  for (const p of pages.slice(1)) {
    p.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
    p.on('pageerror', (e) => console.error('[page error]', (e as Error).message));
  }
  const done = spans.map(() => 0);
  const t0 = Date.now();
  try {
    await Promise.all(pages.slice(1).map((p) => openDoc(p, server.port, job.docUrl, job.compId)));
    const results = await Promise.all(spans.map(async ([a, b], i) => {
      const p = pages[i], name = `segment-${process.pid}-${i}`;
      const out = format === 'png' ? job.out : path.join(tmp, `${String(i).padStart(3, '0')}.${format}`);
      const enc = encoder({ format, W: info.width, H: info.height, fps: info.fps, frames: b - a, out, crf: job.crf, startNumber: a - f0, depth: job.depth });
      server.sinks.set(name, enc.write);
      if (onProgress) await p.exposeFunction('__trammeProgress', (d: number) => { done[i] = d; onProgress(done.reduce((x, y) => x + y, 0), f1 - f0); }).catch(() => {});
      try {
        const r: { ms: number; parts: FrameParts } = await p.evaluate((x) => (window as any).TRAMME.capture(x.a, x.b, x.opts, x.kind, x.name), { a, b, opts: { samples: job.samples }, kind: frameKind(format, job.depth), name });
        await enc.end();
        return { ...r, frames: b - a, out };
      } finally { server.sinks.delete(name); }
    }));
    if (format !== 'png') await joinSegments(format, results.map((r) => r.out), job.out, (f1 - f0) / info.fps, audio);
    // per frame over the whole film: each segment's figures weighed by its frames
    const total = f1 - f0, parts = {} as FrameParts;
    for (const r of results) for (const [k, v] of Object.entries(r.parts)) (parts as unknown as Record<string, number>)[k] = ((parts as unknown as Record<string, number>)[k] ?? 0) + (v * r.frames) / total;
    const seconds = (Date.now() - t0) / 1000;
    return { info, frames: total, audio: !!audio, msPerFrame: (seconds * 1000) / total, parts, seconds, pages: spans.length };
  } finally {
    await Promise.all(pages.slice(1).map((p) => p.close().catch(() => {})));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** the composition's sound alone, as a WAV */
export async function renderAudio(server: Server, page: Page, docUrl: string, compId: string | undefined, out: string) {
  const info = await openDoc(page, server.port, docUrl, compId);
  if (!(await mixTo(page, 0, info.duration, out))) throw new Error('no sound layer in this composition');
  return { file: path.resolve(out) };
}
