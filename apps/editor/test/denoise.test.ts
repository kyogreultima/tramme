import { describe, expect, it } from 'vitest';
import { denoiseChannel, noiseFigures } from '@tramme/core';
import { rnnoiseFrames } from '../src/denoise.ts';

/** a voice-like sound (a buzz with its harmonics, gliding, in bursts) over white noise */
function take(seconds: number, rate = 48000) {
  const x = new Float32Array(seconds * rate), clean = new Float32Array(x.length);
  let s = 3;
  for (let i = 0; i < x.length; i++) {
    const t = i / rate, on = Math.floor(t * 2) % 2 === 0 ? 1 : 0;
    let v = 0;
    for (let h = 1; h < 8; h++) v += Math.sin(2 * Math.PI * h * (120 * t + 30 * t * t)) / h;
    s = (s * 1664525 + 1013904223) >>> 0;
    clean[i] = 0.2 * on * v;
    x[i] = clean[i] + 0.03 * ((s / 2 ** 32) * 2 - 1);
  }
  return { x, clean };
}

describe('RNNoise, compiled to WebAssembly', () => {
  it('takes the noise out between the words, keeps the voice in step with its source', async () => {
    const { x, clean } = take(3);
    const d = await rnnoiseFrames();
    const y = await denoiseChannel(x, d.process);
    d.free();
    const before = noiseFigures(x, 48000)!, after = noiseFigures(y, 48000)!;
    expect(after.floorDb).toBeLessThan(before.floorDb - 20);
    // in step: the voice best matches its clean self with no shift
    const corr = (lag: number) => { let s = 0; for (let i = 2000; i < x.length - 2000; i += 3) s += clean[i] * y[i + lag]; return s; };
    const best = [-480, -240, -96, -48, 0, 48, 96, 240, 480].reduce((a, b) => (corr(b) > corr(a) ? b : a));
    expect(best).toBe(0);
  }, 30_000);
});
