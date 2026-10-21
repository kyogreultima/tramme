// The skin tool (docs/editing-roadmap.md, step 12): the faces of a video
// found at authoring time (MediaPipe's Face Landmarker, in the browser), the
// skin of each drawn into a mask video timed like the file (white: the skin;
// eyes, brows and mouth left black), as the cut-out saves its matte; the
// video layer gets fx.smooth through that mask, light. The render only reads
// the mask: the same in the preview and in every export.

import { ALL_FORMATS, BufferTarget, CanvasSink, CanvasSource, getFirstEncodableVideoCodec, Input, Mp4OutputFormat, Output, Quality, UrlSource } from 'mediabunny';
import { pointer, skinShape, type Op, type ToolType, type Vec2 } from '@tramme/core';
import { AVC_FROM_STREAM } from './avc.ts';
import { hubFile } from './cutout.ts';
import { freshId, linkedTransform, siblingsOf } from './model.ts';
import { madeBy } from './models.ts';
import { canvas, onDemand } from './perception.ts';
import { chosenModel } from './settings.ts';
import { t } from './i18n/index.ts';

/** the runtime of MediaPipe's tasks: its WebAssembly, the version of the package, fetched the first time */
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
/** long side of the pictures the faces are looked for in, and of the mask video at most */
const LOOK = 640, MASK = 1280;

type Landmarks = { x: number; y: number }[];
interface Finder { find(picture: HTMLCanvasElement | OffscreenCanvas, ms: number): Landmarks[]; parts: { oval: number[]; eyes: number[][]; brows: number[][]; lips: number[] } }

let finder: (() => Promise<Finder>) | null = null;
/** the face landmarker, loaded once: its runtime from the package's CDN, its model from the settings' catalogue (cached like the others) */
function faces(): Promise<Finder> {
  finder ??= onDemand('the face model', async () => {
    const entry = chosenModel('face');
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const model = new Uint8Array(await hubFile(entry.source));
    const open = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: model, delegate }, runningMode: 'VIDEO', numFaces: 6, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5 });
    const lm = await open('GPU').catch(() => open('CPU'));
    // the parts by their landmarks: the library's own lists of connections
    const ids = (c: { start: number; end: number }[]) => [...new Set(c.flatMap((x) => [x.start, x.end]))];
    return {
      find: (picture, ms) => lm.detectForVideo(picture, ms).faceLandmarks.map((f) => f.map((p) => ({ x: p.x, y: p.y }))),
      parts: {
        oval: ids(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL),
        eyes: [ids(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE), ids(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE)],
        brows: [ids(FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW), ids(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW)],
        lips: ids(FaceLandmarker.FACE_LANDMARKS_LIPS),
      },
    };
  });
  return finder();
}

/** the skin of the faces found, drawn white on black at w × h, its edge softened */
export function drawSkin(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, found: Landmarks[], parts: Finder['parts'], w: number, h: number) {
  g.filter = 'none';
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  for (const f of found) {
    const at = (list: number[]) => list.map((i) => [f[i].x * w, f[i].y * h] as Vec2);
    const shape = skinShape({ oval: at(parts.oval), eyes: parts.eyes.map(at), brows: parts.brows.map(at), lips: at(parts.lips) });
    const xs = shape.face.map((p) => p[0]), size = Math.max(...xs) - Math.min(...xs);
    const fill = (pts: Vec2[], colour: string) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fillStyle = colour; g.fill(); };
    g.filter = `blur(${Math.max(1, size * 0.02).toFixed(1)}px)`;
    fill(shape.face, '#fff');
    for (const hole of shape.holes) fill(hole, '#000');
    g.filter = 'none';
  }
}

/** the skin's mask video over [from, to) of a file: timed like the file, black outside that span */
async function skinVideo(url: string, from: number, to: number, signal: AbortSignal, progress: (done: number, total: number) => void): Promise<{ blob: Blob; frames: number; empty: number }> {
  if (typeof VideoEncoder === 'undefined') throw new Error('this browser cannot encode video (WebCodecs)');
  const find = await faces();
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('this file has no picture');
    const duration = await input.computeDuration();
    const iw = track.displayWidth, ih = track.displayHeight;
    const sized = (side: number) => { const k = Math.min(1, side / Math.max(iw, ih)); return [Math.max(2, Math.round((iw * k) / 2) * 2), Math.max(2, Math.round((ih * k) / 2) * 2)]; };
    const [lw, lh] = sized(LOOK), [W, H] = sized(MASK);
    const look = canvas(lw, lh), out = canvas(W, H);
    const sink = new CanvasSink(track, { width: lw, height: lh, fit: 'fill', poolSize: 2 });
    const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: W, height: H });
    if (!codec) throw new Error(`no video codec can encode ${W}×${H} in this browser`);
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const video = new CanvasSource(out.c, { codec, quality: new Quality('very-high'), keyFrameInterval: 2, ...(codec === 'avc' ? AVC_FROM_STREAM : {}) });
    output.addVideoTrack(video);
    await output.start();
    const black = async (at: number, until: number) => { if (until - at < 1e-3) return; out.g.fillStyle = '#000'; out.g.fillRect(0, 0, W, H); await video.add(at, until - at); };
    let end = 0, frames = 0, empty = 0, last = -1;
    try {
      for await (const f of sink.canvases(from, to)) {
        if (signal.aborted) throw new Error('stopped');
        await black(end, f.timestamp);
        look.g.drawImage(f.canvas as CanvasImageSource, 0, 0);
        // the landmarker's clock only goes forward
        const ms = Math.max(last + 1, Math.round(f.timestamp * 1000));
        last = ms;
        const found = find.find(look.c, ms);
        if (!found.length) empty++;
        drawSkin(out.g, found, find.parts, W, H);
        await video.add(f.timestamp, f.duration);
        end = f.timestamp + f.duration;
        frames++;
        progress(end - from, to - from);
      }
      if (!frames) throw new Error(`no picture between ${from.toFixed(2)} and ${to.toFixed(2)} s of the file`);
      await black(end, duration);
      await output.finalize();
    } catch (e) {
      await output.cancel();
      throw e;
    }
    return { blob: new Blob([target.buffer!], { type: 'video/mp4' }), frames, empty };
  } finally {
    input.dispose();
  }
}

interface SkinArgs { layer?: string; strength?: number; from?: number; to?: number }

const skin: ToolType<SkinArgs> = {
  name: 'skin', title: 'Smooth the skin', description: 'finds the faces of a video and softens their skin (eyes, brows and mouth left sharp): a mask video of the skin saved beside it, and fx.smooth on the layer through that mask',
  input: {
    type: 'object',
    properties: {
      layer: { type: 'string', format: 'layer', layerType: 'video', title: 'Video layer' },
      strength: { type: 'number', minimum: 0.05, maximum: 1, default: 0.3, title: 'Strength', description: 'light by default: a face stays a face' },
      from: { type: 'number', minimum: 0, title: 'From (s)', description: 'composition time (the start of the video layer by default)' },
      to: { type: 'number', minimum: 0, title: 'To (s)', description: 'composition time (the end of the video layer by default)' },
    },
  },
  ai: {
    when: 'only when the user asks for softer skin (an interview, a close-up)',
    avoid: 'running it unasked, a strength above what was asked (0.2 to 0.4 is plenty), a wide shot where faces are small (nothing to gain)',
  },
  async run(a, ctx) {
    const c = ctx.doc.compositions[ctx.compId];
    const source = a.layer ?? ctx.selection.find((id) => c.layers[id]?.type === 'video') ?? Object.keys(c.layers).find((id) => c.layers[id].type === 'video' && c.layers[id].visible !== false);
    const l = source ? c.layers[source] : undefined;
    if (!source || l?.type !== 'video') throw new Error('skin: a video layer is expected');
    const asset = String(l.props?.video ?? '');
    if (!ctx.doc.assets[asset]) throw new Error(`${source}: this layer has no video file`);
    const start = typeof l.props?.start === 'number' ? l.props.start : 0, lin = l.in ?? 0, lout = l.out ?? c.duration;
    const from = Math.max(lin, a.from ?? lin), to = Math.min(lout, a.to ?? lout);
    if (to <= from) throw new Error(`nothing to smooth: ${source} shows from ${lin} to ${lout} s`);
    const strength = Math.min(1, Math.max(0.05, a.strength ?? 0.3));
    const { blob, frames, empty } = await skinVideo(ctx.assetUrl(asset), start + from - lin, start + to - lin, ctx.signal, (d, n) => ctx.progress?.(d, n, t('skin.finding')));
    const maskAsset = `skin-${source}`.slice(0, 64), had = !!ctx.doc.assets[maskAsset];
    const src = await ctx.writeFile(`assets/skin/${source}.mp4`, blob);
    const ops: Op[] = [{ op: had ? 'replace' : 'add', path: pointer('assets', maskAsset), value: { type: 'video', src, name: t('skin.maskName', { name: ctx.doc.assets[asset].name ?? asset }), madeBy: [madeBy(chosenModel('face'))] } }];
    // the mask layer, hidden, following the video's frame, time and transform (as the cut-out's)
    let mask = Object.keys(c.layers).find((id) => c.layers[id].type === 'video' && c.layers[id].props?.video === maskAsset);
    if (!mask) {
      mask = freshId(c.layers, `${source}-skin`);
      const frame = { start: l.props?.start ?? 0, size: { $link: `${source}.size` }, ...(l.props?.fit !== undefined ? { fit: l.props.fit } : {}), muted: true };
      ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', mask), value: { type: 'video', name: t('skin.maskName', { name: l.name ?? source }), visible: false, ...(l.in !== undefined ? { in: l.in } : {}), ...(l.out !== undefined ? { out: l.out } : {}), transform: linkedTransform(source, l), props: { video: maskAsset, ...frame } } });
      const { path, list } = siblingsOf(c, source);
      ops.push({ op: 'replace', path: pointer('compositions', ctx.compId, ...path), value: [...list.slice(0, list.indexOf(source)), mask, ...list.slice(list.indexOf(source))] });
    }
    // the smoothing on the video, through the mask (its own, replaced when run again)
    const effects = (l.effects ?? []).filter((e) => e.type !== 'fx.smooth');
    ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', source, 'effects'), value: [...effects, { id: freshId(Object.fromEntries(effects.map((e) => [e.id, 1])), 'skin'), type: 'fx.smooth', props: { mask, strength } }] });
    return {
      ops, reload: had ? [maskAsset] : [], label: t('skin.label'), notice: t('skin.done', { frames }),
      text: `The skin of "${source}" smoothed at ${Math.round(strength * 100)} % from ${from.toFixed(2)} to ${to.toFixed(2)} s (${frames} frames${empty ? `, no face in ${empty} of them` : ''}): mask video "${maskAsset}" in the hidden layer "${mask}", fx.smooth on "${source}" through it. Its strength is the effect's; look at a close frame (render_still) before going on.`,
    };
  },
};

export const SKIN_TOOLS: ToolType[] = [skin];
