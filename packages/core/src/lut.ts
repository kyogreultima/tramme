// LUTs (docs/editing-roadmap.md, step 6): a .cube file (the format Resolve,
// Premiere and the cameras' log conversions write) read into a 3D table the
// renderer turns into a texture. Its lines: LUT_3D_SIZE n, DOMAIN_MIN and
// DOMAIN_MAX, then n³ lines "r g b", red changing fastest.

export interface Lut3D {
  kind: 'lut3d';
  title?: string;
  size: number;
  /** n³ RGB triplets, red fastest, then green, then blue */
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

/** the largest table read (128³ triplets, about 25 MB as floats) */
export const LUT_MAX_SIZE = 128;

export function parseCube(text: string): Lut3D {
  let size = 0, title: string | undefined, n = 0;
  let domainMin: [number, number, number] = [0, 0, 0], domainMax: [number, number, number] = [1, 1, 1];
  let data: Float32Array | null = null;
  const triplet = (parts: string[], what: string): [number, number, number] => {
    const v = parts.slice(0, 3).map(Number);
    if (v.length < 3 || v.some((x) => !Number.isFinite(x))) throw new Error(`${what}: three numbers expected`);
    return v as [number, number, number];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/), word = parts[0].toUpperCase();
    if (word === 'TITLE') { title = line.slice(5).trim().replace(/^"|"$/g, ''); continue; }
    if (word === 'LUT_1D_SIZE') throw new Error('a 1D LUT: only 3D LUTs are read (LUT_3D_SIZE)');
    if (word === 'LUT_3D_SIZE') {
      size = Number(parts[1]);
      if (!Number.isInteger(size) || size < 2 || size > LUT_MAX_SIZE) throw new Error(`LUT_3D_SIZE ${parts[1]}: 2 to ${LUT_MAX_SIZE} expected`);
      data = new Float32Array(size * size * size * 3);
      continue;
    }
    if (word === 'DOMAIN_MIN') { domainMin = triplet(parts.slice(1), 'DOMAIN_MIN'); continue; }
    if (word === 'DOMAIN_MAX') { domainMax = triplet(parts.slice(1), 'DOMAIN_MAX'); continue; }
    if (/^[A-Z_]+$/.test(word)) continue; // a keyword some tools add (LUT_IN_VIDEO_RANGE…): nothing for the picture
    if (!data) throw new Error('values before LUT_3D_SIZE');
    if (n >= size ** 3) throw new Error(`more than ${size ** 3} values`);
    data.set(triplet(parts, `line ${n + 1} of the table`), n * 3);
    n++;
  }
  if (!data) throw new Error('no LUT_3D_SIZE: not a 3D .cube file');
  if (n !== size ** 3) throw new Error(`${n} values for ${size ** 3} expected`);
  return { kind: 'lut3d', title, size, data, domainMin, domainMax };
}

/** a colour (0..1) through a table, by trilinear interpolation: what the GPU does, for the tests and the checks */
export function applyLut(lut: Lut3D, rgb: [number, number, number]): [number, number, number] {
  const n = lut.size, d = lut.data;
  const pos = rgb.map((v, k) => Math.min(n - 1, Math.max(0, ((v - lut.domainMin[k]) / (lut.domainMax[k] - lut.domainMin[k] || 1)) * (n - 1))));
  const i0 = pos.map(Math.floor), f = pos.map((p, k) => p - i0[k]), i1 = i0.map((i) => Math.min(n - 1, i + 1));
  const at = (r: number, g: number, b: number, c: number) => d[((b * n + g) * n + r) * 3 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const c00 = lerp(at(i0[0], i0[1], i0[2], c), at(i1[0], i0[1], i0[2], c), f[0]);
    const c10 = lerp(at(i0[0], i1[1], i0[2], c), at(i1[0], i1[1], i0[2], c), f[0]);
    const c01 = lerp(at(i0[0], i0[1], i1[2], c), at(i1[0], i0[1], i1[2], c), f[0]);
    const c11 = lerp(at(i0[0], i1[1], i1[2], c), at(i1[0], i1[1], i1[2], c), f[0]);
    out[c] = lerp(lerp(c00, c10, f[1]), lerp(c01, c11, f[1]), f[2]);
  }
  return out;
}

/**
 * A tone curve as a table of n values over 0..1 (the 1D texture of
 * fx.curves): its points (x, y in 0..1) sorted, joined by a monotone cubic
 * (Fritsch-Carlson), so it never overshoots between two points, held flat
 * before the first and after the last.
 */
export function curveTable(points: readonly (readonly number[])[], n = 256): Float32Array {
  const pts = points.filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, a) => i === 0 || p[0] - a[i - 1][0] > 1e-6);
  const out = new Float32Array(n);
  if (pts.length === 0) { for (let i = 0; i < n; i++) out[i] = i / (n - 1); return out; }
  if (pts.length === 1) return out.fill(pts[0][1]);
  const m = pts.length, d: number[] = [], tan: number[] = new Array(m).fill(0);
  for (let i = 0; i < m - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  tan[0] = d[0]; tan[m - 1] = d[m - 2];
  for (let i = 1; i < m - 1; i++) tan[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < m - 1; i++) {
    if (d[i] === 0) { tan[i] = tan[i + 1] = 0; continue; }
    const a = tan[i] / d[i], b = tan[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); tan[i] = k * a * d[i]; tan[i + 1] = k * b * d[i]; }
  }
  let seg = 0;
  for (let j = 0; j < n; j++) {
    const x = j / (n - 1);
    if (x <= pts[0][0]) { out[j] = pts[0][1]; continue; }
    if (x >= pts[m - 1][0]) { out[j] = pts[m - 1][1]; continue; }
    while (seg < m - 2 && x > pts[seg + 1][0]) seg++;
    const [x0, y0] = pts[seg], [x1, y1] = pts[seg + 1], h = x1 - x0, t = (x - x0) / h;
    const t2 = t * t, t3 = t2 * t;
    out[j] = Math.min(1, Math.max(0, (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * tan[seg] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * tan[seg + 1]));
  }
  return out;
}
