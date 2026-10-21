// The denoise tool (docs/editing-roadmap.md, step 10): the background noise
// taken out of a voice at authoring time by RNNoise (compiled to
// WebAssembly, loaded when first used, faster than real time on any
// processor), saved as a sound asset timed like its source and linked to it
// (`clean`); the layer plays it mixed with the original by its `clean`
// amount, so the original is kept and a voice never sounds dead.

import { DENOISE_RATE, denoiseChannel, noiseFigures, pointer, type FrameDenoiser, type Layer, type ToolType } from '@tramme/core';
import { encodeWav } from '@tramme/render';
import { compOf } from './recipes.ts';
import { t } from './i18n/index.ts';

/** the model and its version, kept on what it makes */
export const RNNOISE = 'rnnoise@jitsi-0.2.1';

interface RnnoiseModule {
  ready: Promise<unknown>;
  HEAPF32: Float32Array;
  _malloc(n: number): number;
  _free(p: number): void;
  _rnnoise_create(): number;
  _rnnoise_destroy(st: number): void;
  _rnnoise_process_frame(st: number, out: number, inp: number): number;
}

let loaded: Promise<RnnoiseModule> | null = null;
/** RNNoise, compiled to WebAssembly: loaded once, the first time a voice is cleaned */
function rnnoise(): Promise<RnnoiseModule> {
  loaded ??= import('@jitsi/rnnoise-wasm/dist/rnnoise-sync.js').then(async (m) => {
    const mod = (m.default as () => RnnoiseModule)();
    await mod.ready;
    return mod;
  });
  return loaded;
}

/** a frame denoiser of its own (one per channel: RNNoise keeps state from frame to frame), and its release */
export async function rnnoiseFrames(): Promise<{ process: FrameDenoiser; free(): void }> {
  const M = await rnnoise(), N = 480;
  const st = M._rnnoise_create(), inP = M._malloc(N * 4), outP = M._malloc(N * 4);
  return {
    process(input, output) {
      // RNNoise reads 16-bit sample values as floats
      const heap = M.HEAPF32, i0 = inP >> 2, o0 = outP >> 2;
      for (let i = 0; i < N; i++) heap[i0 + i] = input[i] * 32768;
      M._rnnoise_process_frame(st, outP, inP);
      for (let i = 0; i < N; i++) output[i] = M.HEAPF32[o0 + i] / 32768;
    },
    free() { M._free(inP); M._free(outP); M._rnnoise_destroy(st); },
  };
}

interface DenoiseArgs { layer?: string; amount?: number }

const denoise: ToolType<DenoiseArgs> = {
  name: 'denoise', title: 'Clean a voice', description: 'takes the background noise out of a voice (a sound or a video layer): the cleaned voice saved beside the original, which stays; the layer plays the two mixed by its Clean voice amount',
  input: {
    type: 'object',
    properties: {
      layer: { type: 'string', format: 'layer', layerType: ['audio', 'video'], title: 'Voice' },
      amount: { type: 'number', minimum: 0.05, maximum: 1, default: 0.85, title: 'Amount', description: 'how much of the cleaned voice plays: 0.85 keeps the voice alive, 1 takes all the noise and some of the life' },
    },
  },
  ai: {
    when: 'a voice recorded outside or in a noisy room (wind, traffic, a fan, a hum) before captions and sound design; the check says when a voice\'s floor is high',
    avoid: 'music, effects, or a voice already clean (a studio recording): it can only lose there; an amount of 1 unless asked',
  },
  async run(a, ctx) {
    const c = compOf(ctx);
    const id = a.layer ?? ctx.selection.find((s) => c.layers[s]?.type === 'audio' || c.layers[s]?.type === 'video')
      ?? Object.keys(c.layers).find((s) => c.layers[s].type === 'audio' || c.layers[s].type === 'video');
    const layer: Layer | undefined = id ? c.layers[id] : undefined;
    if (!id || !layer || (layer.type !== 'audio' && layer.type !== 'video')) throw new Error('denoise: a sound or a video layer is expected');
    const asset = String(layer.props?.[layer.type] ?? '');
    const source = ctx.doc.assets[asset];
    if (!source) throw new Error(`${id} plays no file`);
    const amount = Math.min(1, Math.max(0.05, a.amount ?? 0.85));
    const cleanId = `clean-${asset}`.slice(0, 64);
    const had = ctx.doc.assets[cleanId];
    // the file cleaned once: another layer of the same file only takes the link
    if (!had) {
      ctx.progress?.(0, 1, t('denoise.reading'));
      const bytes = await (await fetch(ctx.assetUrl(asset))).arrayBuffer();
      // decoded at RNNoise's rate, every channel
      const buf = await new OfflineAudioContext(1, 1, DENOISE_RATE).decodeAudioData(bytes);
      const out = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: DENOISE_RATE });
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = await rnnoiseFrames();
        try {
          const clean = await denoiseChannel(buf.getChannelData(ch), d.process, async (done, total) => {
            if (ctx.signal.aborted) throw new Error('stopped');
            ctx.progress?.(ch * total + done, buf.numberOfChannels * total, t('denoise.cleaning'));
            await new Promise((r) => setTimeout(r, 0));
          });
          out.copyToChannel(clean as Float32Array<ArrayBuffer>, ch);
        } finally { d.free(); }
      }
      const before = noiseFigures(buf.getChannelData(0), DENOISE_RATE), after = noiseFigures(out.getChannelData(0), DENOISE_RATE);
      const path = await ctx.writeFile(`assets/clean/${asset}.wav`, new Blob([encodeWav(out) as BlobPart], { type: 'audio/wav' }));
      return {
        ops: [
          { op: 'add', path: pointer('assets', cleanId), value: { type: 'audio', src: path, name: `${t('denoise.cleanName')} · ${source.name ?? asset}`, madeBy: [RNNOISE] } },
          { op: 'add', path: pointer('assets', asset, 'clean'), value: cleanId },
          { op: 'add', path: pointer('compositions', ctx.compId, 'layers', id, 'props', 'clean'), value: amount },
        ],
        label: t('denoise.label'), notice: t('denoise.done', { name: layer.name ?? id }),
        text: `${id}: its voice cleaned (${(buf.duration).toFixed(1)} s${before && after ? `; its floor from ${before.floorDb} to ${after.floorDb} dBFS, the voice ${before.snr} → ${after.snr} dB above it` : ''}), saved as ${cleanId}; the layer plays ${Math.round(amount * 100)} % of it with the original (its Clean voice property).`,
      };
    }
    return {
      ops: [
        ...(source.clean === cleanId ? [] : [{ op: 'add' as const, path: pointer('assets', asset, 'clean'), value: cleanId }]),
        { op: 'add', path: pointer('compositions', ctx.compId, 'layers', id, 'props', 'clean'), value: amount },
      ],
      label: t('denoise.label'), notice: t('denoise.done', { name: layer.name ?? id }),
      text: `${id}: its file was cleaned already (${cleanId}); the layer now plays ${Math.round(amount * 100)} % of the cleaned voice.`,
    };
  },
};

export const DENOISE_TOOLS: ToolType[] = [denoise];
