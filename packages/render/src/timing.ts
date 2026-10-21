// Where a frame's time goes (docs/performance-roadmap.md, step 1): the parts
// of an exported frame measured apart, added up over a run and printed next
// to the total. The GPU works asynchronously: what it does for a frame is
// paid when the pixels are read back, so its time lands in `readback`.

export interface FrameParts {
  /** the Evaluator: the document's values at each sub-frame time */
  evaluate: number;
  /** the layers drawn on the Canvas 2D scene, accumulated and finished on the GPU (commands sent) */
  draw: number;
  /** waiting for video frames being decoded (or a plugin's picture) */
  video: number;
  /** the GPU finishing the frame and handing back its YUV or RGBA bytes */
  readback: number;
  /** waiting for the previous frame to be taken by the encoder */
  send: number;
}

export const PARTS = ['evaluate', 'draw', 'video', 'readback', 'send'] as const satisfies readonly (keyof FrameParts)[];

export const noParts = (): FrameParts => ({ evaluate: 0, draw: 0, video: 0, readback: 0, send: 0 });

/** adds b to a, in place */
export function addParts(a: FrameParts, b: Partial<FrameParts>): FrameParts {
  for (const k of PARTS) a[k] += b[k] ?? 0;
  return a;
}

/** the parts per frame over n frames */
export function perFrame(parts: FrameParts, n: number): FrameParts {
  const out = noParts();
  for (const k of PARTS) out[k] = parts[k] / Math.max(1, n);
  return out;
}

/** "evaluate 3 · draw 12 · video 0 · readback 4 · send 1 ms", per frame over n frames */
export function formatParts(parts: FrameParts, n = 1): string {
  const p = perFrame(parts, n);
  return `${PARTS.map((k) => `${k} ${p[k] < 10 ? p[k].toFixed(1) : p[k].toFixed(0)}`).join(' · ')} ms`;
}

/** the part that takes the most time */
export function bottleneck(parts: FrameParts): keyof FrameParts {
  return PARTS.reduce((a, b) => (parts[b] > parts[a] ? b : a));
}

/** what a part stands for, in the words of the roadmap: what holds an export back */
export const CAUSE: Record<keyof FrameParts, string> = {
  evaluate: 'the JavaScript', draw: 'the JavaScript', video: 'video decoding', readback: 'the GPU', send: 'the transfer',
};
