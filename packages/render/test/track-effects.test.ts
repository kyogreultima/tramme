// Real Web Audio comparisons: the old clip path, ordered track inserts,
// bus sums and the complete export all receive identical decoded samples.
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROME, launch } from '../../cli/src/browser.ts';

describe.skipIf(!CHROME)('ordered track audio effects', () => {
  let browser: Awaited<ReturnType<typeof launch>>['browser'];
  let page: Awaited<ReturnType<typeof launch>>['page'];
  beforeAll(async () => {
    const bundle = await build({ stdin: { contents: `export { audioEffectChain, mixTracks, clipChain, mixBus, playClip, encodeWav, mixComposition } from '@tramme/render'; export { audioClips, soundMix } from '@tramme/core';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'AudioGraph' });
    ({ browser, page } = await launch());
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const graph = (window as any).AudioGraph;
      const render = async (config: any) => {
        const ctx = new OfflineAudioContext(2, 48000, 48000);
        const buffer = ctx.createBuffer(2, 48000, 48000);
        for (let c = 0; c < 2; c++) {
          const data = buffer.getChannelData(c);
          for (let i = 0; i < data.length; i++) data[i] = 0.7 * Math.sin(2 * Math.PI * 1000 * i / 48000);
        }
        const wav = graph.encodeWav(buffer);
        const decoded = await ctx.decodeAudioData(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength));
        const tracks = [
          { id: 'A1', kind: 'audio', to: 'B1', volume: config.legacyProps ? -3 : 0, pan: config.legacyProps ? 0.25 : 0 },
          { id: 'A2', kind: 'audio', to: 'B1', volume: config.legacyProps ? -2 : 0, pan: config.legacyProps ? -0.3 : 0 },
          { id: 'B1', kind: 'audio', bus: true, volume: config.legacyProps ? -1 : 0, pan: config.legacyProps ? 0.1 : 0 },
        ].map((track) => ({ ...track, ...(config.effects?.[track.id] ? { effects: config.effects[track.id] } : {}) }));
        const legacy = config.legacyProps ? { lowCut: 80, highCut: 12000, eqLow: 3, eqMid: -2, eqMidFreq: 1500, eqHigh: 1, compress: 0.2, reverb: 0.15, fadeIn: 0.02, fadeOut: 0.03 } : {};
        const layers: any = { a: { type: 'audio', track: 'A1', out: config.short ? 0.1 : 1, props: { audio: 'tone', role: 'voice', ...legacy, gain: config.gain ?? 0 } } };
        if (config.two) layers.b = { type: 'audio', track: config.sameTrack ? 'A1' : 'A2', props: { audio: 'tone', role: config.legacyProps ? 'effect' : 'voice', ...legacy } };
        const doc = { schema: 'tramme/1', meta: { title: 'Sound' }, tokens: {}, root: 'main', assets: { tone: { type: 'audio', src: 'tone.wav' } }, compositions: { main: { name: 'Main', kind: 'sequence', width: 10, height: 10, fps: 30, duration: 1, tracks, layers, order: Object.keys(layers), sound: { loudness: null, room: config.legacyProps ? 0.3 : 0 } } } };
        if (config.export) {
          const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
          try { return await graph.mixComposition(doc, 'main', () => url, { master: false }); }
          finally { URL.revokeObjectURL(url); }
        }
        const route = config.old ? graph.mixBus(ctx, graph.soundMix(doc.compositions.main), ctx.destination) : graph.mixTracks(ctx, doc, 'main', ctx.destination);
        for (const clip of graph.audioClips(doc, 'main')) graph.playClip(ctx, clip, decoded, route(clip), 0, 0);
        return ctx.startRendering();
      };
      (window as any).compareAudio = async (a: any, b: any) => {
        const left = await render(a), right = await render(b);
        let maxError = 0;
        for (let c = 0; c < 2; c++) {
          const x = left.getChannelData(c), y = right.getChannelData(c);
          for (let i = 0; i < x.length; i++) maxError = Math.max(maxError, Math.abs(x[i] - y[i]));
        }
        const rms = (buffer: AudioBuffer) => { const samples = buffer.getChannelData(0).subarray(24000); return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length); };
        return { maxError, left: rms(left), right: rms(right) };
      };
    });
  }, 30_000);
  afterAll(async () => { await browser?.close(); });
  const compare = (a: object, b: object) => page.evaluate((x) => (window as any).compareAudio(x.a, x.b), { a, b });
  const eq = { kind: 'eq', low: 0, mid: -18, midFreq: 1000, midQ: 0.9, high: 0 };
  const compressor = { kind: 'compressor', amount: 0.8 };

  it('keeps all legacy clip settings, pan, track/bus faders and the shared room', async () => {
    expect((await compare({ old: true, legacyProps: true, two: true }, { legacyProps: true, two: true })).maxError).toBeLessThan(1e-6);
  });
  it('bypasses every track and bus insert without changing the old mix', async () => {
    const effects = { A1: [{ ...eq, bypass: true }, { ...compressor, bypass: true }], B1: [{ kind: 'reverb', wet: 0.8, bypass: true }] };
    expect((await compare({ old: true, legacyProps: true, two: true }, { legacyProps: true, two: true, effects })).maxError).toBeLessThan(1e-6);
  });
  it('changes the sound when a compressor and EQ exchange places', async () => {
    const result = await compare({ effects: { A1: [eq, compressor] } }, { effects: { A1: [compressor, eq] } });
    expect(Math.abs(result.left - result.right)).toBeGreaterThan(0.01);
  });
  it('compresses the summed track once, not each source separately', async () => {
    const effects = { A1: [compressor] };
    expect((await compare({ effects, two: true, sameTrack: true }, { effects, gain: 20 * Math.log10(2) })).maxError).toBeLessThan(1e-5);
  });
  it('applies a bus chain to every track feeding it', async () => {
    const result = await compare({ two: true }, { two: true, effects: { B1: [{ kind: 'highCut', frequency: 100 }] } });
    expect(result.right).toBeLessThan(result.left / 20);
  });
  it('renders the same graph in the complete export as in preview scheduling', async () => {
    const config = { legacyProps: true, two: true, effects: { A1: [compressor, eq], B1: [{ kind: 'lowCut', frequency: 120 }] } };
    expect((await compare(config, { ...config, export: true })).maxError).toBeLessThan(1e-6);
  });
  it('keeps a track reverb tail after its clips have stopped', async () => {
    const result = await compare({ short: true }, { short: true, effects: { A1: [{ kind: 'reverb', wet: 0.5 }] } });
    expect(result.left).toBe(0);
    expect(result.right).toBeGreaterThan(1e-4);
  });
});
