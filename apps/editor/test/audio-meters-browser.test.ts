// The browser enforces node constraints a graph double cannot, and measures
// the actual Web Audio samples. The same Chrome discovery as CLI render tests.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { CHROME, launch } from '../../../packages/cli/src/browser.ts';
import type { LevelReading, MeterTaps } from '../src/audio-meters.ts';
import type { liveMaster as liveMasterBus } from '@tramme/render';

it.skipIf(!CHROME)('meters a real mono and phase-inverted stereo track, silence and a closed panel', async () => {
  const bundle = await build({ stdin: { contents: `export * from './audio-meters.ts'; export { liveMaster } from '@tramme/render';`, resolveDir: fileURLToPath(new URL('../src/', import.meta.url)) }, bundle: true, write: false, format: 'iife', globalName: 'Metering' });
  const { browser, page } = await launch();
  try {
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const { MeterTaps, liveMaster } = (globalThis as unknown as { Metering: { MeterTaps: new () => MeterTaps; liveMaster: typeof liveMasterBus } }).Metering;
      const ctx = new AudioContext({ sampleRate: 48000 });
      try {
        const osc = ctx.createOscillator(), track = ctx.createGain(), mute = ctx.createGain();
        osc.frequency.value = 1000;
        track.gain.value = 0.5;
        mute.gain.value = 0;
        osc.connect(track).connect(mute).connect(ctx.destination);
        const stereo = ctx.createChannelMerger(2), inverse = ctx.createGain();
        inverse.gain.value = -1;
        track.connect(stereo, 0, 0);
        track.connect(inverse).connect(stereo, 0, 1);
        stereo.connect(mute);
        const taps = new MeterTaps();
        taps.source('mono', ctx, track);
        taps.source('stereo', ctx, stereo);
        const master = liveMaster(ctx, mute);
        track.connect(master.input);
        taps.source('$master', ctx, master.output);
        taps.show(true);
        osc.start();
        await ctx.resume();
        while (ctx.currentTime < 3.3) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          taps.read(ctx.currentTime);
        }
        const tone = taps.read(ctx.currentTime);
        track.gain.value = 0;
        await new Promise((resolve) => setTimeout(resolve, 200));
        const silence = taps.read(ctx.currentTime);
        taps.show(false);
        const hidden = taps.read(ctx.currentTime);
        taps.clear();
        osc.stop();
        return { tone, silence, hidden };
      } finally { await ctx.close(); }
    });
    for (const key of ['mono', 'stereo']) {
      const tone: LevelReading = result.tone[key];
      expect(Math.abs(tone.peak - -6.02)).toBeLessThan(0.5);
      expect(Math.abs(tone.rms - -9.03)).toBeLessThan(0.5);
      expect(result.silence[key].peak).toBe(-80);
      expect(result.silence[key].rms).toBe(-80);
    }
    expect(result.hidden).toEqual({});
    expect(Math.abs(result.tone.$master.lufs! - -6.02)).toBeLessThan(0.5);
    expect(Math.abs(result.tone.$master.truePeak! - -6.02)).toBeLessThan(0.5);
  } finally { await browser.close(); }
}, 30_000);
