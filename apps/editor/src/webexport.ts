// Exports in the browser: a second Renderer (the same engine as the preview,
// on its own hidden canvas) draws each frame; WebCodecs encodes the videos
// (Mediabunny writes MP4 and WebM), gifenc the GIF, fflate zips the PNG
// sequence. The audio layers are mixed in an OfflineAudioContext. Lottie and
// SVG come from @tramme/interop.

import { frameSpan } from './exportspan.ts';
import { ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, CanvasSource, canEncodeAudio, getFirstEncodableVideoCodec, Input, Mp4OutputFormat, Output, Quality, VideoSample, VideoSampleSource, WebMOutputFormat } from 'mediabunny';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { zipSync } from 'fflate';
import type { TrammeDoc, Registry } from '@tramme/core';
import { fetchAssetReader, toLottie, toSvg } from '@tramme/interop';
import { deepCodec, encodeWav, ExportAudioError, i420p10, mixExportAudio, Renderer, SETTLE_LIMIT } from '@tramme/render';

import { AVC_FROM_STREAM } from './avc.ts';
import { deviceTarget, keepAwake } from './device.ts';
import { platform, tauri } from './tauri.ts';
import type { WebFormat } from './formats.ts';
import { filterModule, pluginHost } from './plugins/index.ts';
import { blitSandboxFrame, declarationsModule, ensureDeclared, ensureSandboxDoc, moduleItemsOf, primeSandboxExports, renderSandboxFrame, sandboxDeclaration, sandboxVector } from './plugins/sandbox-draw.ts';
import { prefs } from './settings.ts';
import { sandboxedDoc } from './installed.ts';
import { t } from './i18n/index.ts';
import { watermarkStamp } from './watermark-draw.ts';
import { withSceneCapture } from './webscene-snapshot.ts';

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
  /** [from, to] in seconds: only that part of the film, and of its sound */
  range?: [number, number];
  /** the Tramme logo in a corner of the picture; the plan and the setting decide when it is not given (watermark.ts) */
  watermark?: boolean;
  /** the project the document belongs to: its web scenes are read from it */
  projectId?: string;
}

export interface WebExportResult { blob: Blob; ext: string; warnings: string[] }

const mixAudio = async (r: Renderer, span?: { from: number; to: number }) => {
  try { return await mixExportAudio(r, span); }
  catch (e) { if (e instanceof ExportAudioError) throw new Error(t('export.soundSourceUnreadable', { asset: e.asset }), { cause: e }); throw e; }
};

async function verifySound(blob: Blob, codec: 'aac' | 'opus') {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (track && track.codec === codec) {
      for await (const { buffer } of new AudioBufferSink(track).buffers()) if (buffer.length > 0) return;
    }
  } catch (e) { throw new Error(t('export.soundVerificationFailed'), { cause: e }); }
  finally { input.dispose(); }
  throw new Error(t('export.soundVerificationFailed'));
}

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

/** an export; on a phone the screen stays on while it runs (device.ts) */
export async function exportInBrowser(doc: TrammeDoc, base: string, format: WebFormat, opts: WebExportOptions): Promise<WebExportResult> {
  keepAwake(true);
  try {
    if (format === 'wav' || !hasWebScene(doc)) return await exportOnce(doc, base, format, opts);
    // a web scene is drawn from its own frame, frame by frame (webscene-snapshot.ts): a picture, never a vector,
    // and on the page only (an isolated project draws in its sandbox, which has no frames)
    if (format === 'lottie' || format === 'svg' || sandboxedDoc(doc) || !opts.projectId) throw new Error(t('export.websceneNotHere'));
    return await withSceneCapture(opts.projectId, doc, () => exportOnce(doc, base, format, opts));
  } finally { keepAwake(false); }
}

const hasWebScene = (doc: TrammeDoc) => Object.values(doc.compositions).some((comp) => Object.values(comp.layers).some((layer) => layer.type === 'webscene'));

/** an isolated project's SVG still or Lottie file, converted in its sandbox */
async function vectorInSandbox(doc: TrammeDoc, base: string, format: 'svg' | 'lottie', opts: WebExportOptions): Promise<WebExportResult> {
  const { text, warnings } = await sandboxVector(pluginHost(base), doc, base, format, opts.t ?? 0, opts.compId);
  aborted(opts.signal);
  return format === 'lottie'
    ? { blob: new Blob([text], { type: 'application/json' }), ext: 'lottie.json', warnings }
    : { blob: new Blob([text], { type: 'image/svg+xml' }), ext: 'svg', warnings };
}

async function exportOnce(doc: TrammeDoc, base: string, format: WebFormat, opts: WebExportOptions): Promise<WebExportResult> {
  if (format === 'lottie' || format === 'svg') {
    if (sandboxedDoc(doc)) return vectorInSandbox(doc, base, format, opts);
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
  if (sandboxed) await ensureDeclared(pluginHost(base), moduleItemsOf(doc, base));
  // plugin tools and checks stay where the editor put them (the sandbox); an export runs render-time code only
  const r = await Renderer.open(doc, opts.registry, base, canvas, { compId: opts.compId, pluginModule: sandboxed ? undefined : filterModule, sandboxModules: sandboxed, sandboxDeclarations: sandboxed ? (id) => declarationsModule(sandboxDeclaration(id)!, id) : undefined });
  const sandboxHost = () => pluginHost(base);
  try {
    const { fps, duration } = r.comp;
    // the part of the film to render, in frames (the whole film without a range)
    const span = frameSpan(fps, duration, opts.range), f0 = span.f0;
    // the render size (the width is rounded to a multiple of 8)
    const W = canvas.width, H = canvas.height;
    if (format === 'wav') {
      const sound = await mixAudio(r, opts.range && span);
      if (!sound) throw new Error(t('export.noSoundLayerIn'));
      return { blob: wav(sound), ext: 'wav', warnings: [] };
    }
    // the watermark: drawn at the frame's size for each frame's time (the logo opens now and then), laid over it by the renderer
    if (opts.watermark ?? await (await import('./watermark.ts')).watermarkForExport()) r.stamp = await watermarkStamp(W, H);
    const frames = span.f1 - span.f0;
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
      await r.bringImages(time);
      ensureSandboxDoc(sandboxHost(), { doc, docUrl: base, loaded: (id) => { try { return r.assets.get(id); } catch { return null; } } });
      const c = doc.compositions[r.compId];
      const pic = await renderSandboxFrame(sandboxHost(), r, { compId: r.compId, t: time, scale: 1, width: c.width, height: c.height }, { export: true });
      if (pic.err) throw new Error(pic.err);
      if (!pic.bitmap) throw new Error(t('export.frameNeverReady', { frame: f, time: time.toFixed(2), s: SETTLE_LIMIT / 1000 }));
      return pic.bitmap as ImageBitmap;
    };
    const readFrame = async (f: number) => {
      if (sandboxed) {
        const bmp = await sandboxFrame(f);
        try { readCtx.drawImage(bmp, 0, 0, W, H); if (r.stamp) readCtx.drawImage(r.stamp(f / fps) as CanvasImageSource, 0, 0, W, H); }
        finally { bmp.close(); }
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
      for (let k = 0; k < frames; k++) {
        const f = f0 + k;
        aborted(opts.signal);
        ctx.putImageData(new ImageData(new Uint8ClampedArray(await readFrame(f)), W, H), 0, 0);
        const png = await new Promise<Blob>((res, rej) => c2.toBlob((b) => (b ? res(b) : rej(new Error(t('export.pngFailed')))), 'image/png'));
        files[`${String(k).padStart(5, '0')}.png`] = [new Uint8Array(await png.arrayBuffer()), { level: 0 }];
        opts.onProgress?.(k + 1, frames);
      }
      return { blob: new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), ext: 'png.zip', warnings: [] };
    }

    if (format === 'gif') {
      // GIF delays are in hundredths of a second: at most 50 frames a second
      const step = Math.ceil(fps / 50), delay = Math.round((1000 * step) / fps);
      const gif = GIFEncoder();
      const total = Math.ceil(frames / step);
      for (let k = 0, i = 0; k < frames; k += step, i++) {
        const f = f0 + k;
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
    const sound = await mixAudio(r, opts.range && span);
    const audioFallback = format === 'mp4' && !!sound && !(await canEncodeAudio('aac', { numberOfChannels: sound.numberOfChannels, sampleRate: sound.sampleRate }));
    const webm = format === 'webm' || audioFallback;
    // 10 bits: a codec this browser encodes so, the frames read at 16 bits; a plugin's sandbox draws at 8, so its films stay at 8
    const tenBit = opts.depth === 10 && (format === 'mp4' || webm);
    const deep = tenBit && !sandboxed ? await deepCodec(webm ? 'webm' : 'mp4', W, H) : null;
    if (tenBit && !sandboxed && !deep) throw new Error(t('export.noTenBit'));
    const deepWarn = tenBit && sandboxed ? [t('export.tenBitPlugins')] : [];
    const wide = deep ? new Uint16Array(W * H * 4) : null, planes = deep ? new Uint16Array(W * H * 1.5) : null;
    const codec = await getFirstEncodableVideoCodec(webm ? ['vp9', 'vp8', 'av1'] : ['avc', 'vp9', 'av1'], { width: W, height: H });
    if (!codec) throw new Error(t('export.noVideoCodecAvailable', { w: W, h: H }));
    const audioCodec = webm ? 'opus' : 'aac';
    const encode = async (hardwareAcceleration: 'no-preference' | 'prefer-software'): Promise<Blob> => {
      // on a phone the film goes to a file as it is encoded (a long one would not fit in memory): the MP4 is patched in place, so no fast start
      const device = platform === 'android' ? await deviceTarget(`export-${Date.now().toString(36)}.${webm ? 'webm' : 'mp4'}`) : null;
      const target = device?.target ?? new BufferTarget();
      const output = new Output({ format: webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: device ? false : 'in-memory' }), target });
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
        for (let k = 0; k < frames; k++) {
          const f = f0 + k;
          aborted(opts.signal);
          if (deep) {
            await complete(f, true);
            r.compositor.readRGBA16(wide!);
            const sample = new VideoSample(i420p10(wide!, W, H, planes!), { format: 'I420P10', codedWidth: W, codedHeight: H, timestamp: k / fps, duration: 1 / fps });
            await encoderStep((video as VideoSampleSource).add(sample), opts.signal);
            sample.close();
          } else if (video instanceof VideoSampleSource) {
            const sample = new VideoSample(await readFrame(f), { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: k / fps, duration: 1 / fps });
            await encoderStep(video.add(sample), opts.signal);
            sample.close();
          } else {
            if (sandboxed) {
              const bmp = await sandboxFrame(f);
              blitSandboxFrame(r, bmp, f / fps, false);
            } else {
              await complete(f, false);
            }
            await encoderStep(video.add(k / fps, 1 / fps), opts.signal);
          }
          opts.onProgress?.(k + 1, frames);
        }
        if (audio && sound) await encoderStep(audio.add(sound), opts.signal);
        await encoderStep(output.finalize(), opts.signal);
      } catch (e) {
        // not awaited: a stalled encoder would hold the error back
        output.cancel().catch(() => {});
        throw e;
      }
      const blob = device ? await device.finish() : new Blob([(target as BufferTarget).buffer!], { type: webm ? 'video/webm' : 'video/mp4' });
      if (audio) await encoderStep(verifySound(blob, audioCodec), opts.signal);
      return blob;
    };
    const ext = webm ? 'webm' : 'mp4';
    const audioWarn = audioFallback ? [t('export.webmForSound')] : [];
    try {
      return { blob: await encode('no-preference'), ext, warnings: [...audioWarn, ...deepWarn, ...(deep ? [t('export.tenBitWith', { codec: deep.label })] : [])] };
    } catch (e) {
      if (!(e instanceof EncoderStalled)) throw e;
      // the hardware encoder stalled: the whole film again, encoded in software (slower, but it finishes)
      opts.onProgress?.(0, frames);
      return { blob: await encode('prefer-software'), ext, warnings: [...audioWarn, ...deepWarn, t('export.softwareEncoder', { s: ENCODE_LIMIT / 1000 })] };
    }
  } finally {
    r.dispose();
  }
}
