// Long jobs on a video (docs/editing-roadmap.md, "Long jobs are honest"):
// the file worked through in chunks of a few seconds, each encoded on its
// own and saved in the project as soon as it is done, so a job stopped (a
// cancel, a closed tab) resumes from the chunks it finished; the time left
// is estimated from the chunks done, and said with the progress; the chunks
// are joined at the end without encoding them again.

import { ALL_FORMATS, BufferTarget, CanvasSink, CanvasSource, EncodedPacketSink, EncodedVideoPacketSource, getFirstEncodableVideoCodec, Input, Mp4OutputFormat, Output, Quality, UrlSource, type VideoCodec } from 'mediabunny';
import type { ToolContext } from '@tramme/core';
import { AVC_FROM_STREAM } from './avc.ts';
import { canvas } from './perception.ts';
import { t } from './i18n/index.ts';

/** a job's name for a file: the work and the file's identity (its content's hash when known, else where it lives), so a job resumes only on the same file */
export function jobId(work: string, asset: { src: string; hash?: string }): string {
  const key = asset.hash ?? asset.src;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return `${work}-${(h >>> 0).toString(36)}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

/** a frame read from the source, its pixels kept (the decoder reuses its canvases) */
export interface Frame { picture: HTMLCanvasElement; timestamp: number; duration: number }
/** a frame written: a picture of the output's size, and when it shows */
export interface Out { picture: CanvasImageSource; timestamp: number; duration: number }

export interface VideoJob {
  /** names the job's folder: the same id resumes it */
  id: string;
  /** the source video */
  url: string;
  /** the output's size from the source's */
  size(w: number, h: number): [number, number];
  /** the pictures one frame gives, with the next one when there is one (interpolation reads both) */
  frames(cur: Frame, next: Frame | null): AsyncIterable<Out> | Iterable<Out>;
  /** what the progress says it does */
  step: string;
  /** seconds a chunk (2 by default) */
  chunk?: number;
}

interface Manifest { version: 1; id: string; codec: VideoCodec; width: number; height: number; duration: number; chunk: number; done: { i: number; path: string }[] }

const minutes = (s: number) => (s < 90 ? t('longjob.seconds', { n: Math.max(1, Math.round(s)) }) : t('longjob.minutes', { n: Math.round(s / 60) }));

/** a copy of a decoded frame (the sink's canvases are reused) */
function keep(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = canvas(w, h);
  c.g.drawImage(src, 0, 0, w, h);
  return c.c;
}

/** the job run, or resumed: the whole file through `frames`, as one video Blob */
export async function runVideoJob(ctx: ToolContext, job: VideoJob): Promise<{ blob: Blob; resumed: number; chunks: number }> {
  if (typeof VideoEncoder === 'undefined') throw new Error('this browser cannot encode video (WebCodecs)');
  const dir = `assets/jobs/${job.id}`, manifestPath = `${dir}/job.json`;
  const input = new Input({ source: new UrlSource(job.url), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('this file has no picture');
    if (!(await track.canDecode())) throw new Error(`video codec not supported by this browser (${track.codec ?? 'unknown'})`);
    const duration = await input.computeDuration(), iw = track.displayWidth, ih = track.displayHeight;
    const [W, H] = job.size(iw, ih);
    // what was finished before, if the job is the same
    let m: Manifest | null = null;
    try { m = JSON.parse((await ctx.readText(manifestPath)) ?? 'null'); } catch { m = null; }
    if (!m || m.width !== W || m.height !== H || Math.abs(m.duration - duration) > 1e-3) {
      // in-band parameters (VP9, or H.264 carrying them in its stream): the chunks join as they are
      const codec = await getFirstEncodableVideoCodec(['vp9', 'avc', 'av1'], { width: W, height: H });
      if (!codec) throw new Error(`no video codec can encode ${W}×${H} in this browser`);
      m = { version: 1, id: job.id, codec, width: W, height: H, duration, chunk: job.chunk ?? 2, done: [] };
    }
    const n = Math.max(1, Math.ceil(duration / m.chunk)), resumed = m.done.length;
    const sink = new CanvasSink(track, { width: iw, height: ih, fit: 'fill', poolSize: 3 });
    const out = canvas(W, H);
    let spent = 0, made = 0;
    for (let i = 0; i < n; i++) {
      if (m.done.some((d) => d.i === i)) continue;
      if (ctx.signal.aborted) throw new Error('stopped');
      const t0 = performance.now(), from = i * m.chunk, to = Math.min(duration, from + m.chunk);
      const target = new BufferTarget();
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
      const video = new CanvasSource(out.c, { codec: m.codec, quality: new Quality('very-high'), keyFrameInterval: 1, ...(m.codec === 'avc' ? AVC_FROM_STREAM : {}) });
      output.addVideoTrack(video);
      await output.start();
      try {
        // the chunk's frames, and the first of the next one (a frame's neighbour)
        let prev: Frame | null = null;
        const write = async (cur: Frame, next: Frame | null) => {
          for await (const o of job.frames(cur, next)) {
            out.g.clearRect(0, 0, W, H);
            out.g.drawImage(o.picture, 0, 0, W, H);
            // timed from the chunk's start: each chunk starts at 0, the join puts it back in place
            await video.add(Math.max(0, o.timestamp - from), o.duration);
          }
        };
        for await (const f of sink.canvases(from, Math.min(duration, to + 0.5))) {
          if (ctx.signal.aborted) throw new Error('stopped');
          const cur: Frame = { picture: keep(f.canvas as CanvasImageSource, iw, ih), timestamp: f.timestamp, duration: f.duration };
          if (prev) await write(prev, cur);
          prev = cur.timestamp < to - 1e-6 ? cur : null;
          if (!prev) break;
          ctx.progress?.(i + (cur.timestamp - from) / m.chunk, n, made ? `${job.step} · ${t('longjob.left', { time: minutes((spent / made) * (n - i - (cur.timestamp - from) / m.chunk)) })}` : job.step);
        }
        if (prev) await write(prev, null);
        await output.finalize();
      } catch (e) {
        await output.cancel();
        throw e;
      }
      const path = await ctx.writeFile(`${dir}/${String(i).padStart(4, '0')}.mp4`, new Blob([target.buffer!], { type: 'video/mp4' }));
      m.done.push({ i, path });
      await ctx.writeFile(manifestPath, JSON.stringify(m));
      spent += performance.now() - t0;
      made++;
    }
    // the chunks joined, each moved back to its place, without encoding them again
    ctx.progress?.(n, n, t('longjob.joining'));
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const source = new EncodedVideoPacketSource(m.codec);
    output.addVideoTrack(source);
    await output.start();
    let first = true;
    for (const d of [...m.done].sort((a, b) => a.i - b.i)) {
      const part = new Input({ source: new UrlSource(ctx.fileUrl(d.path)), formats: ALL_FORMATS });
      try {
        const vt = await part.getPrimaryVideoTrack();
        if (!vt) continue;
        const config = await vt.getDecoderConfig();
        for await (const p of new EncodedPacketSink(vt).packets()) {
          await source.add(p.clone({ timestamp: p.timestamp + d.i * m.chunk }), first && config ? { decoderConfig: config } : undefined);
          first = false;
        }
      } finally { part.dispose(); }
    }
    await output.finalize();
    return { blob: new Blob([target.buffer!], { type: 'video/mp4' }), resumed, chunks: n };
  } finally {
    input.dispose();
  }
}

/** an ImageData's pixels as the core's RGBA */
export const rgbaOf = (c: HTMLCanvasElement) => { const g = c.getContext('2d', { willReadFrequently: true })!; const d = g.getImageData(0, 0, c.width, c.height); return { width: d.width, height: d.height, data: d.data }; };

/** core pixels drawn on a new canvas */
export function canvasOf(p: { width: number; height: number; data: Uint8ClampedArray }): HTMLCanvasElement {
  const c = canvas(p.width, p.height);
  c.g.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
  return c.c;
}
