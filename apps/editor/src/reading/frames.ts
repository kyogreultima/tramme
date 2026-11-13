// The frames of a reference, a video or a gif, as pictures drawn at a given
// size: what the reading looks at. A video through mediabunny, as the shots
// tool reads it; a gif through the browser's image decoder, frame by frame.

import { ALL_FORMATS, CanvasSink, Input, UrlSource } from 'mediabunny';
import { canvas } from '../perception.ts';

export interface FrameSource {
  duration: number;
  width: number;
  height: number;
  /** a sound to read the music from */
  sound: boolean;
  /** the frames at these times (s), drawn w × h; null for a time it could not draw */
  frames(times: number[], w: number, h: number): AsyncGenerator<HTMLCanvasElement | null>;
  dispose(): void;
}

/** a video's frames */
export async function openVideo(url: string): Promise<FrameSource> {
  // two more tries, then it fails: mediabunny's own default tries again for ever
  const input = new Input({ source: new UrlSource(url, { getRetryDelay: (tries) => (tries < 3 ? 0.5 : null) }), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) { input.dispose(); throw new Error('this file has no picture'); }
  const [duration, sound] = await Promise.all([input.computeDuration(), input.getPrimaryAudioTrack().then((a) => !!a).catch(() => false)]);
  return {
    duration, width: track.displayWidth, height: track.displayHeight, sound,
    async *frames(times, w, h) {
      const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 });
      for await (const f of sink.canvasesAtTimestamps(times)) {
        if (!f) { yield null; continue; }
        const { c, g } = canvas(w, h);
        g.drawImage(f.canvas as CanvasImageSource, 0, 0, w, h);
        yield c;
      }
    },
    dispose: () => input.dispose(),
  };
}

/** the index of the frame shown at a time, from the frames' start times */
export function frameAt(starts: number[], t: number): number {
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1] <= t + 1e-6) i++;
  return i;
}

interface Decoder {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(o: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}

/** a gif's frames: decoded once to learn when each one shows */
export async function openGif(url: string): Promise<FrameSource> {
  const Ctor = (globalThis as { ImageDecoder?: new (o: { data: ReadableStream<Uint8Array> | ArrayBuffer; type: string }) => Decoder }).ImageDecoder;
  if (!Ctor) throw new Error('this browser cannot read the frames of a gif: turn it into a video (mp4 or webm) and give that instead');
  const data = await (await fetch(url)).arrayBuffer();
  const decoder = new Ctor({ data, type: 'image/gif' });
  await decoder.tracks.ready;
  const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
  const starts: number[] = [];
  let at = 0, width = 0, height = 0;
  for (let i = 0; i < count; i++) {
    const { image } = await decoder.decode({ frameIndex: i });
    starts.push(at);
    // a frame without a delay is shown for a tenth of a second, as browsers do
    at += (image.duration ?? 0) > 0 ? image.duration! / 1e6 : 0.1;
    width = image.displayWidth; height = image.displayHeight;
    image.close();
  }
  return {
    duration: +at.toFixed(3), width, height, sound: false,
    async *frames(times, w, h) {
      for (const t of times) {
        const { image } = await decoder.decode({ frameIndex: frameAt(starts, t) });
        const { c, g } = canvas(w, h);
        g.drawImage(image as unknown as CanvasImageSource, 0, 0, w, h);
        image.close();
        yield c;
      }
    },
    dispose: () => decoder.close(),
  };
}
