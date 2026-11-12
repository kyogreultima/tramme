// Colour spaces for grading: the gamuts cameras record in, the curves
// their log footage is written with, and the matrices between gamuts. The
// grading effects (fx.grade and the others, packages/nodes) read footage
// through these: a clip shot in S-Log3 is brought to scene light (linear,
// Rec.709 primaries) before it is graded, then mapped to the screen.
// The GLSL of the effects mirrors these functions; the tests check both.

export type Mat3 = [number, number, number, number, number, number, number, number, number];
type Xy = [number, number];

/** a gamut: its three primaries and its white, CIE xy */
export interface Gamut { r: Xy; g: Xy; b: Xy; white: Xy }

const D65: Xy = [0.3127, 0.329];

export const GAMUTS = {
  rec709: { r: [0.64, 0.33], g: [0.3, 0.6], b: [0.15, 0.06], white: D65 },
  rec2020: { r: [0.708, 0.292], g: [0.17, 0.797], b: [0.131, 0.046], white: D65 },
  /** Sony S-Gamut3.Cine */
  sgamut3cine: { r: [0.766, 0.275], g: [0.225, 0.8], b: [0.089, -0.087], white: D65 },
  /** Panasonic V-Gamut */
  vgamut: { r: [0.73, 0.28], g: [0.165, 0.84], b: [0.1, -0.03], white: D65 },
  /** ARRI Wide Gamut 3 */
  awg3: { r: [0.684, 0.313], g: [0.221, 0.848], b: [0.0861, -0.102], white: D65 },
  /** Canon Cinema Gamut */
  cinema: { r: [0.74, 0.27], g: [0.17, 1.14], b: [0.08, -0.1], white: D65 },
} satisfies Record<string, Gamut>;

const mul = (a: Mat3, b: Mat3): Mat3 => {
  const o = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
};

/** the inverse of a 3 × 3 matrix (row-major) */
export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) throw new Error('a matrix without an inverse');
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

/** the matrix from a gamut's linear RGB to CIE XYZ (row-major), its white at Y = 1 */
export function rgbToXyz(gamut: Gamut): Mat3 {
  const xyz = ([x, y]: Xy) => [x / y, 1, (1 - x - y) / y];
  const [r, g, b] = [xyz(gamut.r), xyz(gamut.g), xyz(gamut.b)];
  const P: Mat3 = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]];
  const w = xyz(gamut.white), inv = invert3(P);
  const s = [0, 1, 2].map((i) => inv[i * 3] * w[0] + inv[i * 3 + 1] * w[1] + inv[i * 3 + 2] * w[2]);
  return [P[0] * s[0], P[1] * s[1], P[2] * s[2], P[3] * s[0], P[4] * s[1], P[5] * s[2], P[6] * s[0], P[7] * s[1], P[8] * s[2]];
}

/** the matrix carrying linear RGB of one gamut to another's (row-major); the whites here are all D65 */
export const gamutMatrix = (from: Gamut, to: Gamut): Mat3 => mul(invert3(rgbToXyz(to)), rgbToXyz(from));

/** a row-major matrix applied to a colour */
export const apply3 = (m: Mat3, [r, g, b]: [number, number, number]): [number, number, number] =>
  [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b];

/** a 10-bit camera curve is written on code values in video range: a picture's 0..1 is 64..940 of 1023 */
const legal = (v: number) => (64 + 876 * v) / 1023;

/** the footage a grade reads: how it was written, as the camera names it */
export const SOURCES = ['rec709', 'slog3', 'vlog', 'logc3', 'applelog', 'clog3', 'hlg'] as const;
export type Source = (typeof SOURCES)[number];

/** each source's curve back to scene light (18 % grey at 0.18) and its gamut */
export const SOURCE_SPACES: Record<Source, { title: string; gamut: Gamut; decode(v: number): number }> = {
  rec709: { title: 'Rec.709 / sRGB', gamut: GAMUTS.rec709, decode: (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) },
  slog3: {
    title: 'Sony S-Log3 (S-Gamut3.Cine)', gamut: GAMUTS.sgamut3cine,
    decode: (v) => { const x = legal(v); return x >= 171.2102946929 / 1023 ? 10 ** ((x * 1023 - 420) / 261.5) * 0.19 - 0.01 : ((x * 1023 - 95) * 0.01125) / (171.2102946929 - 95); },
  },
  vlog: {
    title: 'Panasonic V-Log', gamut: GAMUTS.vgamut,
    decode: (v) => { const x = legal(v); return x < 0.181 ? (x - 0.125) / 5.6 : 10 ** ((x - 0.598206) / 0.241514) - 0.00873; },
  },
  logc3: {
    title: 'ARRI LogC3 (EI 800)', gamut: GAMUTS.awg3,
    decode: (v) => { const x = legal(v); return x > 0.149658 ? (10 ** ((x - 0.385537) / 0.24719) - 0.052272) / 5.555556 : (x - 0.092809) / 5.367655; },
  },
  applelog: {
    title: 'Apple Log', gamut: GAMUTS.rec2020,
    decode: (p) => {
      const R0 = -0.05641088, Rt = 0.01, c = 47.28711236, b = 0.00964052, g = 0.08550479, d = 0.69336945;
      return p >= c * (Rt - R0) ** 2 ? 2 ** ((p - d) / g) - b : p >= 0 ? Math.sqrt(p / c) + R0 : R0;
    },
  },
  clog3: {
    title: 'Canon Log 3 (Cinema Gamut)', gamut: GAMUTS.cinema,
    decode: (x) => 0.9 * (x < 0.04076162 ? -(10 ** ((0.07623209 - x) / 0.42889912) - 1) / 14.98325 : x <= 0.105357102 ? (x - 0.073059361) / 2.3069815 : (10 ** ((x - 0.069886632) / 0.42889912) - 1) / 14.98325),
  },
  // HLG's reference white (75 %) at 1, so its 18 % grey (38 %) lands near 0.18
  hlg: {
    title: 'HLG (Rec.2100)', gamut: GAMUTS.rec2020,
    decode: (x) => { const a = 0.17883277, b = 0.28466892, c = 0.55991073; return (x <= 0.5 ? (x * x) / 3 : (Math.exp((x - c) / a) + b) / 12) * HLG_WHITE; },
  },
};
export const HLG_WHITE = 3.7743;

/** a matrix as a GLSL mat3 (GLSL fills columns first) */
export const glslMat3 = (m: Mat3) => `mat3(${[m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]].map((x) => x.toFixed(7)).join(', ')})`;
