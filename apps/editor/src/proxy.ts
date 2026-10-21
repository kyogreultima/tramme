// Proxies (docs/editing-roadmap.md, step 8): a lighter copy of a video,
// encoded here (WebCodecs) at a smaller size, kept as an asset the source
// names (`proxy`); the preview plays it when this computer's setting asks,
// the exports and the command line always read the original. Offered on
// import when the machine decodes the file too slowly to play it (measured).

import { ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, CanvasSource, getFirstEncodableVideoCodec, Input, Mp4OutputFormat, Output, Quality, UrlSource } from 'mediabunny';
import { pointer, type ToolType } from '@tramme/core';
import { AVC_FROM_STREAM } from './avc.ts';
import { canvas } from './perception.ts';
import { t } from './i18n/index.ts';

/** the proxy's height by default: 540 lines play anywhere */
export const PROXY_HEIGHT = 540;

/** the size of a proxy: the picture's proportions, at most `height` lines, even sides (what encoders take); null when the file is already that small */
export function proxySize(w: number, h: number, height = PROXY_HEIGHT): [number, number] | null {
  if (h <= height * 1.1) return null;
  const k = height / h;
  return [Math.max(2, Math.round((w * k) / 2) * 2), Math.max(2, Math.round((h * k) / 2) * 2)];
}

/** a video re-encoded at a proxy's size, frame for frame (its sound stays in the original) */
export async function encodeProxy(url: string, height: number, signal: AbortSignal, progress?: (done: number, total: number) => void): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (typeof VideoEncoder === 'undefined') throw new Error('this browser cannot encode video (WebCodecs)');
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('this file has no picture');
    const size = proxySize(track.displayWidth, track.displayHeight, height);
    if (!size) return null;
    const [W, H] = size, duration = await input.computeDuration();
    const out = canvas(W, H), sink = new CanvasSink(track, { width: W, height: H, fit: 'fill', poolSize: 2 });
    const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: W, height: H });
    if (!codec) throw new Error(`no video codec can encode ${W}×${H} in this browser`);
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    // a keyframe every half second: a proxy is for scrubbing
    const video = new CanvasSource(out.c, { codec, quality: new Quality('medium'), keyFrameInterval: 0.5, ...(codec === 'avc' ? AVC_FROM_STREAM : {}) });
    output.addVideoTrack(video);
    await output.start();
    try {
      for await (const f of sink.canvases()) {
        if (signal.aborted) throw new Error('stopped');
        out.g.drawImage(f.canvas as CanvasImageSource, 0, 0);
        await video.add(f.timestamp, f.duration);
        progress?.(f.timestamp + f.duration, duration);
      }
      await output.finalize();
    } catch (e) {
      await output.cancel();
      throw e;
    }
    return { blob: new Blob([target.buffer!], { type: 'video/mp4' }), width: W, height: H };
  } finally {
    input.dispose();
  }
}

/**
 * How fast this machine decodes a file, in frames a second, from a second of
 * it at its own size: a file that decodes slower than it plays stutters, and
 * a proxy is worth offering.
 */
export async function decodeRate(file: Blob, seconds = 1): Promise<{ fps: number; decoded: number; width: number; height: number; fileFps: number } | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const stats = await track.computePacketStats(60), sink = new CanvasSink(track, { poolSize: 2 });
    const t0 = performance.now();
    let n = 0;
    for await (const f of sink.canvases(0, seconds)) { void f; n++; }
    const ms = performance.now() - t0;
    return { fps: n / Math.max(0.001, ms / 1000), decoded: n, width: track.displayWidth, height: track.displayHeight, fileFps: stats.averagePacketRate || 30 };
  } finally { input.dispose(); }
}

/** whether a file plays poorly here: it decodes slower than 1.2 times its own frame rate */
export const playsPoorly = (decodeFps: number, fileFps: number) => decodeFps < fileFps * 1.2;

interface ProxyArgs { video?: string; height?: number }

const proxy: ToolType<ProxyArgs> = {
  name: 'proxy', title: 'Make a proxy', description: 'a lighter copy of a video (540 lines by default) that the preview plays instead, so a 4K or a high frame rate file plays smoothly while editing; the exports keep the original',
  input: {
    type: 'object',
    properties: {
      video: { type: 'string', format: 'asset', assetType: 'video', title: 'Video', description: 'the video file (the one of the selected layer by default)' },
      height: { type: 'number', minimum: 144, maximum: 1080, default: PROXY_HEIGHT, title: 'Height (lines)' },
    },
  },
  ai: { when: 'the user says the preview stutters on a large video (4K, high frame rate, a phone HEVC), or an import offered one', avoid: 'making one for a file already small (it says so)' },
  async run(a, ctx) {
    const c = ctx.doc.compositions[ctx.compId];
    const fromLayer = ctx.selection.map((id) => c.layers[id]).find((l) => l?.type === 'video')?.props?.video;
    const asset = a.video ?? (typeof fromLayer === 'string' ? fromLayer : Object.entries(ctx.doc.assets).find(([, x]) => x.type === 'video' && !x.proxy)?.[0]);
    if (!asset || ctx.doc.assets[asset]?.type !== 'video') throw new Error('proxy: which video file? Select its layer or name it');
    const made = await encodeProxy(ctx.assetUrl(asset), a.height ?? PROXY_HEIGHT, ctx.signal, (done, total) => ctx.progress?.(done, total, t('proxy.encoding')));
    if (!made) return `${asset} is already small: no proxy needed`;
    const id = `proxy-${asset}`.slice(0, 64), path = await ctx.writeFile(`assets/proxy/${asset}.mp4`, made.blob);
    const had = !!ctx.doc.assets[id];
    return {
      text: `proxy of ${asset}: ${made.width}×${made.height}, ${(made.blob.size / 1e6).toFixed(1)} MB; the preview plays it (Settings, Preview), the exports keep the original`,
      ops: [
        { op: had ? 'replace' : 'add', path: pointer('assets', id), value: { type: 'video', src: path, name: `Proxy · ${ctx.doc.assets[asset].name ?? asset}` } },
        { op: 'add', path: pointer('assets', asset, 'proxy'), value: id },
      ],
      reload: had ? [id, asset] : [asset],
    };
  },
};

export const PROXY_TOOLS: ToolType[] = [proxy];
