import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROME, launch } from '../../cli/src/browser.ts';

describe.skipIf(!CHROME)('delay, distortion and preserved voice looks', () => {
  let browser: Awaited<ReturnType<typeof launch>>['browser'], page: Awaited<ReturnType<typeof launch>>['page'];
  beforeAll(async () => {
    const bundle = await build({ stdin: { contents: `export { audioEffectChain, clipChain, VOICE_EFFECTS } from '@tramme/render'; export { audioClips } from '@tramme/core'; export { legacyVoice } from './packages/render/test/fixtures/legacy-voice.ts';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'VoiceGraph' });
    ({ browser, page } = await launch());
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const graph = (window as any).VoiceGraph;
      const render = async (config: any) => {
        const ctx = new OfflineAudioContext(2, 48000, 48000), buffer = ctx.createBuffer(2, 48000, 48000);
        for (let c = 0; c < 2; c++) {
          const data = buffer.getChannelData(c);
          if (config.impulse) data[0] = 1;
          else for (let i = 0; i < data.length; i++) data[i] = config.frequency ? 0.3 * Math.sin(2 * Math.PI * config.frequency * i / 48000) : i < 7200 ? 0.15 * Math.sin(2 * Math.PI * 200 * i / 48000 + c * 0.2) + 0.1 * Math.sin(2 * Math.PI * 1000 * i / 48000) + 0.05 * Math.sin(2 * Math.PI * 6200 * i / 48000) : 0;
        }
        let input: AudioNode;
        if (config.old) input = graph.legacyVoice(ctx, config.voice, ctx.destination);
        else if (config.voice && !config.preset) {
          const doc = { assets: { tone: { type: 'audio', src: 'tone.wav' } }, compositions: { main: { duration: 1, layers: { a: { type: 'audio', props: { audio: 'tone', voice: config.voice } } }, order: ['a'] } } };
          input = graph.clipChain(ctx, graph.audioClips(doc, 'main')[0], ctx.destination, 0, 0);
        } else input = graph.audioEffectChain(ctx, config.preset ? graph.VOICE_EFFECTS[config.voice] : config.effects ?? [], ctx.destination, config.tempo ?? null);
        const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(input); source.start();
        return ctx.startRendering();
      };
      (window as any).compareVoices = async (a: any, b: any) => {
        const left = await render(a), right = await render(b);
        const stats = (buffer: AudioBuffer) => {
          const samples = buffer.getChannelData(0);
          return { rms: Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length), peak: samples.reduce((max, x) => Math.max(max, Math.abs(x)), 0), points: [0, 4800, 9600, 12000, 14400, 24000].map((i) => samples[i]), echoes: [4800, 9600, 14400].map((at) => { let peak = 0, frame = 0; for (let i = at - 256; i <= at + 256; i++) if (Math.abs(samples[i]) > peak) { peak = Math.abs(samples[i]); frame = i; } return { peak, frame }; }) };
        };
        let maxError = 0;
        for (let c = 0; c < 2; c++) { const x = left.getChannelData(c), y = right.getChannelData(c); for (let i = 0; i < x.length; i++) maxError = Math.max(maxError, Math.abs(x[i] - y[i])); }
        return { maxError, left: stats(left), right: stats(right) };
      };
    });
  }, 30_000);
  afterAll(async () => { await browser?.close(); });
  const compare = (a: object, b: object) => page.evaluate((x) => (window as any).compareVoices(x.a, x.b), { a, b });

  for (const voice of ['telephone', 'radio', 'megaphone', 'echo']) {
    it(`preserves the legacy ${voice} PCM through its clip name and effect preset`, async () => {
      expect((await compare({ voice, old: true }, { voice })).maxError).toBeLessThan(1e-6);
      expect((await compare({ voice, old: true }, { voice, preset: true })).maxError).toBeLessThan(1e-6);
    });
  }
  it('sets delay time, feedback and wet level at the requested echo positions', async () => {
    const result = await compare({ impulse: true }, { impulse: true, effects: [{ kind: 'delay', time: 100, feedback: 0.5, wet: 1 }] });
    expect(result.left.points[1]).toBe(0);
    expect(result.right.points[0]).toBeCloseTo(1, 3);
    expect(result.right.points[1]).toBeCloseTo(1, 2);
    // Native Web Audio feedback carries one render quantum around the cycle,
    // as in the historical echo. The first reflection is exactly at `time`.
    expect(result.right.echoes.map((echo: { frame: number }) => echo.frame)).toEqual([4800, 9728, 14656]);
    expect(result.right.echoes[1].peak).toBeCloseTo(0.5, 2);
    expect(result.right.echoes[2].peak).toBeCloseTo(0.25, 2);
  });
  it('follows the composition tempo for note-valued delays', async () => {
    const effects = [{ kind: 'delay', time: '1/4', feedback: 0, wet: 1 }];
    const result = await compare({ impulse: true, effects, tempo: 120 }, { impulse: true, effects, tempo: 240 });
    expect(result.left.points[5]).toBeCloseTo(1, 3);
    expect(result.left.points[3]).toBe(0);
    expect(result.right.points[3]).toBeCloseTo(1, 3);
  });
  it('caps feedback even for an unchecked caller and bypasses a note delay without a tempo', async () => {
    const capped = await compare({ impulse: true }, { impulse: true, effects: [{ kind: 'delay', time: 100, feedback: 2, wet: 1 }] });
    expect(capped.right.peak).toBeLessThanOrEqual(1.001);
    const bypassed = await compare({ impulse: true }, { impulse: true, effects: [{ kind: 'delay', time: '1/4', feedback: 0.5, wet: 1, bypass: true }, { kind: 'distortion', drive: 5, tone: 500, wet: 1, bypass: true }] });
    expect(bypassed.maxError).toBe(0);
  });
  it('controls distortion tone and wet amount without changing a dry source', async () => {
    const dry = await compare({ frequency: 6000 }, { frequency: 6000, effects: [{ kind: 'distortion', drive: 5, tone: 500, wet: 0 }] });
    expect(dry.maxError).toBe(0);
    const toned = await compare({ frequency: 6000, effects: [{ kind: 'distortion', drive: 5, tone: 0, wet: 1 }] }, { frequency: 6000, effects: [{ kind: 'distortion', drive: 5, tone: 500, wet: 1 }] });
    expect(toned.right.rms).toBeLessThan(toned.left.rms / 10);
  });
});
