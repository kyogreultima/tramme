// Frames made up and pictures enlarged (docs/editing-roadmap.md, step 13),
// without a model: pure functions over RGBA pixels, run by the editor's
// long jobs at authoring time. A frame between two frames is warped along
// their motion (blocks matched, the field smoothed) and the two blended at
// its moment; a picture twice its size is resampled with a Lanczos window
// and lightly sharpened. A model (RIFE, Real-ESRGAN) does better on hard
// motion and fine texture; these keep the tools working everywhere.

export interface Rgba { width: number; height: number; data: Uint8ClampedArray }

/** the motion from a to b (pixels of the full size), per block of `cell` pixels of the full size */
export interface FlowField { cols: number; rows: number; cell: number; dx: Float32Array; dy: Float32Array }

const lumaOf = (p: Rgba, k: number): { w: number; h: number; l: Float32Array } => {
  const w = Math.max(1, Math.floor(p.width / k)), h = Math.max(1, Math.floor(p.height / k)), l = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y * k) * p.width + x * k) * 4;
    l[y * w + x] = 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];
  }
  return { w, h, l };
};

/**
 * The motion between two frames of the same size: blocks of the half size
 * matched within `reach` half-size pixels (sub-pixel by a parabola), a block
 * too flat to tell taking its neighbours' motion, the field smoothed by a
 * median of 3×3.
 */
export function flowField(a: Rgba, b: Rgba, { cell = 16, reach = 12 } = {}): FlowField {
  const k = 2, A = lumaOf(a, k), B = lumaOf(b, k), c = Math.max(4, Math.round(cell / k));
  const cols = Math.max(1, Math.floor(A.w / c)), rows = Math.max(1, Math.floor(A.h / c));
  const dx = new Float32Array(cols * rows), dy = new Float32Array(cols * rows), sure = new Uint8Array(cols * rows);
  const span = 2 * reach + 1, sad = new Float32Array(span * span);
  for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
    const x0 = bx * c, y0 = by * c;
    let best = Infinity, bxo = 0, byo = 0, mean = 0, varc = 0;
    for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) mean += A.l[(y0 + y) * A.w + x0 + x];
    mean /= c * c;
    for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) varc += Math.abs(A.l[(y0 + y) * A.w + x0 + x] - mean);
    for (let oy = -reach; oy <= reach; oy++) for (let ox = -reach; ox <= reach; ox++) {
      let d = 0;
      for (let y = 0; y < c; y += 2) {
        const yy = Math.min(B.h - 1, Math.max(0, y0 + y + oy));
        for (let x = 0; x < c; x += 2) {
          const xx = Math.min(B.w - 1, Math.max(0, x0 + x + ox));
          d += Math.abs(A.l[(y0 + y) * A.w + x0 + x] - B.l[yy * B.w + xx]);
        }
      }
      // a slight pull toward no motion: a tie is a hold
      d += (Math.abs(ox) + Math.abs(oy)) * 0.02 * c;
      sad[(oy + reach) * span + ox + reach] = d;
      if (d < best) { best = d; bxo = ox; byo = oy; }
    }
    const at = (ox: number, oy: number) => sad[(oy + reach) * span + ox + reach];
    const sub = (l: number, m: number, r: number) => { const den = l - 2 * m + r; return den > 1e-6 ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * den))) : 0; };
    const fx = Math.abs(bxo) < reach ? sub(at(bxo - 1, byo), best, at(bxo + 1, byo)) : 0;
    const fy = Math.abs(byo) < reach ? sub(at(bxo, byo - 1), best, at(bxo, byo + 1)) : 0;
    const i = by * cols + bx;
    dx[i] = (bxo + fx) * k; dy[i] = (byo + fy) * k;
    sure[i] = varc / (c * c) > 2 ? 1 : 0;
  }
  // flat blocks take the average of their sure neighbours, then a median smooths the field
  const fill = (v: Float32Array) => {
    const out = Float32Array.from(v);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (sure[y * cols + x]) continue;
      let s = 0, n = 0;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
        const xx = x + i, yy = y + j;
        if (xx >= 0 && yy >= 0 && xx < cols && yy < rows && sure[yy * cols + xx]) { s += v[yy * cols + xx]; n++; }
      }
      out[y * cols + x] = n ? s / n : 0;
    }
    return out;
  };
  const median = (v: Float32Array) => {
    const out = new Float32Array(v.length), win: number[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      win.length = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = Math.min(cols - 1, Math.max(0, x + i)), yy = Math.min(rows - 1, Math.max(0, y + j)); win.push(v[yy * cols + xx]); }
      win.sort((p, q) => p - q);
      out[y * cols + x] = win[4];
    }
    return out;
  };
  return { cols, rows, cell: c * k, dx: median(fill(dx)), dy: median(fill(dy)) };
}

/** the field's motion at a pixel of the full size, bilinear between block centres */
function motionAt(f: FlowField, x: number, y: number): [number, number] {
  const gx = Math.min(f.cols - 1, Math.max(0, x / f.cell - 0.5)), gy = Math.min(f.rows - 1, Math.max(0, y / f.cell - 0.5));
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(f.cols - 1, x0 + 1), y1 = Math.min(f.rows - 1, y0 + 1), u = gx - x0, v = gy - y0;
  const at = (a: Float32Array) => (a[y0 * f.cols + x0] * (1 - u) + a[y0 * f.cols + x1] * u) * (1 - v) + (a[y1 * f.cols + x0] * (1 - u) + a[y1 * f.cols + x1] * u) * v;
  return [at(f.dx), at(f.dy)];
}

function sample(p: Rgba, x: number, y: number, out: number[]) {
  const fx = Math.min(p.width - 1, Math.max(0, x)), fy = Math.min(p.height - 1, Math.max(0, y));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(p.width - 1, x0 + 1), y1 = Math.min(p.height - 1, y0 + 1), u = fx - x0, v = fy - y0;
  for (let c = 0; c < 4; c++) {
    const a = p.data[(y0 * p.width + x0) * 4 + c], b = p.data[(y0 * p.width + x1) * 4 + c], d = p.data[(y1 * p.width + x0) * 4 + c], e = p.data[(y1 * p.width + x1) * 4 + c];
    out[c] = (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v;
  }
}

/** the frame at moment s (0: a, 1: b) between two frames, along their motion */
export function between(a: Rgba, b: Rgba, s: number, flow: FlowField = flowField(a, b)): Rgba {
  const out = new Uint8ClampedArray(a.data.length), pa = [0, 0, 0, 0], pb = [0, 0, 0, 0];
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const [mx, my] = motionAt(flow, x, y);
    // where this pixel was in a, and where it will be in b
    sample(a, x - s * mx, y - s * my, pa);
    sample(b, x + (1 - s) * mx, y + (1 - s) * my, pb);
    const i = (y * a.width + x) * 4;
    for (let c = 0; c < 4; c++) out[i + c] = pa[c] * (1 - s) + pb[c] * s;
  }
  return { width: a.width, height: a.height, data: out };
}

const lanczos = (x: number, a: number) => (x === 0 ? 1 : Math.abs(x) >= a ? 0 : (a * Math.sin(Math.PI * x) * Math.sin((Math.PI * x) / a)) / (Math.PI * Math.PI * x * x));

/** a picture `k` times its size (an integer): Lanczos-3 one axis then the other, then a light unsharp mask */
export function enlarge(p: Rgba, k = 2, sharpen = 0.35): Rgba {
  const W = p.width * k, H = p.height * k, A = 3;
  const weights = (n: number) => {
    // each output sample of one axis: its first source index and its taps
    const taps: { from: number; w: Float32Array }[] = [];
    for (let o = 0; o < n * k; o++) {
      const centre = (o + 0.5) / k - 0.5, from = Math.floor(centre) - A + 1, w = new Float32Array(2 * A);
      let sum = 0;
      for (let t = 0; t < 2 * A; t++) { w[t] = lanczos(centre - (from + t), A); sum += w[t]; }
      for (let t = 0; t < 2 * A; t++) w[t] /= sum;
      taps.push({ from, w });
    }
    return taps;
  };
  const wx = weights(p.width), wy = weights(p.height);
  const mid = new Float32Array(W * p.height * 4);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < W; x++) {
    const { from, w } = wx[x];
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let t = 0; t < 2 * A; t++) s += w[t] * p.data[(y * p.width + Math.min(p.width - 1, Math.max(0, from + t))) * 4 + c];
      mid[(y * W + x) * 4 + c] = s;
    }
  }
  const big = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const { from, w } = wy[y];
    for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let t = 0; t < 2 * A; t++) s += w[t] * mid[(Math.min(p.height - 1, Math.max(0, from + t)) * W + x) * 4 + c];
      big[(y * W + x) * 4 + c] = s;
    }
  }
  // the edges a touch crisper: the picture less a blur of itself (3×3), the alpha left
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let q = -1; q <= 1; q++) s += big[(Math.min(H - 1, Math.max(0, y + j)) * W + Math.min(W - 1, Math.max(0, x + q))) * 4 + c];
      out[i + c] = big[i + c] + sharpen * (big[i + c] - s / 9);
    }
    out[i + 3] = big[i + 3];
  }
  return { width: W, height: H, data: out };
}
