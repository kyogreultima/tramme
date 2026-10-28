// Matching the look of a shot to another's: the mean and the spread of each
// colour in a picture, and the colour wheels (fx.wheels: lift, gamma, gain)
// that bring one picture's to the other's. The wheels stay the effect's own
// properties, visible and editable: nothing is baked into the footage.

export interface LookStats {
  /** each colour's average, 0 to 1 */
  mean: [number, number, number];
  /** each colour's standard deviation */
  std: [number, number, number];
}

/** the properties of fx.wheels */
export interface WheelsParams {
  lift: [number, number];
  liftLevel: number;
  gamma: [number, number];
  gammaLevel: number;
  gain: [number, number];
  gainLevel: number;
}

type Rgb = [number, number, number];
const LUMA: Rgb = [0.2126, 0.7152, 0.0722];
const dot = (a: Rgb, b: Rgb) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** the mean and the spread of each colour of RGBA pixels (bytes), the transparent ones left out */
export function lookStatsOf(rgba: ArrayLike<number>): LookStats {
  const sum = [0, 0, 0], sq = [0, 0, 0];
  let n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) { const v = rgba[i + c] / 255; sum[c] += v; sq[c] += v * v; }
    n++;
  }
  if (!n) return { mean: [0, 0, 0], std: [0, 0, 0] };
  const mean = sum.map((s) => s / n) as Rgb;
  return { mean, std: sq.map((s, c) => Math.sqrt(Math.max(0, s / n - mean[c] * mean[c]))) as Rgb };
}

/** a wheel's colour: its hue at full saturation made neutral in brightness, times its amount (the effect's own `tint`) */
function tint(w: [number, number]): Rgb {
  const k = Math.min(Math.hypot(w[0], w[1]), 1);
  if (k <= 0) return [0, 0, 0];
  const h = Math.atan2(w[1], w[0]) / (2 * Math.PI);
  const c = [0, 4, 2].map((o) => { const x = h * 6 + o; return clamp(Math.abs(x - 6 * Math.floor(x / 6) - 3) - 1, 0, 1); }) as Rgb;
  const y = dot(c, LUMA);
  return [(c[0] - y) * k, (c[1] - y) * k, (c[2] - y) * k];
}

/** a colour through the wheels, as the effect's shader does it */
export function wheelsApply(c: Rgb, p: WheelsParams): Rgb {
  const lt = tint(p.lift), gt = tint(p.gain), mt = tint(p.gamma);
  return c.map((v, i) => {
    const lift = p.liftLevel + lt[i] * 0.25, gain = 1 + p.gainLevel + gt[i] * 0.5, gamma = Math.max(0.05, 1 + p.gammaLevel + mt[i] * 0.5);
    return Math.pow(clamp(gain * (v + lift * (1 - v)), 0, 1), 1 / gamma);
  }) as Rgb;
}

/** the wheel position whose tint is closest to a colour offset that has no brightness in it (the amount cut at the wheel's edge) */
function wheelFor(chroma: Rgb): [number, number] {
  let best = 0, bestScore = 0, bestK = 0;
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * 2 * Math.PI, u = tint([Math.cos(a), Math.sin(a)]), uu = dot(u, u), vu = dot(chroma, u);
    if (uu < 1e-12 || vu <= 0) continue;
    // the residual of v − k·u is smallest where (v·u)² / |u|² is greatest
    const score = (vu * vu) / uu;
    if (score > bestScore) { bestScore = score; best = a; bestK = vu / uu; }
  }
  const k = clamp(bestK, 0, 1);
  return k > 0 ? [+(Math.cos(best) * k).toFixed(4), +(Math.sin(best) * k).toFixed(4)] : [0, 0];
}

/** a colour offset split into its brightness and the colour left */
function split(v: Rgb): { level: number; chroma: Rgb } {
  const level = dot(v, LUMA);
  return { level, chroma: [v[0] - level, v[1] - level, v[2] - level] };
}

/**
 * The wheels that bring a shot's look to a reference's: for each colour the
 * line y = a·x + b that sends the shot's mean and spread to the reference's,
 * read as gain and lift (gain·(x + lift·(1 − x))), then split into a brightness
 * (the level) and a colour (the wheel). Gamma is left alone. A look too far to
 * reach is brought as near as the wheels go.
 */
export function matchGrade(ref: LookStats, src: LookStats): WheelsParams {
  const gain: Rgb = [1, 1, 1], lift: Rgb = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = src.std[c] > 1e-4 ? ref.std[c] / src.std[c] : 1, b = ref.mean[c] - a * src.mean[c];
    gain[c] = Math.max(0.05, a + b);
    lift[c] = b / gain[c];
  }
  const g = split([gain[0] - 1, gain[1] - 1, gain[2] - 1]), l = split(lift);
  const round = (x: number) => +x.toFixed(4) || 0;
  return {
    lift: wheelFor(l.chroma.map((x) => x / 0.25) as Rgb),
    liftLevel: round(clamp(l.level, -0.5, 0.5)),
    gamma: [0, 0],
    gammaLevel: 0,
    gain: wheelFor(g.chroma.map((x) => x / 0.5) as Rgb),
    gainLevel: round(clamp(g.level, -1, 1)),
  };
}
