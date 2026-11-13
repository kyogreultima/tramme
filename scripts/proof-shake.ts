// How much a clip shakes, for the stabilisation proof (docs/proofs-roadmap.md):
//   node scripts/proof-shake.ts <video> [--seconds 8] [--start 0]
// The clip decoded small (320 px wide, grey), the picture's shift from each
// frame to the next found by block matching over its middle, the shifts
// summed into the camera's path, the path smoothed over half a second (the
// move meant), and the shake given as what is left: the mean distance, in
// pixels of a 1920-wide frame, between the path and its smoothed self.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ffmpeg: string = createRequire(path.join(ROOT, 'packages/cli/package.json'))('ffmpeg-static');

export function shake(file: string, seconds = 8, start = 0): { jitter: number; frames: number } {
  const W = 320, H = 180, fps = 24;
  const raw = execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-t', String(seconds), '-i', file, '-vf', `fps=${fps},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  const n = Math.floor(raw.length / (W * H));
  const frame = (i: number) => raw.subarray(i * W * H, (i + 1) * W * H);
  const R = 14, x0 = 40, y0 = 30, x1 = W - 40, y1 = H - 30;
  const path_: [number, number][] = [[0, 0]];
  for (let i = 1; i < n; i++) {
    const a = frame(i - 1), b = frame(i);
    const sadAt = (dx: number, dy: number) => {
      let sad = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) sad += Math.abs(a[y * W + x] - b[(y + dy) * W + x + dx]);
      return sad;
    };
    let best = Infinity, bx = 0, by = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const sad = sadAt(dx, dy);
      if (sad < best) { best = sad; bx = dx; by = dy; }
    }
    // below the pixel: a parabola through the match and its two neighbours, on each axis
    const sub = (m: number, c: number, p: number) => { const d = m - 2 * c + p; return d > 0 ? Math.max(-0.5, Math.min(0.5, (m - p) / (2 * d))) : 0; };
    const fx = Math.abs(bx) < R ? sub(sadAt(bx - 1, by), best, sadAt(bx + 1, by)) : 0;
    const fy = Math.abs(by) < R ? sub(sadAt(bx, by - 1), best, sadAt(bx, by + 1)) : 0;
    const [px, py] = path_[i - 1];
    path_.push([px + bx + fx, py + by + fy]);
  }
  // the move meant: the path averaged over half a second
  const k = Math.round(fps / 4);
  let sum = 0;
  for (let i = 0; i < path_.length; i++) {
    let mx = 0, my = 0, c = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(path_.length - 1, i + k); j++) { mx += path_[j][0]; my += path_[j][1]; c++; }
    sum += Math.hypot(path_[i][0] - mx / c, path_[i][1] - my / c);
  }
  return { jitter: +((sum / path_.length) * (1920 / W)).toFixed(1), frames: n };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = process.argv.slice(2), flag = (f: string, d: number) => { const i = args.indexOf(`--${f}`); return i >= 0 ? Number(args[i + 1]) : d; };
  const file = args.find((a) => !a.startsWith('--') && !/^\d/.test(a));
  if (!file) { console.error('usage: node scripts/proof-shake.ts <video> [--seconds 8] [--start 0]'); process.exit(1); }
  console.log(JSON.stringify(shake(file, flag('seconds', 8), flag('start', 0))));
}
