// Matter: one shape becoming another, seeded blobs that merge and part, and
// a torn paper crossing the frame. All of it is a pure function of t — a
// morph resamples both paths along their length and matches their starts so
// nothing twists, the liquid traces a field of circles with marching
// squares, the paper's edge is torn by seeded noise. The same input, the
// same seed, the same picture, any frame in any order.

// ── the paths ────────────────────────────────────────────────
/**
 * A PathValue's outline as a polyline: its vertices, its Béziers (the in and
 * out tangents, relative to their vertex) flattened in 16 runs a segment, the
 * closing segment included and ending back on the first vertex.
 */
function pointsOf(path) {
  const v = (path && Array.isArray(path.v)) ? path.v.map((p) => [Number(p?.[0]) || 0, Number(p?.[1]) || 0]) : [];
  const n = v.length;
  if (n < 2) return v;
  const zero = [0, 0];
  const pts = [v[0]];
  const seg = (a, b) => {
    const o = path.o?.[a] ?? zero, i = path.i?.[b] ?? zero;
    if (!o[0] && !o[1] && !i[0] && !i[1]) { pts.push(v[b]); return; }
    const P0 = v[a], P1 = [v[a][0] + o[0], v[a][1] + o[1]], P2 = [v[b][0] + i[0], v[b][1] + i[1]], P3 = v[b];
    for (let k = 1; k <= 16; k++) {
      const u = k / 16, w = 1 - u;
      pts.push([w * w * w * P0[0] + 3 * w * w * u * P1[0] + 3 * w * u * u * P2[0] + u * u * u * P3[0], w * w * w * P0[1] + 3 * w * w * u * P1[1] + 3 * w * u * u * P2[1] + u * u * u * P3[1]]);
    }
  };
  for (let k = 0; k < n - 1; k++) seg(k, k + 1);
  if (path.closed) seg(n - 1, 0);
  return pts;
}

/** the signed area of a closed polyline (its winding: positive one way, negative the other) */
const signedArea = (pts) => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
};

/** the outline a morph walks: n points at equal arc length, the closing one dropped (it is the first) */
function outlineOf(path, n) {
  return path?.closed ? resample(path, n + 1).slice(0, n) : resample(path, n);
}

/**
 * The second outline put in step with the first: wound the same way (a
 * shape walked backwards would turn inside out on the way) and rotated to the
 * start that meets the first with the least travel — nothing twists.
 */
export function aligned(A, B) {
  const same = Math.sign(signedArea(A)) === Math.sign(signedArea(B)) || !signedArea(A) || !signedArea(B);
  const b = same ? B : [...B].reverse();
  const k = bestStart(A, b);
  return b.map((_, i) => b[(i + k) % b.length]);
}

/** a shape as contours: one PathValue, or a list of them (a logo of several pieces) */
const contoursOf = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((c) => c && Array.isArray(c.v) && c.v.length > 1);

/**
 * The contours of two shapes paired for a morph: by size, then by place (the
 * biggest with the biggest), the ones left over growing from, or shrinking
 * to, a point at their centre. Each pair is [a, b] outlines of n points.
 */
export function pairContours(a, b, n = 96) {
  const prep = (list) => list.map((c) => {
    const pts = outlineOf(c, n);
    const cx = pts.reduce((s, p) => s + p[0], 0) / (pts.length || 1), cy = pts.reduce((s, p) => s + p[1], 0) / (pts.length || 1);
    return { pts, area: Math.abs(signedArea(pts)), cx, cy };
  }).filter((c) => c.pts.length >= 3).sort((x, y) => y.area - x.area);
  const A = prep(contoursOf(a)), B = prep(contoursOf(b));
  const pairs = [];
  const used = new Set();
  for (const ca of A) {
    // the biggest left of the other shape, the nearest among those of a like size
    let best = -1, bestCost = Infinity;
    B.forEach((cb, j) => {
      if (used.has(j)) return;
      const cost = Math.abs(Math.log((cb.area + 1) / (ca.area + 1))) * 200 + Math.hypot(cb.cx - ca.cx, cb.cy - ca.cy);
      if (cost < bestCost) { bestCost = cost; best = j; }
    });
    if (best >= 0) { used.add(best); pairs.push([ca.pts, aligned(ca.pts, B[best].pts)]); }
    else pairs.push([ca.pts, ca.pts.map(() => [ca.cx, ca.cy])]);
  }
  B.forEach((cb, j) => { if (!used.has(j)) pairs.push([cb.pts.map(() => [cb.cx, cb.cy]), cb.pts]); });
  return pairs;
}

/** the total length of a polyline */
const lengthOf = (pts) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
};

/**
 * A path walked again at equal speed: n points at equal arc length. A morph
 * needs them so a vertex's travel says nothing about where the author placed
 * the handles.
 */
export function resample(path, n) {
  const pts = pointsOf(path);
  if (pts.length < 2 || n < 2) return pts.slice(0, Math.max(0, n));
  const total = lengthOf(pts), out = [];
  let i = 1, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (i < pts.length) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc + seg >= target - 1e-12 || i === pts.length - 1) {
        const u = seg > 0 ? Math.min(1, (target - acc) / seg) : 0;
        out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u]);
        break;
      }
      acc += seg;
      i++;
    }
  }
  return out;
}

/**
 * The rotation of `b` that meets `a` with the least summed distance (no
 * twist): both resampled lists of n points, `b` shifted by the answer's
 * number of points aligns its first vertex with a's.
 */
export function bestStart(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let best = 0, bestSum = Infinity;
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(a[i][0] - b[(i + k) % n][0], a[i][1] - b[(i + k) % n][1]);
      s += d * d;
    }
    if (s < bestSum) { bestSum = s; best = k; }
  }
  return best;
}

// ── marching squares ─────────────────────────────────────────
/**
 * The contours of a scalar field at `level`, on a grid of `cell` px over a
 * w×h frame: closed loops of [x, y] in pixels, the field read at each
 * corner and the crossing interpolated. A circle's field gives one loop of
 * its radius, within a cell.
 */
export function marchingSquares(field, w, h, cell = 8, level = 0.5) {
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const sample = (c, r) => field(Math.min(w, c * cell), Math.min(h, r * cell));
  const at = (c, r) => sample(c, r) >= level;
  const lerp = (x0, y0, v0, x1, y1, v1) => {
    const u = (level - v0) / (v1 - v0 || 1e-9);
    return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
  };
  // the segments of each cell, keyed by their ends so they chain into loops
  const segs = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * cell, y0 = r * cell, x1 = x0 + cell, y1 = y0 + cell;
      const v0 = sample(c, r), v1 = sample(c + 1, r), v2 = sample(c + 1, r + 1), v3 = sample(c, r + 1);
      const b0 = at(c, r), b1 = at(c + 1, r), b2 = at(c + 1, r + 1), b3 = at(c, r + 1);
      const code = (b0 ? 1 : 0) | (b1 ? 2 : 0) | (b2 ? 4 : 0) | (b3 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => lerp(x0, y0, v0, x1, y0, v1);
      const right = () => lerp(x1, y0, v1, x1, y1, v2);
      const bottom = () => lerp(x0, y1, v3, x1, y1, v2);
      const left = () => lerp(x0, y0, v0, x0, y1, v3);
      const edges = {
        top, right, bottom, left,
        between: (a, b) => {
          const pa = a(), pb = b();
          return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
        },
      };
      const push = (a, b) => segs.push([a, b]);
      // the segments oriented so the inside stays on one side: the loops chain
      switch (code) {
        case 1: push(edges.left(), edges.top()); break;
        case 14: push(edges.top(), edges.left()); break;
        case 2: push(edges.top(), edges.right()); break;
        case 13: push(edges.right(), edges.top()); break;
        case 3: push(edges.left(), edges.right()); break;
        case 12: push(edges.right(), edges.left()); break;
        case 4: push(edges.right(), edges.bottom()); break;
        case 11: push(edges.bottom(), edges.right()); break;
        case 6: push(edges.top(), edges.bottom()); break;
        case 9: push(edges.bottom(), edges.top()); break;
        case 7: push(edges.left(), edges.bottom()); break;
        case 8: push(edges.bottom(), edges.left()); break;
        case 5: push(edges.left(), edges.top()); push(edges.right(), edges.bottom()); break;
        case 10: push(edges.top(), edges.right()); push(edges.left(), edges.bottom()); break;
      }
    }
  }
  // the loops: walk the segments end to end
  const key = (p) => `${Math.round(p[0] * 10)}:${Math.round(p[1] * 10)}`;
  const from = new Map();
  segs.forEach((s, i) => { const k = key(s[0]); (from.get(k) ?? from.set(k, []).get(k)).push(i); });
  const used = new Array(segs.length).fill(false);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const loop = [segs[i][0], segs[i][1]];
    for (;;) {
      const nexts = from.get(key(loop[loop.length - 1])) ?? [];
      const nxt = nexts.find((j) => !used[j]);
      if (nxt === undefined) break;
      used[nxt] = true;
      loop.push(segs[nxt][1]);
      if (key(loop[0]) === key(loop[loop.length - 1])) break;
    }
    if (loop.length > 3) loops.push(loop.map((p) => [+p[0].toFixed(1), +p[1].toFixed(1)]));
  }
  return loops;
}

// ── torn paper ───────────────────────────────────────────────
const hash2 = (x, y) => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);
const valueNoise = (x, seed) => {
  const i = Math.floor(x), f = smooth(x - i);
  return (hash2(seed + i, 17) * (1 - f) + hash2(seed + i + 1, 17) * f) * 2 - 1;
};

/** the torn edge of a sheet: a horizontal line of `len` px, torn by seeded noise to ±`rough` */
export function tornEdge(len, seed = 0, rough = 14) {
  const out = [], steps = Math.max(8, Math.round(len / 14));
  for (let k = 0; k <= steps; k++) {
    const x = (len * k) / steps;
    const y = valueNoise((k / steps) * steps * 0.7, seed) * rough + valueNoise((k / steps) * steps * 2.3, seed + 91) * rough * 0.35;
    out.push([+x.toFixed(1), +y.toFixed(1)]);
  }
  return out;
}

// ── the liquid field ─────────────────────────────────────────
/**
 * The field of the liquid at t: seeded blobs drifting slowly, each a
 * metaball whose radius breathes. A pure function of t — the same frame
 * asked alone or reached after every one before it gives the same answer,
 * so the drawing is the same in any order. `speed` scales the drift (lava
 * slow at 1: a turn of a blob's loop in about 25 s).
 */
export function liquidField(seed, t, blobs = 7, speed = 1) {
  const out = [];
  for (let k = 0; k < blobs; k++) {
    const n1 = hash2(seed * 131 + k, 3), n2 = hash2(seed * 131 + k, 41), n3 = hash2(seed * 131 + k, 97);
    // each blob drifts on its own slow loop, its radius breathing with it
    const phase = t * speed * (0.18 + n3 * 0.14) + n1 * Math.PI * 2;
    out.push({
      x: 0.5 + Math.cos(phase + n2 * 6) * (0.16 + n2 * 0.22),
      y: 0.5 + Math.sin(phase * 0.8 + n3 * 6) * (0.16 + n3 * 0.22),
      r: 0.16 + n1 * 0.12 + 0.03 * Math.sin(phase * 1.3),
    });
  }
  return out;
}

/** the field a blob field paints: the blobs' influences summed (metaballs), so two near ones merge before they touch */
function fieldOf(blobs, aspect = 1) {
  return (x, y) => {
    let s = 0;
    for (const b of blobs) {
      // the radius in the frame's shorter side, so a blob stays round in any format
      const dx = (x - b.x) * aspect, dy = y - b.y;
      const d2 = (dx * dx + dy * dy) / (b.r * b.r);
      s += d2 < 4 ? (1 - d2 / 4) ** 2 : 0;
    }
    return s;
  };
}

/**
 * The value the liquid's contour is traced on, at a point of the frame (0 to
 * 1 each way): the blobs alone (`blobs`, grown in with the progress), or the
 * flood (`flood`), the blobs riding a front that crosses from the left with
 * the progress and covers the whole frame at 1.
 */
export function liquidValue(mode, field, x, y, u) {
  if (mode === 'flood') return field(x, y) * 0.35 + (u * 2.6 - 0.8 - x) * 2.2;
  return field(x, y) - (1 - u) * 1.2;
}

// ── the nodes ────────────────────────────────────────────────
function tracePath(ctx, pts, close) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  if (close) ctx.closePath();
}

/** a morph's pairs, memoised on its shapes: resampling and matching are the same every frame */
const pairsCache = new Map();
function pairsOf(a, b, n) {
  const key = JSON.stringify([a, b, n]);
  if (!pairsCache.has(key)) { if (pairsCache.size > 16) pairsCache.clear(); pairsCache.set(key, pairContours(a, b, n)); }
  return pairsCache.get(key);
}

const morphNode = {
  type: 'matter.morph', title: 'Morph', category: 'Matter',
  description: 'one shape becoming another: both walked again at equal arc length, wound the same way and their starts matched so nothing twists, several contours paired by size and place, the points travelling with the progress',
  ai: { when: 'an icon becoming another (a seed into a sprout, a phone into a checkmark), a logo changing as the scene changes; the shapes are path values (an icon\'s contours, an SVG through svg-paths), one or a list — the pack resamples them anyway', avoid: 'morphing between shapes the eye cannot bridge (a circle into a paragraph), a progress keyed faster than 0.6 s, two morphs crossing at once' },
  props: {
    a: { type: 'json', default: { v: [[-120, -120], [120, -120], [120, 120], [-120, 120]], closed: true }, label: 'From', animatable: false, description: 'a PathValue { v: [[x, y], …], i?, o?, closed } or a list of them' },
    b: { type: 'json', default: { v: [[0, -150], [142, 46], [-88, 46], [88, 46], [-142, 46]], closed: true }, label: 'To', animatable: false },
    progress: { type: 'number', default: 0, min: 0, max: 1, step: 0.001, label: 'Progress', description: '0: the first shape; key it to travel' },
    points: { type: 'integer', default: 96, min: 8, max: 512, label: 'Points', animatable: false },
    fill: { type: 'paint', default: '@accent', label: 'Fill' },
    stroke: { type: 'paint', default: null, nullable: true, label: 'Stroke' },
    strokeWidth: { type: 'number', default: 0, min: 0, unit: 'px', label: 'Stroke width' },
  },
  bounds(p) {
    const all = [...contoursOf(p.a), ...contoursOf(p.b)].flatMap(pointsOf);
    if (!all.length) return { x: -120, y: -120, w: 240, h: 240 };
    const xs = all.map((q) => q[0]), ys = all.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },
  render: {
    canvas2d(ctx, p) {
      const pairs = pairsOf(p.a, p.b, Math.round(p.points ?? 96));
      if (!pairs.length) return;
      const u = Math.min(1, Math.max(0, p.progress));
      const eased = 1 - Math.pow(1 - u, 3);
      ctx.beginPath();
      for (const [A, B] of pairs) {
        A.forEach(([x, y], i) => {
          const [bx, by] = B[i];
          const px = x + (bx - x) * eased, py = y + (by - y) * eased;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
      }
      if (p.fill) { ctx.fillStyle = p.fill; ctx.fill('evenodd'); }
      if (p.stroke && p.strokeWidth > 0) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.strokeWidth; ctx.lineJoin = 'round'; ctx.stroke(); }
    },
  },
};

const liquidNode = {
  type: 'matter.liquid', title: 'Liquid', category: 'Matter',
  description: 'seeded blobs that merge and part, traced by marching squares; as a transition, a flood that crosses the frame and drains',
  ai: { when: 'a transition between two scenes (mode flood: key the progress 0 to 1 over the cut to cover, 1 to 0 to drain) or a backing shape that breathes behind a title (mode blobs); the seed makes it yours, the same every render', avoid: 'a liquid over text (it eats it), blobs drifting faster than lava, more than nine blobs' },
  props: {
    seed: { type: 'integer', default: 1, min: 0, label: 'Seed', description: 'another seed, another liquid' },
    blobs: { type: 'integer', default: 6, min: 2, max: 12, label: 'Blobs', animatable: false },
    mode: { type: 'enum', default: 'blobs', options: ['blobs', 'flood'], label: 'Mode', animatable: false, description: 'blobs: the shapes alone; flood: a front crossing the frame from the left' },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: 'blobs: 1 settled on screen, key 0 to 1 to grow them in; flood: 0 nothing, 1 the frame covered' },
    speed: { type: 'number', default: 1, min: 0, max: 4, step: 0.05, label: 'Drift', animatable: false, description: 'how fast the blobs drift (1: lava)' },
    cell: { type: 'number', default: 14, min: 4, unit: 'px', label: 'Grid', animatable: false },
    fill: { type: 'paint', default: '@accent', label: 'Liquid' },
    size: { type: 'vec2', default: [900, 560], label: 'Size', unit: 'px' },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  path({ size: [w, h] }) { const s = new Path2D(); s.rect(-w / 2, -h / 2, w, h); return s; },
  render: {
    canvas2d(ctx, p, host) {
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      const blobs = liquidField(p.seed ?? 1, host.t - (host.layerIn ?? 0), p.blobs ?? 6, p.speed ?? 1);
      const field = fieldOf(blobs, w / h);
      const u = Math.min(1, Math.max(0, p.progress));
      // the contour traced a cell outside the frame on every side, so a covered frame closes its loop past the edges
      const c = p.cell ?? 14;
      const W = w + 2 * c, H = h + 2 * c;
      // the outermost samples are dry: a frame covered whole still has a contour, just past its edges
      const loops = marchingSquares((x, y) => (x <= 0 || y <= 0 || x >= W - 1e-6 || y >= H - 1e-6 ? -1 : liquidValue(p.mode, field, (x - c) / w, (y - c) / h, u)), W, H, c, 0.5);
      ctx.save();
      ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
      // the field is read in the frame's corner space: drawn back around the layer's centre
      ctx.translate(-w / 2 - c, -h / 2 - c);
      ctx.fillStyle = p.fill;
      ctx.beginPath();
      for (const loop of loops) loop.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.fill('evenodd');
      ctx.restore();
    },
  },
};

/** the sheet's outline at a progress: a frame-wide sheet whose leading and trailing edges are torn, crossing from left to right */
export function sheetOf(w, h, u, seed = 1, rough = 16) {
  const tall = h * 1.6, half = w * 0.62;
  const cx = -w * 1.3 + u * w * 2.6;
  const lead = tornEdge(tall, seed, rough), trail = tornEdge(tall, seed + 53, rough);
  // the edges run top to bottom: the noise moves them across, the length runs down
  const right = lead.map(([along, off]) => [cx + half + off, along - tall / 2]);
  const left = trail.map(([along, off]) => [cx - half + off, along - tall / 2]).reverse();
  return { outline: [...right, ...left], lead: right };
}

const paperNode = {
  type: 'matter.paper', title: 'Paper', category: 'Matter',
  description: 'a torn sheet crossing the frame: its edges torn by seeded noise, its fibres and its shadow, covering the frame at the cut and revealing what is under as it passes',
  ai: { when: 'a transition with a hand-made feel: a sheet sweeping across between two scenes, torn edge leading, the cut hidden at the middle of its sweep; the seed keeps it the same in every render', avoid: 'more than one sheet at a time, a sweep faster than 0.5 s, a paper colour fighting the scenes it covers' },
  props: {
    progress: { type: 'number', default: 0, min: 0, max: 1, step: 0.001, label: 'Progress', description: '0: off screen left; 0.5: the frame covered (put the cut there); 1: gone right' },
    angle: { type: 'number', default: -6, min: -45, max: 45, unit: '°', label: 'Angle', animatable: false },
    seed: { type: 'integer', default: 1, min: 0, label: 'Seed' },
    rough: { type: 'number', default: 16, min: 2, unit: 'px', label: 'Roughness' },
    paper: { type: 'paint', default: '#F6F1E6', label: 'Paper' },
    shadow: { type: 'bool', default: true, label: 'Shadow', animatable: false },
    fibres: { type: 'bool', default: true, label: 'Fibres', animatable: false },
  },
  bounds(p, host) { return { x: -host.width / 2, y: -host.height / 2, w: host.width, h: host.height }; },
  render: {
    canvas2d(ctx, p, host) {
      const w = host.width, h = host.height;
      const u = Math.min(1, Math.max(0, p.progress));
      if (u <= 0 || u >= 1) return;
      const { outline, lead } = sheetOf(w, h, u, p.seed ?? 1, p.rough ?? 16);
      ctx.save();
      ctx.rotate(((p.angle ?? 0) * Math.PI) / 180);
      if (p.shadow) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.save(); ctx.translate(w * 0.012, h * 0.008);
        tracePath(ctx, outline, true); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = p.paper;
      tracePath(ctx, outline, true); ctx.fill();
      if (p.fibres) {
        // the fibres: short strokes off the torn leading edge, seeded
        ctx.strokeStyle = 'rgba(0,0,0,0.16)';
        ctx.lineWidth = 1;
        for (let k = 0; k < lead.length; k += 2) {
          const [ex, ey] = lead[k];
          const n = hash2(p.seed ?? 1, k * 7);
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex + 3 + n * 6, ey + (n - 0.5) * 8);
          ctx.stroke();
        }
      }
      ctx.restore();
    },
  },
};

export const meta = { id: 'tramme/matter', name: 'matter', version: '1.0.0', description: 'Morphs, liquids and paper: one shape becoming another without twisting, seeded blobs, a torn sheet crossing the frame', api: 1 };
export const nodes = [morphNode, liquidNode, paperNode];
export const messages = {
  fr: {
    "one shape becoming another: both walked again at equal arc length, wound the same way and their starts matched so nothing twists, several contours paired by size and place, the points travelling with the progress": "une forme qui devient une autre : toutes deux reparcourues à pas égal, tournant dans le même sens et leurs départs appariés pour que rien ne se torde, plusieurs contours appariés par taille et par place, les points qui voyagent avec la progression",
    "a PathValue { v: [[x, y], …], i?, o?, closed } or a list of them": "un PathValue { v: [[x, y], …], i?, o?, closed } ou une liste de PathValue",
    "Mode": "Mode",
    "blobs: the shapes alone; flood: a front crossing the frame from the left": "blobs : les formes seules ; flood : un front qui traverse le cadre depuis la gauche",
    "blobs: 1 settled on screen, key 0 to 1 to grow them in; flood: 0 nothing, 1 the frame covered": "blobs : 1 posées à l’écran, keyframez de 0 à 1 pour les faire grandir ; flood : 0 rien, 1 le cadre couvert",
    "Drift": "Dérive",
    "how fast the blobs drift (1: lava)": "la vitesse de dérive des gouttes (1 : de la lave)",
    "a torn sheet crossing the frame: its edges torn by seeded noise, its fibres and its shadow, covering the frame at the cut and revealing what is under as it passes": "une feuille déchirée qui traverse le cadre : ses bords déchirés par un bruit semé, ses fibres et son ombre, couvrant le cadre à la coupe et révélant ce qui est dessous en passant",
    "0: off screen left; 0.5: the frame covered (put the cut there); 1: gone right": "0 : hors écran à gauche ; 0,5 : le cadre couvert (la coupe se place là) ; 1 : partie à droite",
    'Morph': 'Morphing', 'Liquid': 'Liquide', 'Paper': 'Papier',
    'From': 'Depuis', 'To': 'Vers', 'Points': 'Points', 'Fill': 'Remplissage', 'Stroke': 'Trait', 'Stroke width': 'Épaisseur du trait',
    'Progress': 'Progression', 'Size': 'Taille', 'Seed': 'Graine', 'Blobs': 'Gouttes', 'Grid': 'Grille', 'Angle': 'Angle', 'Roughness': 'Rugosité', 'Paper': 'Papier', 'Shadow': 'Ombre', 'Fibres': 'Fibres',
    'a PathValue: { v: [[x, y], …], closed }': 'un PathValue : { v: [[x, y], …], closed }',
    '0: the first shape; key it to travel': '0 : la première forme ; keyframez-le pour voyager',
    '1: the liquid settled on screen; key 0 to 1 to flood it in': '1 : le liquide posé à l’écran ; keyframez de 0 à 1 pour l’inonder',
    '0: off screen left; 1: gone right; key it over the cut': '0 : hors écran à gauche ; 1 : parti à droite ; keyframez-le sur la coupe',
    'another seed, another liquid': 'une autre graine, un autre liquide',
    'one shape becoming another: both walked again at equal arc length, their starts matched so nothing twists, the points travelling with the progress': 'une forme qui devient une autre : toutes deux reparcourues à vitesse égale, leurs départs appariés pour rien ne se torde, les points qui voyagent avec la progression',
    'an icon becoming another (a seed into a sprout, a phone into a checkmark), a logo changing as the scene changes; give both shapes the same vertex count in spirit — the pack resamples them anyway': 'une icône qui en devient une autre (une graine en pousse, un téléphone en coche), un logo qui change quand la scène change ; donnez aux deux formes le même esprit de vertices — le pack les rééchantillonne de toute façon',
    'morphing between shapes the eye cannot bridge (a circle into a paragraph), a progress keyed faster than 0.6 s, two morphs crossing at once': 'un morphing entre formes que l’œil ne relit pas (un cercle en paragraphe), une progression keyframée plus vite que 0,6 s, deux morphings qui se croisent',
    'seeded blobs that merge and part, traced by marching squares; as a transition, a flood that crosses the frame and drains': 'des gouttes semées qui fusionnent et se séparent, tracées par des carrés de marche ; en transition, une inondation qui traverse le cadre et se retire',
    'a transition between two scenes (a liquid flooding across, then draining) or a backing shape that breathes behind a title; the seed makes it yours, the same every render': 'une transition entre deux scènes (un liquide qui traverse puis se retire) ou une forme de fond qui respire derrière un titre ; la graine fait que c’est la vôtre, pareil à chaque rendu',
    'a liquid over text (it eats it), blobs drifting faster than lava, more than nine blobs': 'un liquide sur du texte (il le mange), des gouttes qui dérivent plus vite que la lave, plus de neuf gouttes',
    'a torn sheet crossing the frame: its edge torn by seeded noise, its fibres and its shadow, revealing what is under as it passes': 'une feuille déchirée qui traverse le cadre : son bord déchiré par un bruit semé, ses fibres et son ombre, révélant ce qui est dessous en passant',
    'a transition with a hand-made feel: a sheet sweeping across between two scenes, torn edge leading; the seed keeps it the same in every render': 'une transition au feeling fait main : une feuille qui balaie entre deux scènes, bord déchiré en tête ; la graine la garde pareille à chaque rendu',
    'more than one sheet at a time, a sweep faster than 0.5 s, a paper colour fighting the scenes it covers': 'plus d’une feuille à la fois, un balayage plus vite que 0,5 s, une couleur de papier qui se bat avec les scènes qu’elle couvre',
  },
};
