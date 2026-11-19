// Video assets: frames decoded on demand with WebCodecs (Mediabunny), from
// the file served with range requests, so a long video is never loaded whole.
// Playback reads forward from decoders kept open, one per play position in
// use (video-pool.ts); a jump elsewhere starts a new read there. The last few
// frames of each stay at hand (motion blur sub-frames, small steps back), as
// the decoder gave them: a VideoFrame, drawn as it is. Copying each into a
// canvas of the file's size cost a 4K take a third of its frame rate where
// two shots of it overlapped; each frame is closed once no reader keeps it.

import { ALL_FORMATS, BlobSource, CanvasSink, Input, UrlSource, VideoSampleSink, type InputVideoTrack } from 'mediabunny';
import type { VideoAsset } from '@tramme/core';
import { KEEP, ReaderPool, type PoolFrame } from './video-pool.ts';
import { previewVideoBlob, RANGE_PIECE } from './video-cache.ts';

/** Finish range responses of bounded size so paused decoders do not hold HTTP connections. */
export const fetchVideoRange: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const range = /^bytes=(\d+)-$/.exec(headers.get('range') ?? '');
  if (!range) return fetch(input, init);
  const start = Number(range[1]);
  headers.set('range', `bytes=${start}-${start + RANGE_PIECE - 1}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status !== 206) return response;
  // Without the total size a shortened response could look like the whole
  // file to UrlSource (for example, when CORS hides Content-Range).
  if (!/^bytes \d+-\d+\/\d+$/.test(response.headers.get('content-range') ?? '')) {
    await response.body?.cancel();
    return fetch(input, init);
  }
  const copy = new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers: response.headers });
  Object.defineProperties(copy, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } });
  return copy;
};

export function assertVideoDimensions(width: number, height: number, maxPixels: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > maxPixels) {
    throw new Error('video exceeds 8192 pixels per side or 16 million pixels total');
  }
}

export class VideoFrames implements VideoAsset {
  width = 0;
  height = 0;
  duration = 0;
  hasAudio = false;
  private input: Input;
  private pool!: ReaderPool<PoolFrame<CanvasImageSource>>;
  private busy: Promise<void> = Promise.resolve();
  /** times asked for and not found (past the end, a gap): not asked again */
  private missed = new Set<number>();

  private constructor(url: string, blob: Blob | null = null) {
    this.input = new Input({ source: blob ? new BlobSource(blob) : new UrlSource(url, { fetchFn: fetchVideoRange }), formats: ALL_FORMATS });
  }

  static async open(url: string, options: { cache?: boolean; maxPixels?: number } = {}): Promise<VideoFrames> {
    const v = new VideoFrames(url, options.cache ? await previewVideoBlob(url) : null);
    try {
      const track = await v.input.getPrimaryVideoTrack();
      if (!track) throw new Error('no video track');
      if (options.maxPixels) assertVideoDimensions(track.displayWidth, track.displayHeight, options.maxPixels);
      if (!(await track.canDecode())) throw new Error(`video codec not supported by this browser (${track.codec ?? 'unknown'})`);
      v.width = track.displayWidth;
      v.height = track.displayHeight;
      v.duration = await v.input.computeDuration();
      v.hasAudio = !!(await v.input.getPrimaryAudioTrack());
      v.pool = new ReaderPool(() => readerOf(track), undefined, (f) => { if (typeof VideoFrame !== 'undefined' && f.picture instanceof VideoFrame) f.picture.close(); });
      return v;
    } catch (error) { v.input.dispose(); throw error; }
  }

  /** decoders opened so far (a read starting somewhere: a seek) */
  get seeks() { return this.pool.opened; }

  frameAt(t: number): { image: CanvasImageSource | null; exact: boolean } {
    const time = Math.min(Math.max(0, t), Math.max(0, this.duration - 1e-3));
    const hit = this.pool.find(time);
    if (hit) return { image: hit.picture, exact: true };
    const missed = this.missed.has(Math.round(time * 1000));
    // the nearest frame decoded, while the right one comes
    const near = this.pool.nearest(time);
    return { image: near?.picture ?? null, exact: missed };
  }

  /** decodes the frame shown at t (one request at a time, in order) */
  request(t: number): Promise<void> {
    const time = Math.min(Math.max(0, t), Math.max(0, this.duration - 1e-3));
    this.busy = this.busy.then(() => this.decode(time)).catch((e) => { console.warn('[tramme] video:', (e as Error).message); });
    return this.busy;
  }

  private async decode(t: number) {
    await this.pool.read(t);
    if (!this.pool.find(t)) {
      if (this.missed.size > 200) this.missed.clear();
      this.missed.add(Math.round(t * 1000));
    }
  }

  dispose() {
    this.pool.dispose();
    this.input.dispose();
  }
}

/**
 * A reader's decoder: a sink of its own, yielding the decoder's frames from t,
 * each with its span in the file. A file turned by its metadata (a phone held
 * upright) is drawn turned into a canvas, its canvases a ring larger than the
 * frames kept, so a kept canvas is never reused under us.
 */
function readerOf(track: InputVideoTrack): (t: number) => AsyncGenerator<PoolFrame<CanvasImageSource>, void, unknown> {
  if (track.rotation) {
    const turned = new CanvasSink(track, { poolSize: KEEP + 3 });
    return async function* (t) {
      for await (const c of turned.canvases(t)) yield { timestamp: c.timestamp, duration: c.duration, picture: c.canvas as CanvasImageSource };
    };
  }
  const sink = new VideoSampleSink(track);
  return async function* (t) {
    for await (const sample of sink.samples(t)) {
      const picture = sample.toVideoFrame();
      const frame = { timestamp: sample.timestamp, duration: sample.duration, picture };
      sample.close();
      yield frame;
    }
  };
}

/** what a video file holds, read from its header (a new project takes its size, cadence and length) */
export async function probeVideo(file: Blob): Promise<{ width: number; height: number; duration: number; fps: number; hasAudio: boolean; decodable: boolean; codec: string | null }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track in this file');
    const stats = await track.computePacketStats(120);
    return {
      width: track.displayWidth,
      height: track.displayHeight,
      duration: await input.computeDuration(),
      fps: stats.averagePacketRate,
      hasAudio: !!(await input.getPrimaryAudioTrack()),
      decodable: await track.canDecode(),
      codec: track.codec ?? null,
    };
  } finally { input.dispose(); }
}
