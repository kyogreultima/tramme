// The depth of the picture, read at authoring time (Depth Anything v2, small,
// in the browser: WebGPU, the processor without one) and saved as files the
// render reads: a grey PNG for a photo, a grey video timed like the file for
// footage (bright where near) — the mask videos of the cut-out, in depth. A
// hidden layer plays the file and `fx.parallax` moves the source's pixels the
// way the composition camera would place them at that depth, so a photo moves
// in 2.5D and footage takes a depth of field (`fx.depthBlur`). Tools of the
// editor's vocabulary: the assistant runs them (use_tool), the user too
// (/ menu).

import { ALL_FORMATS, BufferTarget, CanvasSink, CanvasSource, getFirstEncodableVideoCodec, Input, Mp4OutputFormat, Output, Quality, UrlSource } from 'mediabunny';
import { pointer, staticValue, type Effect, type Layer, type Op, type ToolContext, type ToolType, type TrammeDoc } from '@tramme/core';
import { AVC_FROM_STREAM } from './avc.ts';
import { t } from './i18n/index.ts';
import { freshId, isToolAsset, linkedTransform, siblingsOf, transformOp } from './model.ts';
import { canvas, loadImage, pipelineOf } from './perception.ts';
import { chosenModel } from './settings.ts';
import { madeBy } from './models.ts';

/** long side of the pictures the model reads */
const PROC = 512;
/** long side of the depth picture of a photo, at most: twice what the model reads (smoothed up, a larger file holds no more depth); past it, its source area is scaled to the map's pixels */
const MAP = 1024;
/** long side of the depth video, at most */
const VIDEO = 1280;
/** a change of depth this large (of 255) between two frames is a move, not a flicker */
const STEADY = 24;

type DepthMap = { data: Uint8ClampedArray | Uint8Array; width: number; height: number; channels: number };
type DepthRun = (image: unknown) => Promise<{ depth: DepthMap }>;
/** reports how far the work is (seconds of the span done, of all), at most once a percent */
type Progress = (done: number, total: number, step: string) => void;

/** the depth model chosen in the settings (by default Depth Anything v2 small), loaded on first use and kept; a failed load is tried again next time */
const loadDepth = async () => {
  const { RawImage } = await import('@huggingface/transformers');
  const run = await pipelineOf<DepthRun>(chosenModel('depth'), 'the depth model');
  return { run, picture: (c: HTMLCanvasElement) => RawImage.fromCanvas(c) };
};

/** the depth of one picture as grey levels 0..255 (bright where near), at its own size */
async function depthOf(model: Awaited<ReturnType<typeof loadDepth>>, picture: HTMLCanvasElement): Promise<{ grey: Uint8ClampedArray; w: number; h: number }> {
  const { depth } = await model.run(model.picture(picture));
  const ch = depth.channels || 1, grey = new Uint8ClampedArray(depth.width * depth.height);
  for (let i = 0; i < grey.length; i++) grey[i] = depth.data[i * ch];
  return { grey, w: depth.width, h: depth.height };
}

/** a depth steadied by the previous one: small changes (model noise) averaged, real moves taken as they are */
export function steadyDepth(prev: Uint8ClampedArray | null, cur: Uint8ClampedArray, gate = STEADY): Uint8ClampedArray {
  if (!prev || prev.length !== cur.length) return cur;
  const out = new Uint8ClampedArray(cur.length);
  for (let i = 0; i < cur.length; i++) out[i] = Math.abs(cur[i] - prev[i]) < gate ? (cur[i] + prev[i]) >> 1 : cur[i];
  return out;
}

/** a grey map drawn into a canvas of its size (white where near) */
function pictureOf(grey: Uint8ClampedArray, w: number, h: number, out: { c: HTMLCanvasElement; g: CanvasRenderingContext2D }): HTMLCanvasElement {
  if (out.c.width !== w || out.c.height !== h) Object.assign(out.c, { width: w, height: h });
  const img = out.g.createImageData(w, h);
  for (let i = 0; i < grey.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = grey[i]; img.data[i * 4 + 3] = 255; }
  out.g.putImageData(img, 0, 0);
  return out.c;
}

const pngOf = (c: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('the depth map could not be written'))), 'image/png'));

/**
 * The depth map of a picture, as a PNG drawn at the picture's own pixels
 * (capped at MAP), so a source area in image pixels lines up with it.
 */
async function depthImage(url: string, signal: AbortSignal, progress: Progress): Promise<{ blob: Blob; w: number; h: number; iw: number; ih: number }> {
  const model = await loadDepth();
  const img = await loadImage(url);
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const read = Math.min(1, PROC / Math.max(iw, ih));
  const pic = canvas(Math.max(2, Math.round(iw * read)), Math.max(2, Math.round(ih * read)));
  pic.g.drawImage(img, 0, 0, pic.c.width, pic.c.height);
  progress(0.5, 1, t('perception.depthEstimating'));
  if (signal.aborted) throw new Error('stopped');
  const { grey, w, h } = await depthOf(model, pic.c);
  const save = Math.min(1, MAP / Math.max(iw, ih));
  const W = Math.max(2, Math.round(iw * save)), H = Math.max(2, Math.round(ih * save));
  const out = canvas(W, H);
  out.g.imageSmoothingQuality = 'high';
  out.g.drawImage(pictureOf(grey, w, h, canvas(w, h)), 0, 0, W, H);
  progress(1, 1, t('perception.depthEstimating'));
  return { blob: await pngOf(out.c), w: W, h: H, iw, ih };
}

/** the depth video of [from, to) of a file: grey frames timed like the file, black outside that span */
async function depthVideo(url: string, from: number, to: number, signal: AbortSignal, progress: Progress): Promise<{ blob: Blob; frames: number }> {
  if (typeof VideoEncoder === 'undefined') throw new Error('this browser cannot encode video (WebCodecs)');
  const model = await loadDepth();
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('this file has no picture');
    if (!(await track.canDecode())) throw new Error(`video codec not supported by this browser (${track.codec ?? 'unknown'})`);
    const duration = await input.computeDuration();
    const iw = track.displayWidth, ih = track.displayHeight;
    // even sizes: what the encoders take
    const sized = (side: number) => { const k = Math.min(1, side / Math.max(iw, ih)); return [Math.max(2, Math.round((iw * k) / 2) * 2), Math.max(2, Math.round((ih * k) / 2) * 2)]; };
    const [pw, ph] = sized(PROC), [W, H] = sized(VIDEO);
    const pic = canvas(pw, ph), map = canvas(2, 2), out = canvas(W, H);
    out.g.imageSmoothingQuality = 'high';
    const sink = new CanvasSink(track, { width: pw, height: ph, fit: 'fill', poolSize: 2 });
    const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: W, height: H });
    if (!codec) throw new Error(`no video codec can encode ${W}×${H} in this browser`);
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const video = new CanvasSource(out.c, { codec, quality: new Quality('very-high'), keyFrameInterval: 2, ...(codec === 'avc' ? AVC_FROM_STREAM : {}) });
    output.addVideoTrack(video);
    await output.start();
    // one black frame over a span without a map (the effects read nothing there and stay at rest)
    const black = async (at: number, until: number) => {
      if (until - at < 1e-3) return;
      out.g.fillStyle = '#000';
      out.g.fillRect(0, 0, W, H);
      await video.add(at, until - at);
    };
    let end = 0, frames = 0, prev: Uint8ClampedArray | null = null;
    try {
      for await (const f of sink.canvases(from, to)) {
        if (signal.aborted) throw new Error('stopped');
        await black(end, f.timestamp);
        pic.g.drawImage(f.canvas as CanvasImageSource, 0, 0);
        const { grey, w, h } = await depthOf(model, pic.c);
        prev = steadyDepth(prev, grey);
        out.g.drawImage(pictureOf(prev, w, h, map), 0, 0, W, H);
        await video.add(f.timestamp, f.duration);
        end = f.timestamp + f.duration;
        frames++;
        progress(end - from, to - from, t('perception.depthEstimating'));
      }
      if (!frames) throw new Error(`no picture between ${from.toFixed(2)} and ${to.toFixed(2)} s of the file`);
      await black(end, duration);
      await output.finalize();
    } catch (e) {
      await output.cancel();
      throw e;
    }
    return { blob: new Blob([target.buffer!], { type: 'video/mp4' }), frames };
  } finally {
    input.dispose();
  }
}

/** how much the layer is scaled up so the far depths' stretch past its edges shows nothing: about 1.18 by default */
export function scaleFor(range: number, plane: number, perspective: number, amount = 1): number {
  return 1 + (1.15 * amount * range * Math.max(plane, 1 - plane)) / perspective;
}

/**
 * The layers of a depth map of `source`: the map (hidden) right above it, and
 * `fx.parallax` on the source, whose perspective and zoom are linked to the
 * composition's camera and whose `at` is the layer's own depth, so the
 * camera's own move of the layer is not counted twice. Run again, it reuses
 * them. For a photo, `box` (its source area scaled to the map's pixels) keeps
 * the map exactly under it.
 */
export function depthLayers(doc: TrammeDoc, compId: string, source: string, depthAsset: string, box?: [number, number, number, number]): { ops: Op[]; depth: string; framing?: Framing } {
  const c = doc.compositions[compId], l = c.layers[source], video = l.type === 'video', prop = video ? 'video' : 'image';
  const ops: Op[] = [];
  let depth = Object.keys(c.layers).find((id) => c.layers[id].props?.[prop] === depthAsset);
  if (!depth) {
    const { path, list: was } = siblingsOf(c, source);
    const taken: Record<string, unknown> = { ...c.layers };
    depth = freshId(taken, `${source}-depth`);
    taken[depth] = 1;
    const transform = linkedTransform(source, l);
    const timing = { ...(l.in !== undefined ? { in: l.in } : {}), ...(l.out !== undefined ? { out: l.out } : {}) };
    const name = l.name ?? source;
    // the map drawn exactly where the source is: the same frame, fit and focus for footage; the same frame and fit for a photo, its area scaled to the map's pixels
    const props: Record<string, unknown> = video
      ? {
          [prop]: depthAsset, start: l.props?.start ?? 0,
          // the map plays the file like the source does: the same pace and loop, or it drifts out of the picture
          ...(l.props?.rate !== undefined ? { rate: l.props.rate } : {}),
          ...(l.props?.loop !== undefined ? { loop: l.props.loop } : {}),
          ...(l.props?.loopEnd !== undefined ? { loopEnd: l.props.loopEnd } : {}),
          size: { $link: `${source}.size` }, ...(l.props?.fit !== undefined ? { fit: l.props.fit } : {}), ...(l.props?.focus !== undefined ? { focus: l.props.focus } : {}), muted: true,
        }
      : { image: depthAsset, size: { $link: `${source}.size` }, fit: { $link: `${source}.fit` }, focus: { $link: `${source}.focus` }, zoom: { $link: `${source}.zoom` }, offset: { $link: `${source}.offset` }, ...(box ? { box } : {}), crop: { $link: `${source}.crop` } };
    ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', depth), value: { type: video ? 'video' : 'image', name: t('perception.depthMap', { name }), visible: false, ...timing, transform, props } });
    const list = [...was];
    list.splice(list.indexOf(source) + 1, 0, depth);
    ops.push({ op: 'replace', path: pointer('compositions', compId, ...path), value: list });
  }
  const effects = l.effects ?? [];
  let framing: Framing | undefined;
  if (!effects.some((e) => e.type === 'fx.parallax' && e.props?.source === depth)) {
    ops.push({
      op: 'add', path: pointer('compositions', compId, 'layers', source, 'effects'),
      value: [...effects, {
        id: freshId(Object.fromEntries(effects.map((e) => [e.id, 1])), 'parallax'),
        type: 'fx.parallax',
        props: { source: depth, perspective: { $link: '$comp.camera.perspective' }, zoom: { $link: '$comp.camera.zoom' }, at: { $link: `${source}.transform.depth` } },
      }],
    });
    // a photo is framed for its relief once, with the parallax it serves: run again (depth or photo-2.5d), it is never scaled twice
    if (!video) {
      const framed = reliefFraming(l, compId, source);
      ops.push(...framed.ops);
      framing = framed.framing;
    }
  } else if (!video) framing = 'kept';
  return { ops, depth, ...(framing ? { framing } : {}) };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** what became of a photo's scale for its relief: scaled now, framed by an earlier run, or animated (left as it is) */
export type Framing = 'scaled' | 'kept' | 'animated';

/**
 * The photo scaled up by the most its map can stretch it, so the relief shows
 * no edge: its own scale times about 1.18 (an inset stays an inset), an
 * animated scale left as it is.
 */
function reliefFraming(l: Layer, compId: string, source: string): { ops: Op[]; framing: Framing } {
  const scale = l.transform?.scale;
  if (scale !== undefined && !Array.isArray(scale)) return { ops: [], framing: 'animated' };
  const [sx, sy] = (scale as [number, number] | undefined) ?? [1, 1], f = scaleFor(320, 0.5, 1000);
  return { ops: [transformOp(compId, source, l, 'scale', [r2(sx * f), r2(sy * f)])], framing: 'scaled' };
}

/**
 * The move of a photo in 2.5D: the composition camera, a slow drift, only
 * when there is none (the photo's framing comes with its parallax, see
 * depthLayers).
 */
export function photo25dOps(doc: TrammeDoc, compId: string, drift = 1, seconds?: number): { ops: Op[]; added: boolean } {
  const c = doc.compositions[compId];
  const ops: Op[] = [];
  let added = false;
  if (!c.camera) {
    const dur = Math.min(seconds ?? c.duration, c.duration);
    const ax = 0.08 * drift * c.width, ay = 0.05 * drift * c.height;
    ops.push({
      op: 'add', path: pointer('compositions', compId, 'camera'),
      value: {
        pan: { $k: [{ t: 0, v: [0, 0] }, { t: dur * 0.42, v: [ax * 0.8, -ay * 0.5], ease: [0.4, 0, 0.2, 1] }, { t: dur, v: [-ax * 0.6, ay] }] },
        perspective: 1000, zoom: 1,
      },
    });
    added = true;
  }
  return { ops, added };
}

/** the video or image layer the tools work on: the one given, the selected one, or the first whose media is not a tool's own file (a depth map, a cut-out) */
function sourceOf(ctx: ToolContext, wanted?: string, types: readonly string[] = ['video', 'image']): { id: string; l: Layer } {
  const c = ctx.doc.compositions[ctx.compId];
  const ok = (id: string) => {
    const l = c.layers[id];
    if (!l || !types.includes(l.type)) return false;
    const media = staticValue(l.props?.[l.type === 'video' ? 'video' : 'image']);
    return typeof media !== 'string' || !isToolAsset(media, ctx.doc.assets[media]);
  };
  const id = wanted ?? ctx.selection.find(ok) ?? Object.keys(c.layers).find(ok);
  if (!id) throw new Error(`the composition has no ${types.join(' or ')} layer`);
  return { id, l: c.layers[id] };
}

const spanOf = (l: Layer, duration: number): [number, number] => {
  const a = l.in ?? 0, b = l.out ?? duration;
  if (!(b > a)) throw new Error('this layer has no time span to read a depth of');
  return [a, b];
};

/**
 * The depth of one layer's media, made only once as an asset (`depth-<layer>`):
 * the map file written (again, when there is one: it is rewritten), the layers
 * wired (reused), and for a photo a depth of field added too.
 */
async function ensureDepth(ctx: ToolContext, source: string, progress: Progress): Promise<{ ops: Op[]; asset: string; reload: string[]; frames: number; framing?: Framing }> {
  const c = ctx.doc.compositions[ctx.compId], l = c.layers[source];
  const media = l.props?.[l.type === 'video' ? 'video' : 'image'];
  if (typeof media !== 'string' || !ctx.doc.assets[media]) throw new Error(`${source}: this layer has no media of its own yet`);
  const asset = `depth-${source}`.slice(0, 64);
  const had = !!ctx.doc.assets[asset];
  let blob: Blob, frames = 0, box: [number, number, number, number] | undefined;
  if (l.type === 'video') {
    const [a, b] = spanOf(l, c.duration);
    // the map is timed like the file: the span read is the layer's own, brought to the file's time (its start offset, its pace)
    const lin = l.in ?? 0;
    const start = Math.max(0, Number(staticValue(l.props?.start)) || 0);
    const rate = Number(staticValue(l.props?.rate)) || 1;
    ({ blob, frames } = await depthVideo(ctx.assetUrl(media), start + (a - lin) * rate, start + (b - lin) * rate, ctx.signal, progress));
  } else {
    const map = await depthImage(ctx.assetUrl(media), ctx.signal, progress);
    blob = map.blob;
    // the source area (image pixels) scaled to the map's pixels, so the map lines up under it
    const [x0, y0, x1, y1] = (l.props?.box as [number, number, number, number] | undefined) ?? [0, 0, map.iw, map.ih];
    const k = map.w / map.iw;
    box = [x0 * k, y0 * k, x1 * k, y1 * k];
  }
  const src = await ctx.writeFile(l.type === 'video' ? `assets/depth/${source}.mp4` : `assets/depth/${source}.png`, blob);
  const wired = depthLayers(ctx.doc, ctx.compId, source, asset, box);
  // a photo takes a depth of field too, once (footage is given one by hand, or by photo-2.5d)
  if (l.type === 'image') wired.ops = withDepthBlur(wired.ops, l, ctx.compId, source, wired.depth);
  const value = { type: l.type === 'video' ? 'video' : 'image', src, name: t('perception.depthLabel', { name: ctx.doc.assets[media].name ?? media }), madeBy: [madeBy(chosenModel('depth'))] };
  return { ops: [{ op: had ? 'replace' : 'add', path: pointer('assets', asset), value }, ...wired.ops], asset, reload: had ? [asset] : [], frames, ...(wired.framing ? { framing: wired.framing } : {}) };
}

/**
 * The ops of depthLayers with a depth of field on the photo, once: it reads
 * the hidden map layer `depth` (a layer, like the parallax's source), and
 * joins the effects list those ops may have just written (with the
 * parallax), as a second list would replace the first.
 */
export function withDepthBlur(ops: Op[], l: Layer, compId: string, source: string, depth: string): Op[] {
  if ((l.effects ?? []).some((e) => e.type === 'fx.depthBlur' && e.props?.source === depth)) return ops;
  const path = pointer('compositions', compId, 'layers', source, 'effects');
  const at = ops.findIndex((o) => o.op === 'add' && o.path === path);
  const effects = (at >= 0 ? (ops[at] as Extract<Op, { op: 'add' }>).value : l.effects ?? []) as Effect[];
  const list = [...effects, { id: freshId(Object.fromEntries(effects.map((e) => [e.id, 1])), 'dof'), type: 'fx.depthBlur', props: { source: depth, focus: 0.5 } }];
  return at >= 0 ? ops.map((o, i) => (i === at ? { op: 'add', path, value: list } : o)) : [...ops, { op: 'add', path, value: list }];
}

/** what the tools tell of a photo's framing */
const framingNote = (f: Framing): string => f === 'scaled'
  ? 'The photo is scaled up by about 1.18 (its own scale times that), so the near depths stretching past its edges show nothing.'
  : f === 'kept'
    ? 'Its framing for the relief was set by an earlier run: its scale is left as it is.'
    : 'Its scale is animated, so I left the framing to you: the far depths may show an edge.';

/** reports progress at most once a percent */
const throttled = (ctx: ToolContext) => {
  let shown = '';
  return (done: number, total: number, step: string): void => {
    const at = `${step} ${Math.floor((100 * done) / total)}`;
    if (at !== shown) { shown = at; ctx.progress?.(done, total, step); }
  };
};

const depth: ToolType<{ layer?: string }> = {
  name: 'depth', title: 'Read the depth',
  description: 'reads the depth of a photo or a video as a grey map (bright where near), saved as an asset, and wires it: fx.parallax moves the layer the way the composition camera would, a photo also takes a depth of field (fx.depthBlur)',
  input: {
    type: 'object',
    properties: {
      layer: { type: 'string', format: 'layer', layerType: ['video', 'image'], title: 'Layer', description: 'the photo or footage to read (the selected layer by default)' },
    },
  },
  ai: {
    when: 'a 2.5D move of a photo (then give the composition a camera, or run photo-2.5d, which does both), a depth of field on footage',
    avoid: 'a long video when a few seconds are used: the map spans the whole layer, trim it first (about a second of work per second of video)',
  },
  async run({ layer: wanted }, ctx) {
    const { id, l } = sourceOf(ctx, wanted);
    const { ops, asset, reload, frames, framing } = await ensureDepth(ctx, id, throttled(ctx));
    return {
      ops, reload, label: t('perception.depthLabel', { name: l.name ?? id }),
      text: [
        `Depth of "${id}" read (${l.type === 'video' ? `${frames} frames` : 'one picture'}): grey map saved as asset "${asset}" (bright where near), played by the hidden layer "${asset}-…", and fx.parallax on the layer, its perspective and zoom linked to the composition's camera.`,
        ...(l.type === 'image' ? ['The photo also got fx.depthBlur (focus 0.5): a depth of field where the map leaves the middle.'] : []),
        ...(framing ? [framingNote(framing)] : []),
        'Nothing moves until the composition has a camera: add one (pan, zoom) and the layer gains the relief. For a photo, photo-2.5d does depth and camera in one.',
        `Run again, the map is read again and the layers are reused. If "${id}" is trimmed or moved in time, run depth again.`,
      ].join('\n'),
      notice: t('perception.depthDone', { frames: frames || 1 }),
    };
  },
};

const photo25d: ToolType<{ layer?: string; drift?: number; seconds?: number }> = {
  name: 'photo-2.5d', title: 'Photo in 2.5D',
  description: 'turns a still photo into a 2.5D move: reads its depth when it has none, adds the composition camera with a slow drift, and scales the photo up so the relief shows no edge',
  input: {
    type: 'object',
    properties: {
      layer: { type: 'string', format: 'layer', layerType: 'image', title: 'Photo', description: 'the picture to move (the selected image by default)' },
      drift: { type: 'number', minimum: 0, maximum: 3, default: 1, title: 'Drift', description: 'how far the camera drifts (1: about 8% of the width sideways)' },
      seconds: { type: 'number', minimum: 0.5, title: 'Seconds', description: 'how long the drift takes (the composition\'s length by default)' },
    },
  },
  ai: {
    when: 'a photo that should move on its own (a Ken Burns with real parallax): one tool gives it the depth, the camera and the framing',
    avoid: 'footage (it already moves); a photo cropped tight to its subject (the drift shows its edges: the tool scales the photo up, crop it less instead)',
  },
  async run({ layer: wanted, drift = 1, seconds }, ctx) {
    const c = ctx.doc.compositions[ctx.compId];
    const { id, l } = sourceOf(ctx, wanted, ['image']);
    const { ops, asset, reload, framing } = await ensureDepth(ctx, id, throttled(ctx));
    // the camera, only when there is none: an existing one keeps its own move (the framing came with the parallax)
    const { ops: move, added } = photo25dOps(ctx.doc, ctx.compId, drift, seconds);
    ops.push(...move);
    const dur = Math.min(seconds ?? c.duration, c.duration);
    return {
      ops, reload, label: t('perception.depthLabel', { name: l.name ?? id }),
      text: [
        `"${id}" now moves in 2.5D: depth map asset "${asset}" (the hidden layer), fx.parallax on the photo (linked to the camera), fx.depthBlur (focus 0.5).`,
        added ? `A camera was added: a slow drift over ${r2(dur)} s (pan, ease).` : 'A camera drives the parallax (the composition had one already: its move).',
        framingNote(framing ?? 'kept'),
        'Tune it: drift for a wider move, fx.parallax range for a deeper relief, fx.depthBlur focus for what stays sharp.',
      ].join('\n'),
      notice: t('perception.photo25dDone', { name: l.name ?? id }),
    };
  },
};

export const DEPTH_TOOLS: ToolType[] = [depth, photo25d];
