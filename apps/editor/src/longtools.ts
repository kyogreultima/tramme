// The long jobs of the editor (docs/editing-roadmap.md, step 13): a picture
// or a video at twice its size, and a video with frames made up between its
// frames, so a slow motion plays smoothly. Each runs on this machine at
// authoring time, through the long-job runner (an estimate, the progress, a
// cancel, and a resume from the chunks done), and saves a new asset; the
// original is kept. The engines are the core's by default, without a model
// (Lanczos and a block-matching motion); the settings can choose a network
// instead (Real-ESRGAN for a picture's fine texture, RIFE for hard motion),
// and the core's engine takes over when the network cannot run.

import { between, enlarge, flowField, pointer, type Op, type ToolType, type TrammeDoc } from '@tramme/core';
import { canvasOf, jobId, rgbaOf, runVideoJob, type Frame } from './longjob.ts';
import { canvas, loadImage } from './perception.ts';
import { chosenModel } from './settings.ts';
import { enlargeWithModel } from './esrgan-run.ts';
import { RifeRun } from './rife.ts';
import { madeBy } from './models.ts';
import { t } from './i18n/index.ts';

/** the layers of the composition showing an asset, and the asset of a layer or the one named */
function targetOf(ctx: Parameters<ToolType['run']>[1], wanted: string | undefined, types: string[]) {
  const c = ctx.doc.compositions[ctx.compId];
  const layerAsset = (id: string) => { const l = c.layers[id]; return l && (l.type === 'image' || l.type === 'video') ? String(l.props?.[l.type] ?? '') : ''; };
  const asset = wanted && ctx.doc.assets[wanted] ? wanted
    : wanted && c.layers[wanted] ? layerAsset(wanted)
    : ctx.selection.map(layerAsset).find(Boolean) ?? Object.keys(c.layers).map(layerAsset).find((a) => a && types.includes(ctx.doc.assets[a]?.type));
  if (!asset || !ctx.doc.assets[asset] || !types.includes(ctx.doc.assets[asset].type)) throw new Error(`a ${types.join(' or ')} of the project is expected`);
  const layers = Object.keys(c.layers).filter((id) => layerAsset(id) === asset);
  return { asset, a: ctx.doc.assets[asset], layers, c };
}

const upscale: ToolType<{ asset?: string }> = {
  name: 'upscale', title: 'Enlarge a picture or a video', description: 'makes a picture or a video twice its size (a small source in a large composition), saved as a new asset the layers showing it then use; the original is kept. A video is a long job: it says how long, and resumes where it stopped',
  input: { type: 'object', properties: { asset: { type: 'string', format: 'asset', assetType: ['image', 'video'], title: 'Picture or video', description: 'the selected layer\'s by default' } } },
  ai: { when: 'a source smaller than the frame it fills (a 720p clip in a 4K film, a small logo shown large): enlarge it once before it is shown big', avoid: 'a source already as large as it is shown (nothing to gain, a long wait for a video)' },
  async run(a, ctx) {
    const { asset, a: src, layers, c } = targetOf(ctx, a.asset, ['image', 'video']);
    const id = `${asset}-2x`.slice(0, 64), had = !!ctx.doc.assets[id];
    let path: string, made = 'lanczos', engine = '';
    if (src.type === 'image') {
      ctx.progress?.(0, 1, t('longjob.enlarging'));
      const img = await loadImage(ctx.assetUrl(asset)), pic = canvas(img.naturalWidth, img.naturalHeight);
      pic.g.drawImage(img, 0, 0);
      // the network the settings choose, when one is: the core's Lanczos when it is not, or when the network cannot load
      const entry = chosenModel('upscale');
      let enlarged = null as ReturnType<typeof enlarge> | null;
      if (entry.adapter.kind === 'esrgan') {
        try { enlarged = await enlargeWithModel(entry, rgbaOf(pic.c), (d, n) => ctx.progress?.(d, n, t('longjob.enlarging')), ctx.signal); made = madeBy(entry); }
        catch (e) { if ((e as Error).name === 'AbortError') throw e; engine = `${entry.name} could not run (${(e as Error).message}): Lanczos used instead`; }
      }
      const big = canvasOf(enlarged ?? enlarge(rgbaOf(pic.c), 2));
      const blob = await new Promise<Blob>((res, rej) => big.toBlob((b) => (b ? res(b) : rej(new Error('the picture could not be encoded'))), 'image/png'));
      path = await ctx.writeFile(`assets/upscale/${asset}.png`, blob);
    } else {
      const { blob } = await runVideoJob(ctx, {
        id: jobId(`upscale-${asset}`, src), url: ctx.assetUrl(asset), step: t('longjob.enlarging'),
        size: (w, h) => [w * 2, h * 2],
        frames: (f: Frame) => [{ picture: canvasOf(enlarge(rgbaOf(f.picture), 2)), timestamp: f.timestamp, duration: f.duration }],
      });
      path = await ctx.writeFile(`assets/upscale/${asset}.mp4`, blob);
    }
    const value = { ...src, src: path, name: `${src.name ?? asset} · ×2`, ...(src.box ? { box: src.box.map((v) => v * 2) as [number, number, number, number] } : {}) };
    delete (value as { hash?: string }).hash;
    const ops: Op[] = [{ op: had ? 'replace' : 'add', path: pointer('assets', id), value }];
    for (const l of layers) ops.push({ op: 'replace', path: pointer('compositions', ctx.compId, 'layers', l, 'props', c.layers[l].type), value: id });
    return {
      ops, reload: had ? [id] : [], label: t('longjob.enlarged'), notice: t('longjob.enlarged'),
      text: `${asset} enlarged twice by ${made} (asset "${id}"); ${layers.length ? `the layers ${layers.join(', ')} now show it, at the same size on screen` : 'no layer showed it here'}. The original stays in the project.${engine ? ` ${engine}.` : ''}`,
    };
  },
};

/** a source's size brought down until it just covers the largest composition (never up, even sides): the frames a film shows, not more */
export function filmSize(doc: TrammeDoc, w: number, h: number): [number, number] {
  const c = Object.values(doc.compositions).reduce((m, x) => (x.width * x.height > m.width * m.height ? x : m));
  const s = Math.min(1, Math.max(c.width / w, c.height / h));
  return [Math.round((w * s) / 2) * 2, Math.round((h * s) / 2) * 2];
}

const interpolate: ToolType<{ layer?: string; factor?: number }> = {
  name: 'interpolate', title: 'Smooth slow motion', description: 'makes up the frames between a video\'s frames (2 or 4 times as many), saved as a copy linked to it, at the film\'s size (a larger source brought down to it): a layer of that video slowed under 1× (a speed curve, a ramp) plays the copy and slows smoothly instead of repeating frames. A long job: it says how long, and resumes where it stopped',
  input: {
    type: 'object',
    properties: {
      layer: { type: 'string', format: 'layer', layerType: 'video', title: 'Video layer' },
      factor: { type: 'integer', enum: [2, 4], default: 2, title: 'Frames', description: 'times as many frames: 2 for a slow motion down to 0.5×, 4 down to 0.25×' },
    },
  },
  ai: { when: 'a speed ramp or a slow motion under about 0.7× on footage shot at a normal frame rate (it would stutter): interpolate the video once, the ramp then plays the smooth copy', avoid: 'footage already shot fast (60 fps and more for a 0.5×), fast chaotic motion (water, crowds, confetti) where made-up frames smear' },
  async run(a, ctx) {
    const { asset, a: src } = targetOf(ctx, a.layer, ['video']);
    const k = a.factor === 4 ? 4 : 2, id = `${asset}-smooth`.slice(0, 64), had = !!ctx.doc.assets[id];
    // the network the settings choose, when one is; the core's block matching when it is not, or from the moment it fails
    const entry = chosenModel('interpolate');
    let model = entry.adapter.kind === 'rife' ? new RifeRun(entry) : null, made = model ? madeBy(entry) : 'block matching', engine = '';
    const ts = Array.from({ length: k - 1 }, (_, j) => (j + 1) / k);
    const { blob, resumed, chunks } = await runVideoJob(ctx, {
      // the engine is part of the job: chunks made by one are never resumed by the other
      id: jobId(`interpolate-${asset}-${k}${model ? `-${entry.id}` : ''}`, src), url: ctx.assetUrl(asset), step: t('longjob.interpolating'),
      readAt: (w, h) => filmSize(ctx.doc, w, h),
      size: (w, h) => [w, h],
      async *frames(f: Frame, next: Frame | null) {
        const step = f.duration / k;
        if (!next) { yield { picture: f.picture, timestamp: f.timestamp, duration: f.duration }; return; }
        const A = rgbaOf(f.picture), B = rgbaOf(next.picture);
        let middles: { width: number; height: number; data: Uint8ClampedArray }[] | null = null;
        if (model) {
          try { middles = await model.between(A, B, ts, ctx.signal); }
          catch (e) {
            if ((e as Error).name === 'AbortError') throw e;
            // one engine for a whole video: block matching takes over only when the model made nothing yet; else the job stops, and runs again from the chunks done
            if (model.made) throw new Error(`${entry.name} stopped after ${model.made} frames (${(e as Error).message}): run the slow motion again, it goes on from where it stopped`);
            engine = `${entry.name} could not run (${(e as Error).message}): block matching used instead`; model = null;
          }
        }
        if (!middles) { const flow = flowField(A, B); middles = ts.map((x) => between(A, B, x, flow)); }
        yield { picture: f.picture, timestamp: f.timestamp, duration: step };
        for (const [j, p] of middles.entries()) yield { picture: canvasOf(p), timestamp: f.timestamp + (j + 1) * step, duration: step };
      },
    });
    if (engine) made = 'block matching';
    else if (model?.cpu) engine = `the graphics card stopped on the way: ${entry.name} went on on the processor`;
    const path = await ctx.writeFile(`assets/interpolate/${asset}.mp4`, blob);
    return {
      ops: [
        { op: had ? 'replace' : 'add', path: pointer('assets', id), value: { type: 'video', src: path, name: `${src.name ?? asset} · ${t('longjob.smooth')}` } },
        { op: 'add', path: pointer('assets', asset, 'interpolated'), value: id },
      ],
      reload: had ? [id] : [], label: t('longjob.interpolated'), notice: t('longjob.interpolated'),
      text: `${asset} interpolated by ${made}: ${k}× as many frames (asset "${id}", ${chunks} chunk(s)${resumed ? `, ${resumed} of them done before and resumed` : ''}).${engine ? ` ${engine}.` : ''} Its layers slowed under 1× play it now; above, the original. Look at a slow frame (render_still) for smears on fast motion.`,
    };
  },
};

export const LONG_TOOLS: ToolType[] = [upscale, interpolate];
