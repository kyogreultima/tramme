import { describe, expect, it } from 'vitest';
import { audioClips, DENOISE_DELAY, DENOISE_FRAME, denoiseChannel, noiseFigures, validate, type TrammeDoc } from '../src/index.ts';
import { registry } from './fixtures.ts';

/** a buzz in bursts (a voice, for the figures) over white noise */
function voice(seconds: number, noise: number, rate = 48000): Float32Array {
  const x = new Float32Array(seconds * rate);
  let s = 7;
  for (let i = 0; i < x.length; i++) {
    const t = i / rate, on = Math.floor(t * 2) % 2 === 0 ? 1 : 0;
    s = (s * 1664525 + 1013904223) >>> 0;
    x[i] = 0.25 * on * Math.sin(2 * Math.PI * 160 * t) + noise * ((s / 2 ** 32) * 2 - 1);
  }
  return x;
}

describe('a clean voice', () => {
  it('takes the denoiser\'s delay back: the cleaned channel is in step with its source', async () => {
    // a denoiser that only delays, as RNNoise does: the output is the input again
    const line = new Float32Array(DENOISE_FRAME * 4);
    const delaying = (inp: Float32Array, out: Float32Array) => {
      line.copyWithin(0, DENOISE_FRAME);
      line.set(inp, line.length - DENOISE_FRAME);
      out.set(line.subarray(line.length - DENOISE_FRAME - DENOISE_DELAY, line.length - DENOISE_DELAY));
    };
    const x = voice(1, 0.01), y = await denoiseChannel(x, delaying);
    expect(y.length).toBe(x.length);
    let worst = 0;
    for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(x[i] - y[i]));
    expect(worst).toBe(0);
  });

  it('tells a noisy voice from a clean one by its floor', () => {
    const noisy = noiseFigures(voice(4, 0.02), 48000)!, clean = noiseFigures(voice(4, 0.0005), 48000)!;
    expect(noisy.snr).toBeLessThan(30);
    expect(clean.snr).toBeGreaterThan(40);
    expect(noisy.floorDb).toBeGreaterThan(clean.floorDb + 20);
    // digital silence is no floor
    expect(noiseFigures(new Float32Array(48000), 48000)).toBeNull();
  });

  it('plays the cleaned voice beside its source, by the layer\'s amount', () => {
    const doc: TrammeDoc = {
      schema: 'tramme/1', meta: { title: 'clean' }, tokens: {}, root: 'main',
      assets: { take: { type: 'audio', src: 'take.wav', clean: 'clean-take' }, 'clean-take': { type: 'audio', src: 'clean.wav' } },
      compositions: { main: { name: 'M', width: 100, height: 100, fps: 30, duration: 4, order: ['v'], layers: { v: { type: 'audio', props: { audio: 'take', gain: -3, clean: 0.8 } } } } },
    };
    const clips = audioClips(doc, 'main');
    expect(clips.map((c) => [c.asset, +c.gainDb.toFixed(2)])).toEqual([['take', +(-3 + 20 * Math.log10(0.2)).toFixed(2)], ['clean-take', +(-3 + 20 * Math.log10(0.8)).toFixed(2)]]);
    // all cleaned: the cleaned one alone; none: the original alone
    doc.compositions.main.layers.v.props!.clean = 1;
    expect(audioClips(doc, 'main').map((c) => [c.asset, c.gainDb])).toEqual([['clean-take', -3]]);
    doc.compositions.main.layers.v.props!.clean = 0;
    expect(audioClips(doc, 'main').map((c) => c.asset)).toEqual(['take']);
  });

  it('validates the link to the cleaned voice', () => {
    const doc = { schema: 'tramme/1', meta: { title: 'x' }, tokens: {}, root: 'main', assets: { take: { type: 'audio', src: 'a.wav', clean: 'pic' }, pic: { type: 'image', src: 'p.png' } }, compositions: { main: { name: 'M', width: 10, height: 10, fps: 30, duration: 1, layers: {}, order: [] } } };
    expect(validate(doc, registry()).map((i) => i.path)).toEqual(['/assets/take/clean']);
  });
});
