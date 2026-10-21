// A clean voice (docs/editing-roadmap.md, step 10): the pure parts. The
// denoiser itself (RNNoise, compiled to WebAssembly) runs in the editor at
// authoring time on 10 ms frames; here, a whole channel through it with its
// delay taken back, and the figures that say a voice is noisy: its level
// while it speaks against the floor between its words.

/** RNNoise's frame, rate and delay (samples at 48 kHz): its output runs two frames behind its input */
export const DENOISE_RATE = 48000;
export const DENOISE_FRAME = 480;
export const DENOISE_DELAY = 960;

/** one 10 ms frame cleaned: input and output in -1..1, DENOISE_FRAME long */
export type FrameDenoiser = (input: Float32Array, output: Float32Array) => void;

/**
 * A channel at 48 kHz through a frame denoiser, aligned on its input (the
 * denoiser's delay taken back): the same length, the same timing, so the
 * cleaned file plays in step with its source. `step` is called between
 * frames (progress, a pause for the page, a stop).
 */
export async function denoiseChannel(x: Float32Array, process: FrameDenoiser, step?: (done: number, total: number) => Promise<void> | void): Promise<Float32Array> {
  const total = x.length + DENOISE_DELAY, frames = Math.ceil(total / DENOISE_FRAME);
  const out = new Float32Array(x.length), inp = new Float32Array(DENOISE_FRAME), res = new Float32Array(DENOISE_FRAME);
  for (let f = 0; f < frames; f++) {
    const a = f * DENOISE_FRAME;
    inp.fill(0);
    if (a < x.length) inp.set(x.subarray(a, Math.min(x.length, a + DENOISE_FRAME)));
    process(inp, res);
    // output sample j of this frame is input sample a + j - DELAY
    for (let j = 0; j < DENOISE_FRAME; j++) {
      const k = a + j - DENOISE_DELAY;
      if (k >= 0 && k < out.length) out[k] = res[j];
    }
    if (step && f % 200 === 199) await step(f + 1, frames);
  }
  return out;
}

export interface NoiseFigures {
  /** the voice's level while it speaks (the loud tenth of its 50 ms frames), dBFS */
  speechDb: number;
  /** the floor between its words (the quiet tenth, digital silence left out), dBFS */
  floorDb: number;
  /** how far the voice stands above its floor (dB) */
  snr: number;
}

/** how noisy a voice is: the level of its speech against its floor, from 50 ms frames */
export function noiseFigures(x: Float32Array, rate: number): NoiseFigures | null {
  const hop = Math.max(1, Math.round(rate * 0.05)), db: number[] = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += x[j] * x[j];
    const v = 10 * Math.log10(s / hop + 1e-20);
    // digital silence (an edit, a pause made in the file) is no floor
    if (v > -90) db.push(v);
  }
  if (db.length < 20) return null;
  db.sort((a, b) => a - b);
  const at = (q: number) => db[Math.min(db.length - 1, Math.floor(q * db.length))];
  const speechDb = at(0.9), floorDb = at(0.1);
  return { speechDb: +speechDb.toFixed(1), floorDb: +floorDb.toFixed(1), snr: +(speechDb - floorDb).toFixed(1) };
}

/** below this distance between the speech and its floor, a voice sounds recorded in noise */
export const NOISY_SNR = 30;
