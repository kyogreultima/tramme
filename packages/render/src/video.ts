// Video assets: frames decoded on demand with WebCodecs (Mediabunny), from
// the file served with range requests, so a long video is never loaded whole.
// Playback reads forward from decoders kept open, one per play position in
// use (video-pool.ts); a jump elsewhere starts a new read there. The last few
// frames of each stay at hand (motion blur sub-frames, small steps back).

import { ALL_FORMATS, BlobSource, CanvasSink, Input, UrlSource, type InputVideoTrack, type WrappedCanvas } from 'mediabunny';
import type { VideoAsset } from '@tramme/core';
import { KEEP, ReaderPool } from './video-pool.ts';

export class VideoFrames implements VideoAsset {
  width = 0;
  height = 0;
  duration = 0;
  hasAudio = false;
  private input: Input;
  private pool!: ReaderPool<WrappedCanvas>;
  private busy: Promise<void> = Promise.resolve();
  /** times asked for and not found (past the end, a gap): not asked again */
  private missed = new Set<number>();

  private constructor(url: string) {
    this.input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  }

  static async open(url: string): Promise<VideoFrames> {
    const v = new VideoFrames(url);
    const track = await v.input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track');
    if (!(await track.canDecode())) throw new Error(`video codec not supported by this browser (${track.codec ?? 'unknown'})`);
    v.width = track.displayWidth;
    v.height = track.displayHeight;
    v.duration = await v.input.computeDuration();
    v.hasAudio = !!(await v.input.getPrimaryAudioTrack());
    v.pool = new ReaderPool(() => readerOf(track));
    return v;
  }

  /** decoders opened so far (a read starting somewhere: a seek) */
  get seeks() { return this.pool.opened; }

  frameAt(t: number): { image: CanvasImageSource | null; exact: boolean } {
    const time = Math.min(Math.max(0, t), Math.max(0, this.duration - 1e-3));
    const hit = this.pool.find(time);
    if (hit) return { image: hit.canvas as CanvasImageSource, exact: true };
    const missed = this.missed.has(Math.round(time * 1000));
    // the nearest frame decoded, while the right one comes
    const near = this.pool.nearest(time);
    return { image: (near?.canvas as CanvasImageSource) ?? null, exact: missed };
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

/** a reader's decoder: a sink of its own, its canvases a ring larger than the frames it keeps, so a kept canvas is never reused under us */
function readerOf(track: InputVideoTrack) {
  const sink = new CanvasSink(track, { poolSize: KEEP + 3 });
  return (t: number) => sink.canvases(t);
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
