// The film's rhythm, measured on its rendered frames: how long nothing moves,
// how much of the frame the subject takes, how many different pictures it
// shows. Measured on pixels, so it holds for any layer, plugin or video.

import { canvas } from '../perception.ts';

/** a frame at the measuring size: RGBA, row by row */
export interface Frame { t: number; data: Uint8ClampedArray | Uint8Array; width: number; height: number }

export interface Rhythm {
  seconds: number;
  /** the frames measured per second */
  rate: number;
  /** the share of the film where nothing moves, its closing hold left out (0 to 1) */
  still: number;
  /** the longest stretch where nothing moves, its closing hold left out */
  frozen: { from: number; to: number } | null;
  /** the mean share of the frame inside the box of what stands out from the background (0 to 1) */
  subject: number;
  /** how many different pictures the film shows */
  looks: number;
}

/** the width frames are measured at */
export const RHYTHM_WIDTH = 96;
/** at most this many frames are measured, whatever the length */
const MOST = 160;
/** a mean change under this between two frames (0 to 255) is nothing moving */
const STILL = 0.8;
/** a pixel this far from the background colour stands out (sum of the three channels) */
const STANDS_OUT = 60;
/** two pictures this far apart (mean, 0 to 255, at 16 by 9) are different looks */
const ANOTHER_LOOK = 28;
/** the closing hold a film may keep still (s) */
export const CLOSING_HOLD = 2.5;

/** the times to measure: up to four a second, at most MOST in all */
export function rhythmTimes(duration: number): number[] {
  if (!(duration > 0)) return [];
  const rate = Math.min(4, Math.max(0.5, MOST / duration));
  return Array.from({ length: Math.floor(duration * rate) }, (_, i) => i / rate);
}

const diff = (a: Frame, b: Frame) => {
  let s = 0;
  for (let i = 0; i < a.data.length; i += 4) s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  return s / ((a.data.length / 4) * 3);
};

/** the share of the frame in the box of what stands out from its most common colour */
function subjectBox(f: Frame): number {
  const counts = new Map<number, number>(), n = f.width * f.height;
  for (let i = 0; i < f.data.length; i += 4) { const k = ((f.data[i] >> 5) << 6) | ((f.data[i + 1] >> 5) << 3) | (f.data[i + 2] >> 5); counts.set(k, (counts.get(k) ?? 0) + 1); }
  let bg = 0, most = -1;
  for (const [k, c] of counts) if (c > most) { most = c; bg = k; }
  let r = 0, g = 0, b = 0, m = 0;
  for (let i = 0; i < f.data.length; i += 4) if ((((f.data[i] >> 5) << 6) | ((f.data[i + 1] >> 5) << 3) | (f.data[i + 2] >> 5)) === bg) { r += f.data[i]; g += f.data[i + 1]; b += f.data[i + 2]; m++; }
  r /= m; g /= m; b /= m;
  let x0 = f.width, y0 = f.height, x1 = -1, y1 = -1, seen = 0;
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
    const i = (y * f.width + x) * 4;
    if (Math.abs(f.data[i] - r) + Math.abs(f.data[i + 1] - g) + Math.abs(f.data[i + 2] - b) > STANDS_OUT) { seen++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return seen < n / 500 ? 0 : ((x1 - x0 + 1) * (y1 - y0 + 1)) / n;
}

/** a frame brought down to 16 by 9 cells, for telling looks apart */
function cells(f: Frame): number[] {
  const out: number[] = [];
  for (let cy = 0; cy < 9; cy++) for (let cx = 0; cx < 16; cx++) {
    const xa = Math.floor((cx * f.width) / 16), xb = Math.floor(((cx + 1) * f.width) / 16), ya = Math.floor((cy * f.height) / 9), yb = Math.floor(((cy + 1) * f.height) / 9);
    let r = 0, g = 0, b = 0, k = 0;
    for (let y = ya; y < Math.max(yb, ya + 1); y++) for (let x = xa; x < Math.max(xb, xa + 1); x++) { const i = (y * f.width + x) * 4; r += f.data[i]; g += f.data[i + 1]; b += f.data[i + 2]; k++; }
    out.push(r / k, g / k, b / k);
  }
  return out;
}

/** the rhythm of frames sampled evenly across a film of this length */
export function rhythmOf(frames: Frame[], seconds: number): Rhythm {
  const rate = frames.length > 1 ? 1 / (frames[1].t - frames[0].t) : 0;
  const end = seconds - CLOSING_HOLD;
  let stillTime = 0, measured = 0, run: number | null = null;
  const longest = { from: 0, to: 0 };
  const close = (to: number) => { if (run !== null && to - run > longest.to - longest.from) Object.assign(longest, { from: run, to }); run = null; };
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if (b.t > end) break;
    measured += b.t - a.t;
    if (diff(a, b) < STILL) { stillTime += b.t - a.t; run ??= a.t; } else close(a.t);
  }
  close(Math.min(end, frames.at(-1)?.t ?? 0));
  const looks: number[][] = [];
  for (const f of frames) { const c = cells(f); if (looks.every((l) => l.reduce((s, v, i) => s + Math.abs(v - c[i]), 0) / c.length > ANOTHER_LOOK)) looks.push(c); }
  return {
    seconds, rate,
    still: measured ? stillTime / measured : 0,
    frozen: longest.to > longest.from ? longest : null,
    subject: frames.length ? frames.reduce((s, f) => s + subjectBox(f), 0) / frames.length : 0,
    looks: looks.length,
  };
}

/** a rendered picture (a data URL or a blob) at the measuring size */
async function frameOf(t: number, picture: string | Blob): Promise<Frame> {
  const blob = typeof picture === 'string' ? await (await fetch(picture)).blob() : picture;
  const bitmap = await createImageBitmap(blob);
  try {
    const height = Math.max(1, Math.round((RHYTHM_WIDTH * bitmap.height) / bitmap.width)), { g } = canvas(RHYTHM_WIDTH, height);
    g.drawImage(bitmap, 0, 0, RHYTHM_WIDTH, height);
    return { t, data: g.getImageData(0, 0, RHYTHM_WIDTH, height).data, width: RHYTHM_WIDTH, height };
  } finally { bitmap.close(); }
}

/** the rhythm of a film, its frames drawn by the given renderer */
export async function measureRhythm(duration: number, render: (t: number) => Promise<string | Blob | null>, signal?: AbortSignal): Promise<Rhythm> {
  const frames: Frame[] = [];
  for (const t of rhythmTimes(duration)) {
    if (signal?.aborted) throw new Error('stopped');
    const picture = await render(t);
    if (picture) frames.push(await frameOf(t, picture));
  }
  return rhythmOf(frames, duration);
}

/** the gates of the rhythm: a film is not done while one of them holds */
export const FROZEN_MOST = 4;
export const STILL_MOST = 0.5;
/** under this share of the frame, the subject reads small */
export const SUBJECT_LEAST = 0.3;

/** what the rhythm says, as lines: the defects first (blocking), then what the critic weighs */
export function rhythmLines(r: Rhythm): { defects: string[]; facts: string[] } {
  const defects: string[] = [], facts: string[] = [];
  const s = (x: number) => `${x.toFixed(1)} s`;
  if (r.frozen && r.frozen.to - r.frozen.from >= FROZEN_MOST) defects.push(`nothing moves for ${s(r.frozen.to - r.frozen.from)}, from ${s(r.frozen.from)} to ${s(r.frozen.to)}: something new must happen at least every 2 to 4 s (a move, a change of scale, a new element, a cut)`);
  if (r.still > STILL_MOST) defects.push(`the film stands still ${Math.round(r.still * 100)} % of its time (its closing hold left out): give the holds a slow drift, a build or a change, and cut the dead time`);
  if (r.subject > 0 && r.subject < SUBJECT_LEAST) facts.push(`what stands out from the background fills ${Math.round(r.subject * 100)} % of the frame on average: the subject reads small; let it fill the frame, go closer, crop it at the edges or set scales against each other`);
  if (r.looks <= 1 && r.seconds > 6) facts.push(`the whole film is one picture (one composition from start to end): change the framing, the scale or the scene as the idea moves on`);
  facts.push(`Rhythm measured on ${Math.round(r.seconds * r.rate)} frames: still ${Math.round(r.still * 100)} %, longest still ${r.frozen ? s(r.frozen.to - r.frozen.from) : '0 s'}, subject ${Math.round(r.subject * 100)} % of the frame, ${r.looks} different picture(s).`);
  return { defects, facts };
}
