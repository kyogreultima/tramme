// A pitch shift that keeps the duration (docs/editing-roadmap.md, step 9):
// two read heads sliding through a short delay line at the pitch ratio,
// each faded in and out over its window so neither is heard as it jumps
// back. One function, run by the tests here and, as its source, by the
// AudioWorklet the mixer loads in the live and in the offline context, so
// the preview and the exports sound the same.

/** a pitch shifter for one channel: process(input, output, ratio) fills output from input, the pitch times ratio */
export function createPitchShifter(sampleRate: number, windowSeconds = 0.06) {
  const win = Math.max(64, Math.round(sampleRate * windowSeconds)), size = win * 4;
  const line = new Float32Array(size);
  let write = 0, phase = 0;
  const read = (pos: number) => {
    const p = ((pos % size) + size) % size, i = Math.floor(p), f = p - i;
    return line[i] * (1 - f) + line[(i + 1) % size] * f;
  };
  return {
    process(input: Float32Array, output: Float32Array, ratio: number) {
      // the delay of the first head runs from win down to 0 (pitch up) or 0 up to win (pitch down), the second half a window apart
      const step = 1 - ratio;
      for (let n = 0; n < input.length; n++) {
        line[write] = input[n];
        phase = (((phase + step) % win) + win) % win;
        const d1 = phase, d2 = (phase + win / 2) % win;
        // a raised cosine over each head's window: silent at its jump, full halfway
        const g1 = 0.5 - 0.5 * Math.cos((2 * Math.PI * d1) / win), g2 = 0.5 - 0.5 * Math.cos((2 * Math.PI * d2) / win);
        output[n] = ratio === 1 ? input[n] : read(write - d1) * g1 + read(write - d2) * g2;
        write = (write + 1) % size;
      }
    },
  };
}

/** the AudioWorklet module: the shifter above, per channel, its ratio an audio parameter (a speed curve follows it) */
export const PITCH_WORKLET = `const createPitchShifter = ${createPitchShifter.toString()};
class TrammePitch extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor() { super(); this.shifters = []; }
  process(inputs, outputs, parameters) {
    const input = inputs[0], output = outputs[0], ratio = parameters.ratio[0];
    for (let c = 0; c < output.length; c++) {
      const src = input[c] || input[0];
      if (!src) { output[c].fill(0); continue; }
      this.shifters[c] = this.shifters[c] || createPitchShifter(sampleRate);
      this.shifters[c].process(src, output[c], ratio);
    }
    return true;
  }
}
registerProcessor('tramme-pitch', TrammePitch);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** the worklet loaded in this context (once): the live preview's and each offline mix's */
export function loadPitch(ctx: BaseAudioContext): Promise<void> {
  let p = loaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([PITCH_WORKLET], { type: 'text/javascript' }));
    p = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    loaded.set(ctx, p);
  }
  return p;
}
