// Matter: one shape becoming another, seeded blobs that merge and part, and
// a torn paper crossing the frame. All of it is a pure function of t — a
// morph resamples both paths along their length and matches their starts so
// nothing twists, the liquid traces a field of circles with marching
// squares, the paper's edge is torn by seeded noise. The same input, the
// same seed, the same picture, any frame in any order.

// ── the paths ────────────────────────────────────────────────
/** a PathValue's outline as a polyline: its vertices (the tangent points already included in them) */
function pointsOf(path) {
  const v = (path && Array.isArray(path.v)) ? path.v : [];
  const pts = v.map((p) => [Number(p?.[0]) || 0, Number(p?.[1]) || 0]);
  if (path?.closed && pts.length > 1) pts.push([pts[0][0], pts[0][1]]);
  return pts;
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
 * metaphoric circle whose radius breathes. A pure function of t — the same
 * frame asked alone or reached after every one before it gives the same
 * answer, so the drawing is the same in any order.
 */
export function liquidField(seed, t, blobs = 7, span = 1) {
  const out = [];
  for (let k = 0; k < blobs; k++) {
    const n1 = hash2(seed * 131 + k, 3), n2 = hash2(seed * 131 + k, 41), n3 = hash2(seed * 131 + k, 97);
    // each blob drifts on its own slow loop, its radius breathing on a tick
    const tick = Math.floor(t / 0.12);
    const phase = tick * 0.35 + n1 * Math.PI * 2;
    out.push({
      x: 0.5 + Math.cos(phase + n2 * 6) * (0.16 + n2 * 0.22),
      y: 0.5 + Math.sin(phase * 0.8 + n3 * 6) * (0.16 + n3 * 0.22),
      r: 0.16 + n1 * 0.12 + 0.03 * Math.sin(phase * 1.3),
    });
  }
  void span;
  return out;
}

/** the field a blob field paints: 1 inside the union, falling to 0 outside */
function fieldOf(blobs) {
  return (x, y) => {
    const u = x, v = y;
    let s = 0;
    for (const b of blobs) {
      const d2 = ((u - b.x) ** 2 + (v - b.y) ** 2) / (b.r * b.r);
      s = Math.max(s, Math.max(0, 1 - d2));
    }
    return s;
  };
}

// ── the nodes ────────────────────────────────────────────────
function tracePath(ctx, pts, close) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  if (close) ctx.closePath();
}

const morphNode = {
  type: 'matter.morph', title: 'Morph', category: 'Matter',
  description: 'one shape becoming another: both walked again at equal arc length, their starts matched so nothing twists, the points travelling with the progress',
  ai: { when: 'an icon becoming another (a seed into a sprout, a phone into a checkmark), a logo changing as the scene changes; give both shapes the same vertex count in spirit — the pack resamples them anyway', avoid: 'morphing between shapes the eye cannot bridge (a circle into a paragraph), a progress keyed faster than 0.6 s, two morphs crossing at once' },
  props: {
    a: { type: 'json', default: { v: [[-120, -120], [120, -120], [120, 120], [-120, 120]], closed: true }, label: 'From', animatable: false, description: 'a PathValue: { v: [[x, y], …], closed }' },
    b: { type: 'json', default: { v: [[0, -150], [142, 46], [-88, 46], [88, 46], [-142, 46]], closed: true }, label: 'To', animatable: false },
    progress: { type: 'number', default: 0, min: 0, max: 1, step: 0.001, label: 'Progress', description: '0: the first shape; key it to travel' },
    points: { type: 'integer', default: 96, min: 8, max: 512, label: 'Points', animatable: false },
    fill: { type: 'paint', default: '@accent', label: 'Fill' },
    stroke: { type: 'paint', default: null, nullable: true, label: 'Stroke' },
    strokeWidth: { type: 'number', default: 0, min: 0, unit: 'px', label: 'Stroke width' },
  },
  bounds(p) {
    const xs = pointsOf(p.a).concat(pointsOf(p.b)).map((q) => q[0]), ys = pointsOf(p.a).concat(pointsOf(p.b)).map((q) => q[1]);
    if (!xs.length) return { x: -120, y: -120, w: 240, h: 240 };
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },
  render: {
    canvas2d(ctx, p, host) {
      void host;
      const A = resample(p.a, p.points ?? 96), B = resample(p.b, p.points ?? 96);
      if (A.length < 3 || B.length < 3) return;
      const start = bestStart(A, B);
      const u = Math.min(1, Math.max(0, p.progress));
      const eased = 1 - Math.pow(1 - u, 3);
      const pts = A.map(([x, y], i) => {
        const [bx, by] = B[(i + start) % B.length];
        return [x + (bx - x) * eased, y + (by - y) * eased];
      });
      tracePath(ctx, pts, true);
      if (p.fill) { ctx.fillStyle = p.fill; ctx.fill('evenodd'); }
      if (p.stroke && p.strokeWidth > 0) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.strokeWidth; ctx.lineJoin = 'round'; ctx.stroke(); }
    },
  },
};

const liquidNode = {
  type: 'matter.liquid', title: 'Liquid', category: 'Matter',
  description: 'seeded blobs that merge and part, traced by marching squares; as a transition, a flood that crosses the frame and drains',
  ai: { when: 'a transition between two scenes (a liquid flooding across, then draining) or a backing shape that breathes behind a title; the seed makes it yours, the same every render', avoid: 'a liquid over text (it eats it), blobs drifting faster than lava, more than nine blobs', },
  props: {
    seed: { type: 'integer', default: 1, min: 0, label: 'Seed', description: 'another seed, another liquid' },
    blobs: { type: 'integer', default: 6, min: 2, max: 12, label: 'Blobs', animatable: false },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: '1: the liquid settled on screen; key 0 to 1 to flood it in' },
    cell: { type: 'number', default: 14, min: 4, unit: 'px', label: 'Grid', animatable: false },
    fill: { type: 'paint', default: '@accent', label: 'Liquid' },
    size: { type: 'vec2', default: [900, 560], label: 'Size', unit: 'px' },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  path({ size: [w, h] }) { const s = new Path2D(); s.rect(-w / 2, -h / 2, w, h); return s; },
  render: {
    canvas2d(ctx, p, host) {
      void host;
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      const blobs = liquidField(p.seed ?? 1, host.t - (host.layerIn ?? 0), p.blobs ?? 6);
      const field = fieldOf(blobs);
      const level = 0.5;
      // the flood: the level sweeps with the progress (0: nothing; 1: the whole union)
      const u = Math.min(1, Math.max(0, p.progress));
      const loops = marchingSquares((x, y) => field(x / w, y / h) - (1 - u) * 1.2, w, h, p.cell ?? 14, level);
      ctx.fillStyle = p.fill;
      for (const loop of loops) { tracePath(ctx, loop, true); ctx.fill('evenodd'); }
    },
  },
};

const paperNode = {
  type: 'matter.paper', title: 'Paper', category: 'Matter',
  description: 'a torn sheet crossing the frame: its edge torn by seeded noise, its fibres and its shadow, revealing what is under as it passes',
  ai: { when: 'a transition with a hand-made feel: a sheet sweeping across between two scenes, torn edge leading; the seed keeps it the same in every render', avoid: 'more than one sheet at a time, a sweep faster than 0.5 s, a paper colour fighting the scenes it covers' },
  props: {
    progress: { type: 'number', default: 0, min: 0, max: 1, step: 0.001, label: 'Progress', description: '0: off screen left; 1: gone right; key it over the cut' },
    angle: { type: 'number', default: -6, min: -45, max: 45, unit: '°', label: 'Angle', animatable: false },
    seed: { type: 'integer', default: 1, min: 0, label: 'Seed' },
    rough: { type: 'number', default: 16, min: 2, unit: 'px', label: 'Roughness' },
    paper: { type: 'paint', default: '#F6F1E6', label: 'Paper' },
    shadow: { type: 'bool', default: true, label: 'Shadow', animatable: false },
    fibres: { type: 'bool', default: true, label: 'Fibres', animatable: false },
  },
  bounds(p, host) { return { x: -host.width, y: -host.height, w: host.width * 2, h: host.height * 2 }; },
  render: {
    canvas2d(ctx, p, host) {
      const w = host.width, h = host.height;
      const u = Math.min(1, Math.max(0, p.progress));
      // the sheet's torn edge crosses the frame; before and after, the sheet is out
      const x = -w * 1.15 + u * w * 2.3;
      const edge = tornEdge(h * 1.3, p.seed ?? 1, p.rough ?? 16);
      ctx.save();
      ctx.rotate(((p.angle ?? 0) * Math.PI) / 180);
      const sheet = [[x, -h], ...edge.map(([ex, ey]) => [x + ex - h * 0.65, ey - h * 0.65]), [x + h * 1.3, -h], [x + h * 1.3, h], [x, h]];
      if (p.shadow) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.save(); ctx.translate(w * 0.012, h * 0.008);
        tracePath(ctx, sheet, true); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = p.paper;
      tracePath(ctx, sheet, true); ctx.fill();
      if (p.fibres) {
        // the fibres: short strokes off the torn edge, seeded
        ctx.strokeStyle = 'rgba(0,0,0,0.16)';
        ctx.lineWidth = 1;
        for (let k = 0; k < edge.length; k += 2) {
          const [ex, ey] = edge[k];
          const n = hash2(p.seed ?? 1, k * 7);
          ctx.beginPath();
          ctx.moveTo(x + ex - h * 0.65, ey - h * 0.65);
          ctx.lineTo(x + ex - h * 0.65 - 3 - n * 6, ey - h * 0.65 + (n - 0.5) * 8);
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
