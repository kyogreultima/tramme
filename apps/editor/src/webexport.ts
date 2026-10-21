// Exports in the browser: a second Renderer (the same engine as the preview,
// on its own hidden canvas) draws each frame; WebCodecs encodes the videos
// (Mediabunny writes MP4 and WebM), gifenc the GIF, fflate zips the PNG
// sequence. The audio layers are mixed in an OfflineAudioContext. Lottie and
// SVG come from @tramme/interop.

import { AudioBufferSource, BufferTarget, CanvasSource, canEncodeAudio, getFirstEncodableVideoCodec, Mp4OutputFormat, Output, Quality, VideoSample, VideoSampleSource, WebMOutputFormat } from 'mediabunny';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { zipSync } from 'fflate';
import type { TrammeDoc, Registry } from '@tramme/core';
import { fetchAssetReader, toLottie, toSvg } from '@tramme/interop';
import { deepCodec, encodeWav, i420p10, mixComposition, Renderer, SETTLE_LIMIT } from '@tramme/render';

import { AVC_FROM_STREAM } from './avc.ts';
import type { WebFormat } from './formats.ts';
import { filterModule, pluginHost } from './plugins/index.ts';
import { blitSandboxFrame, declarationsModule, ensureDeclared, ensureSandboxDoc, pluginItemsOf, primeSandboxExports, sandboxDeclaration, sandboxVideoFrames } from './plugins/sandbox-draw.ts';
import { prefs } from './settings.ts';
import { sandboxedDoc } from './installed.ts';
import { t } from './i18n/index.ts';

export interface WebExportOptions {
  compId: string;
  registry: Registry;
  /** sub-frames; the composition's motion blur when omitted */
  samples?: number;
  /** time of the SVG */
  t?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** MP4 and WebM: 10 bits a channel when this browser encodes it (deepCodec), read from the half-float frame */
  depth?: 8 | 10;
}

export interface WebExportResult { blob: Blob; ext: string; warnings: string[] }

/** the composition's sounds (audio layers, sound of videos), through the mixer of the preview, or null */
const mixAudio = (r: Renderer) => mixComposition(r.doc, r.compId, (id) => r.assets.url(id));

const wav = (buf: AudioBuffer) => new Blob([encodeWav(buf) as BlobPart], { type: 'audio/wav' });

const cancelled = () => new DOMException(t('export.exportCancelled'), 'AbortError');
const aborted = (signal?: AbortSignal) => { if (signal?.aborted) throw cancelled(); };

/** how long one step of the encoder (a frame, the end of the file) may take before it is taken as stalled */
const ENCODE_LIMIT = 60_000;

/** a hardware encoder that stopped answering (Media Foundation on some integrated GPUs): the export starts over in software */
class EncoderStalled extends Error {}

/** a step of the encoder: the cancel button ends it at once, and one that never finishes is a stall rather than a wait for ever */
function encoderStep<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(cancelled());
    if (signal?.aborted) { stop(); return; }
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => reject(new EncoderStalled(t('export.encoderStalled', { s: ENCODE_LIMIT / 1000 }))), ENCODE_LIMIT);
    p.then(resolve, reject).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', stop); });
  });
}

export async function exportInBrowser(doc: TrammeDoc, base: string, format: WebFormat, opts: WebExportOptions): Promise<WebExportResult> {
  if (format === 'lottie' || format === 'svg') {
    const readAsset = await fetchAssetReader(doc, base);
    // the sandboxed nodes' vector exports are computed in the sandbox first: the conversion reads them synchronously
    await primeSandboxExports(doc, opts.registry, opts.t ?? 0);
    if (format === 'lottie') {
      const { lottie, warnings } = toLottie(doc, opts.registry, { compId: opts.compId, readAsset });
      return { blob: new Blob([JSON.stringify(lottie)], { type: 'application/json' }), ext: 'lottie.json', warnings };
    }
    const { svg, warnings } = toSvg(doc, opts.registry, opts.t ?? 0, { compId: opts.compId, readAsset });
    return { blob: new Blob([svg], { type: 'image/svg+xml' }), ext: 'svg', warnings };
  }

  const canvas = document.createElement('canvas');
  // the flag: the whole picture — plugins, modifiers, effects, simulations — is evaluated and drawn in the sandbox
  const sandboxed = sandboxedDoc(doc);
  // under the flag the sandbox owns the plugins' modules: its declarations feed the registry, nothing loads on the page
  if (sandboxed) await ensureDeclared(pluginHost(base), pluginItemsOf(doc, base));
  // plugin tools and checks stay where the editor put them (the sandbox); an export runs render-time code only
  const r = await Renderer.open(doc, opts.registry, base, canvas, { compId: opts.compId, pluginModule: sandboxed ? undefined : filterModule, sandboxModules: sandboxed, sandboxDeclarations: sandboxed ? (id) => declarationsModule(sandboxDeclaration(id)!, id) : undefined });
  const sandboxHost = () => pluginHost(base);
  try {
    const { fps, duration } = r.comp;
    // the render size (the width is rounded to a multiple of 8)
    const W = canvas.width, H = canvas.height;
    if (format === 'wav') {
      const sound = await mixAudio(r);
      if (!sound) throw new Error(t('export.noSoundLayerIn'));
      return { blob: wav(sound), ext: 'wav', warnings: [] };
    }
    const frames = Math.round(duration * fps);
    // straight RGBA of frame f (alpha kept)
    const rgba = new Uint8Array(W * H * 4);
    // the sandbox's picture, read as pixels
    const readBack = document.createElement('canvas');
    readBack.width = W; readBack.height = H;
    const readCtx = readBack.getContext('2d', { willReadFrequently: true })!;
    // every video frame exact before reading it; a frame whose pictures never come stops the export rather than hang it
    const complete = async (f: number, toFbo: boolean) => {
      await r.renderComplete(f / fps, { samples: opts.samples, toFbo, signal: opts.signal });
      if (r.late) throw new Error(t('export.frameNeverReady', { frame: f, time: (f / fps).toFixed(2), s: SETTLE_LIMIT / 1000 }));
    };
    /** the sandbox's frame f: videos decoded here, then one renderFrame, read as pixels */
    const sandboxFrame = async (f: number) => {
      aborted(opts.signal);
      const time = f / fps;
      ensureSandboxDoc(sandboxHost(), { doc, docUrl: base, loaded: (id) => { try { return r.assets.get(id); } catch { return null; } } });
      const videos = await sandboxVideoFrames(r, doc, time);
      const c = doc.compositions[r.compId];
      const pic = await sandboxHost().renderFrame({ compId: r.compId, t: time, scale: 1, width: c.width, height: c.height, videos });
      if (pic.err) throw new Error(pic.err);
      if (!pic.bitmap) throw new Error(t('export.frameNeverReady', { frame: f, time: time.toFixed(2), s: SETTLE_LIMIT / 1000 }));
      return pic.bitmap as OffscreenCanvas;
    };
    const readFrame = async (f: number) => {
      if (sandboxed) {
        const bmp = await sandboxFrame(f);
        readCtx.drawImage(bmp, 0, 0, W, H);
        rgba.set(readCtx.getImageData(0, 0, W, H).data);
        return rgba;
      }
      await complete(f, true);
      return r.compositor.readRGBA(rgba, r.lastSeed);
    };

    if (format === 'png') {
      const files: Record<string, [Uint8Array, { level: 0 }]> = {};
      const c2 = document.createElement('canvas');
      c2.width = W; c2.height = H;
      const ctx = c2.getContext('2d')!;
      for (let f = 0; f < frames; f++) {
        aborted(opts.signal);
        ctx.putImageData(new ImageData(new Uint8ClampedArray(await readFrame(f)), W, H), 0, 0);
        const png = await new Promise<Blob>((res, rej) => c2.toBlob((b) => (b ? res(b) : rej(new Error(t('export.pngFailed')))), 'image/png'));
        files[`${String(f).padStart(5, '0')}.png`] = [new Uint8Array(await png.arrayBuffer()), { level: 0 }];
        opts.onProgress?.(f + 1, frames);
      }
      return { blob: new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), ext: 'png.zip', warnings: [] };
    }

    if (format === 'gif') {
      // GIF delays are in hundredths of a second: at most 50 frames a second
      const step = Math.ceil(fps / 50), delay = Math.round((1000 * step) / fps);
      const gif = GIFEncoder();
      const total = Math.ceil(frames / step);
      for (let f = 0, i = 0; f < frames; f += step, i++) {
        aborted(opts.signal);
        const px = await readFrame(f);
        const palette = quantize(px, 256, { format: 'rgba4444', oneBitAlpha: true });
        const index = applyPalette(px, palette, 'rgba4444');
        const transparentIndex = palette.findIndex((p) => p[3] === 0);
        gif.writeFrame(index, W, H, { palette, delay, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex) });
        opts.onProgress?.(i + 1, total);
        if (i % 4 === 3) await new Promise((res) => setTimeout(res));
      }
      gif.finish();
      const warnings = step > 1 ? [t('export.fromFpsBroughtDown', { from: fps, to: Math.round(fps / step) })] : [];
      return { blob: new Blob([gif.bytes() as BlobPart], { type: 'image/gif' }), ext: 'gif', warnings };
    }

    if (typeof VideoEncoder === 'undefined') throw new Error(t('export.webcodecsUnavailableInThis'));
    const webm = format === 'webm';
    // 10 bits: a codec this browser encodes so, the frames read at 16 bits; a plugin's sandbox draws at 8, so its films stay at 8
    const tenBit = opts.depth === 10 && (format === 'mp4' || webm);
    const deep = tenBit && !sandboxed ? await deepCodec(webm ? 'webm' : 'mp4', W, H) : null;
    if (tenBit && !sandboxed && !deep) throw new Error(t('export.noTenBit'));
    const deepWarn = tenBit && sandboxed ? [t('export.tenBitPlugins')] : [];
    const wide = deep ? new Uint16Array(W * H * 4) : null, planes = deep ? new Uint16Array(W * H * 1.5) : null;
    const codec = await getFirstEncodableVideoCodec(webm ? ['vp9', 'vp8', 'av1'] : ['avc', 'vp9', 'av1'], { width: W, height: H });
    if (!codec) throw new Error(t('export.noVideoCodecAvailable', { w: W, h: H }));
    const sound = await mixAudio(r);
    const audioCodec = webm ? 'opus' : (await canEncodeAudio('aac')) ? 'aac' : 'opus';
    const encode = async (hardwareAcceleration: 'no-preference' | 'prefer-software'): Promise<Blob> => {
      const target = new BufferTarget();
      const output = new Output({ format: webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
      const quality = new Quality('very-high');
      // 10 bits: I420P10 planes from the 16-bit frame; MP4: the visible canvas (opaque); WebM: straight RGBA frames, alpha kept
      const video = deep
        ? new VideoSampleSource({ codec: deep.codec, fullCodecString: deep.full, quality, keyFrameInterval: 2, hardwareAcceleration })
        : webm
        ? new VideoSampleSource({ codec, quality, keyFrameInterval: 2, alpha: 'keep', hardwareAcceleration })
        : new CanvasSource(canvas, { codec, quality, keyFrameInterval: 2, hardwareAcceleration, ...(codec === 'avc' ? AVC_FROM_STREAM : {}) });
      output.addVideoTrack(video, { frameRate: fps });
      let audio: AudioBufferSource | null = null;
      if (sound) {
        audio = new AudioBufferSource({ codec: audioCodec, quality: new Quality('high') });
        output.addAudioTrack(audio);
      }
      await output.start();
      try {
        for (let f = 0; f < frames; f++) {
          aborted(opts.signal);
          if (deep) {
            await complete(f, true);
            r.compositor.readRGBA16(wide!);
            const sample = new VideoSample(i420p10(wide!, W, H, planes!), { format: 'I420P10', codedWidth: W, codedHeight: H, timestamp: f / fps, duration: 1 / fps });
            await encoderStep((video as VideoSampleSource).add(sample), opts.signal);
            sample.close();
          } else if (video instanceof VideoSampleSource) {
            const sample = new VideoSample(await readFrame(f), { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: f / fps, duration: 1 / fps });
            await encoderStep(video.add(sample), opts.signal);
            sample.close();
          } else {
            if (sandboxed) {
              const bmp = await sandboxFrame(f);
              blitSandboxFrame(r, bmp, f / fps, false);
            } else {
              await complete(f, false);
            }
            await encoderStep(video.add(f / fps, 1 / fps), opts.signal);
          }
          opts.onProgress?.(f + 1, frames);
        }
        if (audio && sound) await encoderStep(audio.add(sound), opts.signal);
        await encoderStep(output.finalize(), opts.signal);
      } catch (e) {
        // not awaited: a stalled encoder would hold the error back
        output.cancel().catch(() => {});
        throw e;
      }
      return new Blob([target.buffer!], { type: webm ? 'video/webm' : 'video/mp4' });
    };
    const ext = webm ? 'webm' : 'mp4';
    try {
      return { blob: await encode('no-preference'), ext, warnings: [...deepWarn, ...(deep ? [t('export.tenBitWith', { codec: deep.label })] : [])] };
    } catch (e) {
      if (!(e instanceof EncoderStalled)) throw e;
      // the hardware encoder stalled: the whole film again, encoded in software (slower, but it finishes)
      opts.onProgress?.(0, frames);
      return { blob: await encode('prefer-software'), ext, warnings: [...deepWarn, t('export.softwareEncoder', { s: ENCODE_LIMIT / 1000 })] };
    }
  } finally {
    r.dispose();
  }
}
