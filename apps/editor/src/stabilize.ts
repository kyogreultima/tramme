// The stabilize tool (docs/editing-roadmap.md, step 7): the shake of a video
// read at authoring time, a look every frame of the file at a small size, the
// camera's path smoothed (or locked) and saved as a JSON asset timed like the
// file; the video layer reads it (its `stabilize` property). The shots' cuts
// start the path again, so a stabilised edit does not drift across a cut.

import { ALL_FORMATS, CanvasSink, Input, UrlSource } from 'mediabunny';
import { corrections, coverZoom, frameMotion, grayFrame, layerClock, Evaluator, pointer, type GrayFrame, type Motion, type Stabilization, type ToolType } from '@tramme/core';
import { canvas, CUT, distance, histogram } from './perception.ts';
import { compOf, r } from './recipes.ts';
import { videoLayer } from './tracking.ts';
import { t } from './i18n/index.ts';

/** the long side of the frames read */
const LOOK = 320;
/** looks per second of the file, at most */
const RATE = 30;

interface StabilizeArgs { video?: string; strength?: number; lock?: boolean }

const stabilize: ToolType<StabilizeArgs> = {
  name: 'stabilize', title: 'Stabilise a video', description: "takes the camera's shake out of a video: its path read from the footage, smoothed (or locked still), the picture moved back and zoomed just enough to hide its edges",
  input: {
    type: 'object',
    properties: {
      video: { type: 'string', format: 'layer', layerType: 'video', title: 'Video' },
      strength: { type: 'number', minimum: 0.05, maximum: 5, default: 0.5, title: 'Strength (s)', description: 'how long a move must last to stay: 0.5 s keeps a pan and takes the shake out; longer smooths more (and zooms more)' },
      lock: { type: 'boolean', default: false, title: 'Locked', description: 'the camera held still for each shot, as on a tripod' },
    },
  },
  ai: { when: 'handheld footage that shakes (a phone walking, a shot without a tripod) before titles or callouts go over it', avoid: 'footage whose movement is the point (a whip pan, a running chase); locking a shot that pans (it zooms a lot)' },
  async run(a, ctx) {
    const c = compOf(ctx), videoId = videoLayer(ctx, a.video), vl = c.layers[videoId], asset = String(vl.props?.video ?? '');
    if (!ctx.doc.assets[asset]) throw new Error(`${videoId} plays no video file`);
    const clock = layerClock(new Evaluator(ctx.doc, ctx.registry), ctx.compId, videoId);
    const vin = vl.in ?? 0, vout = vl.out ?? c.duration;
    const input = new Input({ source: new UrlSource(ctx.assetUrl(asset)), formats: ALL_FORMATS });
    try {
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) throw new Error('this file has no picture');
      const W = vt.displayWidth, H = vt.displayHeight, stats = await vt.computePacketStats(120);
      // the part of the file the layer plays, a look a frame (30 a second at most)
      const f0 = Math.min(clock.fileTime(vin), clock.fileTime(vout)), f1 = Math.max(clock.fileTime(vin), clock.fileTime(vout));
      const step = 1 / Math.min(RATE, Math.max(1, stats.averagePacketRate || RATE));
      const times = Array.from({ length: Math.max(2, Math.floor((f1 - f0) / step) + 1) }, (_, i) => +(f0 + i * step).toFixed(4));
      if (times.length > 9000) throw new Error(`stabilize: ${times.length} frames are too many at once: cut the video into shorter layers first`);
      const k = Math.min(1, LOOK / Math.max(W, H)), sw = Math.round(W * k), sh = Math.round(H * k);
      const look = canvas(sw, sh), sink = new CanvasSink(vt, { width: sw, height: sh, fit: 'fill', poolSize: 2 });
      const moves: Motion[] = [], cuts: boolean[] = [];
      let prev: GrayFrame | null = null, hist: Float32Array | null = null;
      for await (const f of sink.canvasesAtTimestamps(times)) {
        if (ctx.signal.aborted) throw new Error('stopped');
        ctx.progress?.(cuts.length + 1, times.length, t('stabilize.reading'));
        if (f) look.g.drawImage(f.canvas as CanvasImageSource, 0, 0, sw, sh);
        const h = histogram(look.g, sw, sh), cut = !!hist && distance(hist, h) > CUT;
        cuts.push(cut);
        hist = h;
        const gray = grayFrame(look.g.getImageData(0, 0, sw, sh).data, sw, sh);
        if (prev) moves.push(cut ? { dx: 0, dy: 0, a: 0, s: 1 } : frameMotion(prev, gray));
        prev = gray;
        if (cuts.length % 8 === 0) await new Promise((done) => setTimeout(done, 0));
      }
      const fps = 1 / step, list = corrections(moves, sw, sh, a.lock ? null : Math.max(0.05, a.strength ?? 0.5) * fps, cuts);
      const zoom = coverZoom(list, sw, sh);
      const data: Stabilization = { version: 1, kind: 'stabilize', source: asset, width: W, height: H, zoom, frames: times.map((at, i) => ({ t: at, ...list[i], x: +list[i].x.toFixed(5), y: +list[i].y.toFixed(5), a: +list[i].a.toFixed(6), s: +list[i].s.toFixed(5) })) };
      const id = `stabilize-${asset}`.slice(0, 64), path = await ctx.writeFile(`assets/stabilize/${asset}.json`, JSON.stringify(data));
      const had = !!ctx.doc.assets[id], shots = cuts.filter(Boolean).length + 1;
      return {
        text: `${videoId} stabilised over ${r(f1 - f0)} s of its file (${times.length} frames, ${shots} shot${shots > 1 ? 's' : ''}), ${a.lock ? 'locked' : `smoothed over ${a.strength ?? 0.5} s`}; zoomed ${Math.round((zoom - 1) * 100)} % to keep the edges out${zoom >= 1.5 ? ' (the most it zooms: some edges may show; lower the strength)' : ''}`,
        ops: [
          { op: had ? 'replace' : 'add', path: pointer('assets', id), value: { type: 'json', src: path, name: `Stabilisation · ${ctx.doc.assets[asset].name ?? asset}` } },
          { op: 'add', path: pointer('compositions', ctx.compId, 'layers', videoId, 'props', 'stabilize'), value: id },
        ],
        reload: had ? [id] : [],
      };
    } finally {
      input.dispose();
    }
  },
};

export const STABILIZE_TOOLS: ToolType[] = [stabilize];
