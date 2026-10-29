// Physics: four nodes that carry a state from frame to frame (NodeType
// simulate) — confetti falling with wind, balls bouncing off each other and
// the walls, a rope in verlet, letters that drop and settle. Everything is
// deterministic: the states are seeded from the layer's id, the steps are
// pure functions of the previous state, and the engine keeps checkpoints so
// any frame renders in any order and always gives the same picture.

// mulberry32, inlined: a plugin module is self-contained (no engine imports)
function rngOf(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a stable seed per layer, so the same layer always runs the same physics
const seedOf = (s) => [...String(s)].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 7);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const CONFETTI_COLORS = ['#E5402A', '#2EC4B6', '#F2B54D', '#7AA8FF', '#E07A8E', '#4FD1C5'];

const confetti = {
  type: 'phys.confetti', title: 'Confetti', category: 'Physics',
  ai: { when: 'a celebration, a reveal, an end card: confetti bursts over about a second and falls through the rest of the layer; keep it behind titles', avoid: 'confetti over text (it eats it), more than one burst in the same composition' },
  props: {
    count: { type: 'number', default: 120, min: 1, max: 600, step: 1, label: 'Pieces', animatable: false },
    emitFor: { type: 'number', default: 1.2, min: 0.05, unit: 's', label: 'Emit over', animatable: false },
    gravity: { type: 'number', default: 620, min: 0, step: 10, label: 'Gravity', animatable: false },
    wind: { type: 'number', default: 120, min: 0, step: 10, label: 'Wind', animatable: false },
    drag: { type: 'number', default: 0.6, min: 0, max: 4, step: 0.05, label: 'Air', animatable: false },
    loop: { type: 'bool', default: false, label: 'Loop', animatable: false, description: 'pieces that reach the floor are thrown back to the top' },
    size: { type: 'vec2', default: [1200, 800], label: 'Area', unit: 'px' },
    colors: { type: 'json', default: CONFETTI_COLORS, label: 'Colors', animatable: false },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  simulate: {
    init(p, host) {
      return { seed: seedOf(host.layerId), k: 0, parts: [], spawned: 0, time: 0 };
    },
    step(state, p, dt, host) {
      void host;
      // a fresh generator per step, seeded by the step's number: deterministic, and the pieces stay varied
      const r = rngOf((state.seed + state.k * 7919) | 0);
      const time = state.time + dt, [w, h] = p.size;
      let spawned = state.spawned;
      const parts = state.parts.map((q) => ({ ...q }));
      // emit over emitFor, from the top, spread across the width
      while (spawned < p.count && (spawned / Math.max(1, p.count)) * p.emitFor <= time) {
        spawned++;
        parts.push({
          x: (r() - 0.5) * w, y: -h / 2 - r() * h * 0.2 - spawned * 0.5,
          vx: (r() - 0.5) * 220, vy: 60 + r() * 160,
          rot: r() * Math.PI * 2, vr: (r() - 0.5) * 9,
          w: 6 + r() * 9, h: 10 + r() * 12,
          phase: r() * Math.PI * 2,
          color: p.colors[Math.floor(r() * p.colors.length)] ?? '#FFFFFF',
        });
      }
      for (const q of parts) {
        q.vy += p.gravity * dt;
        q.vy *= 1 - Math.min(0.9, p.drag * dt);
        q.vx *= 1 - Math.min(0.9, p.drag * dt);
        q.vx += Math.sin(time * 2.1 + q.phase) * p.wind * dt;
        q.x += q.vx * dt; q.y += q.vy * dt;
        q.rot += q.vr * dt;
        if (q.y > h / 2 + 30) {
          if (p.loop) { q.y = -h / 2 - 20; q.x = (r() - 0.5) * w; q.vy = 40 + r() * 120; }
          else q.y = h / 2 + 30;
        }
      }
      return { seed: state.seed, k: state.k + 1, parts, spawned, time };
    },
  },
  render: {
    canvas2d(ctx, p, host) {
      const s = host.state();
      if (!s) return;
      for (const q of s.parts) {
        ctx.save();
        ctx.translate(q.x, q.y); ctx.rotate(q.rot);
        ctx.fillStyle = q.color;
        ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
        ctx.restore();
      }
    },
  },
};

// the generator's state is a plain seed number carried through the immutable steps

const bounce = {
  type: 'phys.bounce', title: 'Bouncing balls', category: 'Physics',
  ai: { when: 'energy behind a logo or a counter: a handful of balls loose in a box; keep 6 to 16, the box the size of a third of the frame', avoid: 'too many balls (they turn to noise), balls the same colour as the background' },
  props: {
    count: { type: 'number', default: 10, min: 1, max: 40, step: 1, label: 'Balls', animatable: false },
    minR: { type: 'number', default: 26, min: 4, unit: 'px', label: 'Smallest', animatable: false },
    maxR: { type: 'number', default: 64, min: 4, unit: 'px', label: 'Biggest', animatable: false },
    gravity: { type: 'number', default: 500, min: 0, step: 10, label: 'Gravity', animatable: false },
    restitution: { type: 'number', default: 0.86, min: 0.1, max: 1, step: 0.01, label: 'Bounce', animatable: false },
    size: { type: 'vec2', default: [900, 600], label: 'Box', unit: 'px' },
    colors: { type: 'json', default: CONFETTI_COLORS, label: 'Colors', animatable: false },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  simulate: {
    init(p, host) {
      const r = rngOf(seedOf(host.layerId));
      const [w, h] = p.size, parts = [];
      for (let i = 0; i < p.count; i++) {
        const rad = p.minR + r() * Math.max(1, p.maxR - p.minR);
        parts.push({
          r: rad,
          x: (r() - 0.5) * (w - 2 * rad), y: (r() - 0.5) * (h - 2 * rad),
          vx: (r() - 0.5) * 460, vy: (r() - 0.5) * 300,
          color: p.colors[Math.floor(r() * p.colors.length)] ?? '#FFFFFF',
        });
      }
      return { parts, r: rngStateOf(String(seedOf(host.layerId))) };
    },
    step(state, p, dt) {
      const [w, h] = p.size, parts = state.parts.map((q) => ({ ...q }));
      for (const q of parts) {
        q.vy += p.gravity * dt;
        q.x += q.vx * dt; q.y += q.vy * dt;
        if (q.x < -w / 2 + q.r) { q.x = -w / 2 + q.r; q.vx = Math.abs(q.vx) * p.restitution; }
        if (q.x > w / 2 - q.r) { q.x = w / 2 - q.r; q.vx = -Math.abs(q.vx) * p.restitution; }
        if (q.y < -h / 2 + q.r) { q.y = -h / 2 + q.r; q.vy = Math.abs(q.vy) * p.restitution; }
        if (q.y > h / 2 - q.r) { q.y = h / 2 - q.r; q.vy = -Math.abs(q.vy) * p.restitution; }
      }
      // equal-mass balls: their velocity components along the line of centres swap
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], b = parts[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
        if (d >= min || d === 0) continue;
        const nx = dx / d, ny = dy / d, overlap = (min - d) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
        const av = a.vx * nx + a.vy * ny, bv = b.vx * nx + b.vy * ny;
        if (av - bv <= 0) continue;
        a.vx += (bv - av) * nx; a.vy += (bv - av) * ny;
        b.vx += (av - bv) * nx; b.vy += (av - bv) * ny;
      }
      return { parts, r: state.r };
    },
  },
  render: {
    canvas2d(ctx, p, host) {
      const s = host.state();
      if (!s) return;
      for (const q of s.parts) {
        ctx.fillStyle = q.color;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
      }
    },
  },
};

const rope = {
  type: 'phys.rope', title: 'Rope', category: 'Physics',
  ai: { when: 'something strung across the frame that should sag and swing (a banner, a cable, a washing line); a title can hang from it', avoid: 'ropes tighter than the distance between their pins (they will stretch, not sag)' },
  props: {
    segments: { type: 'number', default: 26, min: 4, max: 80, step: 1, label: 'Segments', animatable: false },
    sag: { type: 'number', default: 0.3, min: 0.05, max: 1, step: 0.01, unit: 'x', label: 'Sag', animatable: false, description: 'how much longer than the span the rope is' },
    gravity: { type: 'number', default: 900, min: 0, step: 10, label: 'Gravity', animatable: false },
    wind: { type: 'number', default: 260, min: 0, step: 10, label: 'Wind', animatable: false },
    swing: { type: 'enum', default: 'both', options: ['both', 'left', 'right'], label: 'Pinned', animatable: false, description: 'which ends are nailed to the frame' },
    thickness: { type: 'number', default: 7, min: 1, unit: 'px', label: 'Thickness' },
    color: { type: 'paint', default: '#E5402A', label: 'Color' },
    size: { type: 'vec2', default: [1000, 500], label: 'Area', unit: 'px' },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  simulate: {
    init(p, host) {
      void host;
      const [w, h] = p.size, n = p.segments;
      const x0 = -w / 2, y0 = -h / 2 + h * 0.15;
      const points = [];
      for (let i = 0; i <= n; i++) points.push({ x: x0 + (w * i) / n, y: y0, px: x0 + (w * i) / n, py: y0 });
      return { points };
    },
    step(state, p, dt, host) {
      const [w, h] = p.size, points = state.points.map((q) => ({ ...q }));
      const t = host.t - (host.layerIn ?? 0);
      const pinned = (i) => (i === 0 && p.swing !== 'right') || (i === points.length - 1 && p.swing !== 'left');
      // verlet: each free point carries its own inertia, gravity and a gust of wind
      for (let i = 0; i < points.length; i++) {
        if (pinned(i)) continue;
        const q = points[i];
        const vx = (q.x - q.px) * 0.985, vy = (q.y - q.py) * 0.985;
        q.px = q.x; q.py = q.y;
        q.x += vx + Math.sin(t * 1.7 + i * 0.3) * p.wind * dt * dt;
        q.y += vy + p.gravity * dt * dt;
        q.y = Math.min(q.y, h / 2 + 40);
      }
      // distance constraints, a few passes: the rope keeps its rest length
      const rest = (w * (1 + p.sag * 0.4)) / p.segments;
      for (let k = 0; k < 3; k++) {
        for (let i = 0; i < points.length - 1; i++) {
          const a = points[i], b = points[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001, diff = (d - rest) / d;
          const am = pinned(i) ? 0 : 1, bm = pinned(i + 1) ? 0 : 1, total = am + bm;
          if (!total) continue;
          a.x += dx * diff * (am / total); a.y += dy * diff * (am / total);
          b.x -= dx * diff * (bm / total); b.y -= dy * diff * (bm / total);
        }
      }
      return { points };
    },
  },
  render: {
    canvas2d(ctx, p, host) {
      const s = host.state();
      if (!s) return;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.thickness;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (const q of s.points.slice(1)) ctx.lineTo(q.x, q.y);
      ctx.stroke();
    },
  },
};

const textDrop = {
  type: 'phys.text-drop', title: 'Text drop', category: 'Physics',
  ai: { when: 'a word that lands (a punchline, a brand): the letters fall, knock into each other and pile up the way they land', avoid: 'more than about 12 characters (the pile gets taller than the joke), a drop taller than the frame' },
  props: {
    text: { type: 'text', default: 'BOOM', label: 'Text', animatable: false },
    size: { type: 'number', default: 220, min: 4, unit: 'px', label: 'Size' },
    weight: { type: 'number', default: 900, min: 100, max: 900, step: 100, label: 'Weight', animatable: false },
    color: { type: 'paint', default: '#FFFFFF', label: 'Color' },
    per: { type: 'number', default: 0.07, min: 0, step: 0.01, unit: 's', label: 'Between letters', animatable: false },
    height: { type: 'number', default: 1.4, min: 0.3, step: 0.1, unit: 'x', label: 'Falls from', animatable: false, description: 'in letter heights' },
    bounciness: { type: 'number', default: 0.32, min: 0, max: 0.8, step: 0.02, label: 'Bounce', animatable: false },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds(p) { return { x: -p.size * 1.6, y: -p.size * (1 + p.height), w: p.size * 3.2, h: p.size * (2 + p.height) }; },
  simulate: {
    init(p, host) {
      // the letters are bodies now: they knock into each other and pile up
      const widths = [...String(p.text ?? '')].map(() => p.size * 0.62);
      return { widths, world: dropWorld(p, widths), t: 0, started: [...String(p.text ?? '')].map((_, i) => i * p.per) };
    },
    step(state, p, dt) {
      const t = state.t + dt;
      // the letters still waiting hang where they started; the fallen ones are the engine's
      const bodies = state.world.bodies.map((b) => {
        if (b.id === 'floor') return b;
        const i = Number(String(b.id).slice(2));
        if (t < state.started[i]) return { ...b, homeX: b.homeX ?? b.x, homeY: b.homeY ?? b.y, x: b.homeX ?? b.x, y: b.homeY ?? b.y, vx: 0, vy: 0 };
        return b;
      });
      return { ...state, world: stepWorld({ gravity: state.world.gravity, bodies }, Math.min(1 / 30, dt)), t };
    },
  },
  render: {
    canvas2d(ctx, p, host) {
      const text = String(p.text ?? '');
      if (!text) return;
      const s = host.state();
      if (!s) return;
      let family = '';
      if (p.font) { try { family = `"${host.asset(p.font)}", `; } catch { family = ''; } }
      ctx.font = `${p.weight} ${p.size}px ${family}system-ui, sans-serif`;
      ctx.fillStyle = p.color;
      ctx.textBaseline = 'alphabetic';
      const chars = [...text];
      const widths = s.widths ?? chars.map(() => p.size * 0.62);
      const total = widths.reduce((a, b) => a + b, 0);
      let x = -total / 2;
      chars.forEach((ch, i) => {
        const b = s.world?.bodies?.[i];
        const w = widths[i];
        // a letter shows once its fall has started (the ones still waiting are not hung in the air)
        if (b && s.t >= (s.started?.[i] ?? 0)) {
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(b.angle || 0);
          ctx.textAlign = 'center';
          ctx.fillText(ch, 0, p.size * 0.47);
          ctx.restore();
        }
        x += w;
      });
    },
  },
};

// ── 1.1: the rigid bodies ────────────────────────────────────
const RAD = Math.PI / 180;

/** a body's outline in world space, its corners turned by its angle */
function outline(b) {
  if (b.kind === 'circle') return null;
  let pts = b.verts;
  if (!pts && b.w !== undefined) pts = [[-b.w / 2, -b.h / 2], [b.w / 2, -b.h / 2], [b.w / 2, b.h / 2], [-b.w / 2, b.h / 2]];
  if (!pts) return [];
  const c = Math.cos(b.angle || 0), s = Math.sin(b.angle || 0);
  return pts.map(([x, y]) => [b.x + x * c - y * s, b.y + x * s + y * c]);
}

/** the closest point of a segment ab to p, with the segment's normal facing p */
function closestOnSeg(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby || 1e-9;
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2));
  return [a[0] + abx * u, a[1] + aby * u];
}

/** one contact between two bodies, or null: circle-circle, circle-shape, shape-shape (the deepest vertex of A in B, then of B in A) */
function contact(a, b) {
  if (a.kind === 'circle' && b.kind === 'circle') {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-9, pen = a.r + b.r - d;
    if (pen <= 0) return null;
    return { nx: dx / d, ny: dy / d, pen, px: a.x + (dx / d) * a.r, py: a.y + (dy / d) * a.r };
  }
  const circle = a.kind === 'circle' ? [a, b, 1] : b.kind === 'circle' ? [b, a, -1] : null;
  if (circle) {
    const [c, poly, flip] = circle;
    const pts = outline(poly);
    let best = null, bestD = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = closestOnSeg([c.x, c.y], pts[i], pts[(i + 1) % pts.length]);
      const dx = c.x - p[0], dy = c.y - p[1], d = Math.hypot(dx, dy) || 1e-9;
      const pen = c.r - d;
      if (pen > bestD) { bestD = pen; best = { nx: dx / d, ny: dy / d, pen, px: p[0], py: p[1] }; }
    }
    if (!best || best.pen <= 0) return null;
    return flip > 0 ? { nx: -best.nx, ny: -best.ny, pen: best.pen, px: best.px, py: best.py } : best;
  }
  // shape-shape: SAT over the faces of both — the least-overlap axis is the
  // normal, the contact the deepest vertices of the other clipped to the face
  const satFace = (P, Q) => {
    const ps = outline(P), qs = outline(Q);
    if (!ps.length || !qs.length) return null;
    let best = null;
    for (let i = 0; i < ps.length; i++) {
      const a2 = ps[i], b2 = ps[(i + 1) % ps.length];
      const ex = b2[0] - a2[0], ey = b2[1] - a2[1];
      const nl = Math.hypot(ey, -ex) || 1e-9;
      const nx = ey / nl, ny = -ex / nl;
      let minQ = Infinity, maxQ = -Infinity, minP = Infinity;
      for (const [vx, vy] of ps) { const d = (vx - a2[0]) * nx + (vy - a2[1]) * ny; if (d < minP) minP = d; }
      for (const [vx, vy] of qs) { const d = (vx - a2[0]) * nx + (vy - a2[1]) * ny; if (d < minQ) minQ = d; if (d > maxQ) maxQ = d; }
      // Q is behind P's face by -minQ when minQ < 0
      if (minQ > 0) return null; // Q entirely outside this face: no contact
      const depth = -minQ;
      if (!best || depth < best.depth) best = { depth, nx, ny, a2 }; // SAT: the least-overlap axis
      void maxQ;
    }
    return best;
  };
  const fa = satFace(a, b), fb = satFace(b, a);
  if (!fa || !fb) return null;
  // the axis of least penetration carries the contact; the normal faces from A toward B
  const ref = fa.depth <= fb.depth ? { ...fa, flip: 1 } : { ...fb, flip: -1 };
  const incident = ref.flip > 0 ? outline(b) : outline(a);
  // the deepest vertices of the other shape behind the reference face, clipped to it
  const deep = incident.map(([vx, vy]) => ({ vx, vy, d: (vx - ref.a2[0]) * ref.nx + (vy - ref.a2[1]) * ref.ny }))
    .filter((x) => x.d < 0.5).sort((x, y) => x.d - y.d).slice(0, 2);
  if (!deep.length) return null;
  const nx = ref.nx * ref.flip, ny = ref.ny * ref.flip;
  const best = { nx, ny, pen: ref.depth, px: deep[0].vx, py: deep[0].vy };
  best.twin = deep[1] ? { px: deep[1].vx, py: deep[1].vy } : null;
  return best;
}

/**
 * The world one step on, a new object every time: the bodies fall, meet, and
 * the impulses solve them — a normal push with restitution, a tangential one
 * with friction, a body slow for a while put to sleep. Pure: the same world
 * and dt give the same answer, so frame 90 is the same reached directly or
 * frame by frame.
 */
export function stepWorld(world, dt) {
  const g = world.gravity ?? [0, 900];
  const bodies = world.bodies.map((b) => ({ vx: 0, vy: 0, va: 0, angle: 0, ...b, asleep: false }));
  for (const b of bodies) {
    if (b.static) continue;
    b.vx += g[0] * dt;
    b.vy += g[1] * dt;
    const damp = 1 - Math.min(0.2, 0.6 * dt);
    b.vx *= damp;
    b.vy *= damp;
    b.va = (b.va || 0) * (1 - Math.min(0.2, 1.2 * dt));
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.angle = (b.angle || 0) + (b.va || 0) * dt;
  }
  const iterations = 10;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const A = bodies[i], B = bodies[j];
        if (A.static && B.static) continue;
        const one = contact(A, B);
        const cs = one ? [one, ...(one.twin ? [{ ...one, px: one.twin.px, py: one.twin.py }] : [])] : [];
        for (const c of cs) {
        const rax = c.px - A.x, ray = c.py - A.y, rbx = c.px - B.x, rby = c.py - B.y;
        const relX = B.vx - (B.va || 0) * rby - (A.vx - (A.va || 0) * ray);
        const relY = B.vy + (B.va || 0) * rbx - (A.vy + (A.va || 0) * rax);
        const vn = relX * c.nx + relY * c.ny;
        const invA = A.static ? 0 : 1 / (A.mass || 1), invB = B.static ? 0 : 1 / (B.mass || 1);
        const invIA = A.static || !A.w && !A.verts ? 0 : 1 / (A.inertia || 1), invIB = B.static || !B.w && !B.verts ? 0 : 1 / (B.inertia || 1);
        if (vn < 0) {
          const e = Math.min(A.restitution ?? 0.2, B.restitution ?? 0.2) * (Math.abs(vn) > 40 ? 1 : 0);
          const jn = (-(1 + e) * vn) / (invA + invB + invIA * (rax * c.ny - ray * c.nx) ** 2 + invIB * (rbx * c.ny - rby * c.nx) ** 2 || 1e-9);
          const ix = jn * c.nx, iy = jn * c.ny;
          A.vx -= ix * invA; A.vy -= iy * invA; A.va = (A.va || 0) - invIA * (rax * iy - ray * ix);
          B.vx += ix * invB; B.vy += iy * invB; B.va = (B.va || 0) + invIB * (rbx * iy - rby * ix);
          // the friction: a tangential push clamped by the cone
          const tx = -c.ny, ty = c.nx;
          const vt = (B.vx - B.va * rby - (A.vx - A.va * ray)) * tx + (B.vy + B.va * rbx - (A.vy + A.va * rax)) * ty;
          const mu = Math.min(A.friction ?? 0.4, B.friction ?? 0.4);
          let jt = -vt / (invA + invB + 1e-9);
          jt = Math.max(-mu * Math.abs(jn), Math.min(mu * Math.abs(jn), jt));
          A.vx -= jt * tx * invA; A.vy -= jt * ty * invA;
          B.vx += jt * tx * invB; B.vy += jt * ty * invB;
          // positional correction, Baumgarte-style: the overlap eased out
          const percent = 0.22, slop = 0.6;
          // the pair's correction is shared by its contact points, or two points push twice
          const corr = (Math.max(0, c.pen - slop) / (invA + invB || 1)) * percent / Math.max(1, cs.length);
          A.x -= c.nx * corr * invA; A.y -= c.ny * corr * invA;
          B.x += c.nx * corr * invB; B.y += c.ny * corr * invB;
        }
        }
      }
    }
  }
  // the sleep: a body slower than the floor for a while stops being moved
  for (const b of bodies) {
    if (b.static) continue;
    const slow = Math.hypot(b.vx, b.vy) < 26 && Math.abs(b.va || 0) < 0.2;
    b.still = slow ? (b.still ?? 0) + dt : 0;
    // a slow body in contact stops spinning: the stacks keep their faces level
    if (Math.hypot(b.vx, b.vy) < 60) b.va = (b.va || 0) * 0.82;
    b.va = Math.max(-6, Math.min(6, b.va || 0));
    b.asleep = (b.still ?? 0) > 0.5;
    if (b.asleep) { b.vx = 0; b.vy = 0; b.va = 0; }
  }
  return { ...world, bodies };
}

/** a world stepped to a time, dt by dt (the node's simulate keeps checkpoints, so any frame renders in any order) */
export function worldAt(world, dt, t) {
  let w = world;
  for (let k = 0; k * dt < t - 1e-9; k++) w = stepWorld(w, dt);
  return w;
}

const bodiesNode = {
  type: 'phys.bodies', title: 'Bodies', category: 'Physics',
  description: 'boxes, circles and convex shapes that fall, collide, stack and come to rest — impulses, friction, restitution, sleep, the frame and floors as static segments',
  ai: { when: 'a rigid-body pile (blocks, balls) that builds itself: blocks dropped into a frame, balls settling, a stack knocked over; the bodies are what the props list, the floor the frame\'s bottom unless the walls are off', avoid: 'more than 40 bodies (the solver crawls), restitution over 0.5 in a pile (it never settles), bodies the viewer counts individually' },
  props: {
    bodies: { type: 'json', default: [
      { kind: 'box', x: 0, y: -320, w: 120, h: 120 },
      { kind: 'box', x: -40, y: -560, w: 120, h: 120 },
      { kind: 'box', x: 60, y: -560, w: 120, h: 120 },
      { kind: 'circle', x: 20, y: -820, r: 60 },
    ], label: 'Bodies', animatable: false, description: '[{ kind: "box"|"circle"|"poly", x, y, w, h?, r?, verts?, angle?, static?, restitution?, friction? }]' },
    gravity: { type: 'number', default: 900, min: 0, step: 10, label: 'Gravity', animatable: false },
    restitution: { type: 'number', default: 0.2, min: 0, max: 0.9, step: 0.02, label: 'Bounce', animatable: false },
    friction: { type: 'number', default: 0.4, min: 0, max: 1, step: 0.05, label: 'Friction', animatable: false },
    walls: { type: 'bool', default: true, label: 'Walls', animatable: false, description: 'the frame\'s sides and floor as static bodies' },
    fill: { type: 'paint', default: '@accent', label: 'Fill' },
    ink: { type: 'paint', default: '@text', label: 'Edge' },
    size: { type: 'vec2', default: [900, 600], label: 'Area', unit: 'px' },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  simulate: {
    init(p, host) {
      const [w, h] = p.size;
      const list = (Array.isArray(p.bodies) ? p.bodies : []).map((b, i) => ({
        id: `b${i}`, kind: b.kind ?? 'box', x: b.x ?? 0, y: b.y ?? 0, vx: 0, vy: 0, angle: (b.angle ?? 0) * RAD, va: 0,
        w: b.w, h: b.h, r: b.r, verts: b.verts,
        mass: b.static ? 0 : Math.max(0.4, ((b.w ?? 0) * (b.h ?? 0) || Math.PI * (b.r ?? 10) ** 2 || 4000) / 4000),
        inertia: b.static ? 0 : Math.max(40, ((b.w ?? b.r * 2 ?? 40) ** 2 + (b.h ?? b.r * 2 ?? 40) ** 2) / 12 * Math.max(0.4, ((b.w ?? 0) * (b.h ?? 0) || Math.PI * (b.r ?? 10) ** 2 || 4000) / 4000) * 100),
        restitution: b.restitution ?? p.restitution ?? 0.2,
        friction: b.friction ?? p.friction ?? 0.4,
        static: !!b.static,
      }));
      if (p.walls !== false) {
        list.push({ id: 'floor', kind: 'box', x: 0, y: h / 2 + 40, w: w * 3, h: 80, static: true, mass: 0, inertia: 0, restitution: p.restitution ?? 0.2, friction: p.friction ?? 0.4 });
        list.push({ id: 'wallL', kind: 'box', x: -w / 2 - 40, y: 0, w: 80, h: h * 3, static: true, mass: 0, inertia: 0, restitution: p.restitution ?? 0.2, friction: p.friction ?? 0.4 });
        list.push({ id: 'wallR', kind: 'box', x: w / 2 + 40, y: 0, w: 80, h: h * 3, static: true, mass: 0, inertia: 0, restitution: p.restitution ?? 0.2, friction: p.friction ?? 0.4 });
      }
      return { world: { gravity: [0, p.gravity ?? 900], bodies: list }, t: 0 };
    },
    step(state, p, dt) {
      return { world: stepWorld(state.world, Math.min(1 / 30, dt)), t: state.t + dt };
    },
  },
  render: {
    canvas2d(ctx, p, host) {
      const s = host.state();
      if (!s) return;
      ctx.lineWidth = 2;
      for (const b of s.world.bodies) {
        if (b.id === 'floor' || b.id === 'wallL' || b.id === 'wallR') continue;
        ctx.fillStyle = p.fill;
        ctx.strokeStyle = p.ink;
        if (b.kind === 'circle') {
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(b.angle || 0) * b.r * 0.8, b.y + Math.sin(b.angle || 0) * b.r * 0.8); ctx.stroke();
        } else {
          const pts = outline(b);
          ctx.beginPath();
          pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
    },
  },
};

/** the text drop, its letters made bodies: they knock into each other and pile up */
function dropWorld(p, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  let x = -total / 2;
  const bodies = [...String(p.text ?? '')].map((ch, i) => {
    const w = widths[i], h = p.size * 0.94;
    const body = { id: `ch${i}`, kind: 'box', x: x + w / 2, y: -p.size * (1 + p.height) - i * p.size * 0.35, w, h, vx: 0, vy: 0, angle: 0, va: 0, mass: 1, inertia: (w * w + h * h) / 12, restitution: p.bounciness ?? 0.3, friction: 0.5 };
    x += w;
    return body;
  });
  // the floor's top is the line's baseline: a letter at rest stands where the text would
  bodies.push({ id: 'floor', kind: 'box', x: 0, y: 40, w: total * 4, h: 80, static: true, mass: 0, inertia: 0, restitution: 0.1, friction: 0.6 });
  return { gravity: [0, 2600], bodies };
}

export const meta = { id: 'tramme/physics', name: 'physics', version: '1.1.0', description: 'Confetti, bouncing balls, a rope, letters that drop and bodies that pile up: five simulated nodes', api: 1 };
export const nodes = [confetti, bounce, rope, textDrop, bodiesNode];
export const presets = [
  { name: 'phys-confetti', title: 'Confetti burst', category: 'Physics', description: '120 pieces falling with wind', layer: { type: 'phys.confetti', name: 'Confetti', props: { size: [1200, 800] } } },
  { name: 'phys-bounce', title: 'Bouncing balls', category: 'Physics', description: 'ten balls loose in a box', layer: { type: 'phys.bounce', name: 'Balls', props: { size: [900, 600] } } },
  { name: 'phys-rope', title: 'Rope', category: 'Physics', description: 'a sagging rope pinned at both ends', layer: { type: 'phys.rope', name: 'Rope', props: { size: [1000, 500] } } },
  { name: 'phys-text-drop', title: 'Text drop', category: 'Physics', description: 'a word that falls and settles', layer: { type: 'phys.text-drop', name: 'Text drop', props: { text: 'BOOM' } } },
];
export const messages = {
  fr: {
    'Confetti': 'Confettis', 'Bouncing balls': 'Balles rebondissantes', 'Rope': 'Corde', 'Text drop': 'Texte qui tombe', 'Bodies': 'Corps',
    'boxes, circles and convex shapes that fall, collide, stack and come to rest — impulses, friction, restitution, sleep, the frame and floors as static segments': 'des boîtes, cercles et formes convexes qui tombent, se heurtent, s\'empilent et se posent — impulsions, frottement, rebond, sommeil, le cadre et ses sols en segments statiques',
    '[{ kind: "box"|"circle"|"poly", x, y, w, h?, r?, verts?, angle?, static?, restitution?, friction? }]': '[{ kind: "box"|"circle"|"poly", x, y, w, h ?, r ?, verts ?, angle ?, static ?, restitution ?, friction ? }]',
    'the frame\'s sides and floor as static bodies': 'les côtés du cadre et son sol en corps statiques',
    'Fill': 'Remplissage',
    'Pieces': 'Mordeaux', 'Emit over': 'Émis en', 'Gravity': 'Gravité', 'Wind': 'Vent', 'Air': 'Air', 'Loop': 'Boucle',
    'Area': 'Zone', 'Colors': 'Couleurs', 'Balls': 'Balles', 'Smallest': 'Petit rayon', 'Biggest': 'Grand rayon', 'Bounce': 'Rebond', 'Friction': 'Frottement', 'Walls': 'Murs', 'Edge': 'Bord',
    'Bounce': 'Rebond', 'Box': 'Boîte', 'Segments': 'Segments', 'Sag': 'Affaissement', 'Pinned': 'Attachée',
    'Thickness': 'Épaisseur', 'Color': 'Couleur', 'Text': 'Texte', 'Between letters': 'Entre les lettres',
    'Falls from': 'Tombe de', 'Size': 'Corps', 'Weight': 'Graisse', 'Font': 'Police',
    'pieces that reach the floor are thrown back to the top': 'les mordeaux qui touchent le sol sont renvoyés en haut',
    'how much longer than the span the rope is': 'de combien la corde dépasse sa portée',
    'which ends are nailed to the frame': 'quelles extrémités sont clouées au cadre',
    'in letter heights': 'en hauteurs de lettre',
    'Confetti burst': 'Éclat de confettis',
    '120 pieces falling with wind': '120 mordeaux qui tombent avec du vent',
    'ten balls loose in a box': 'dix balles livrées à elles-mêmes dans une boîte',
    'a sagging rope pinned at both ends': 'une corde qui affaisse, attachée aux deux bouts',
    'a word that falls and settles': 'un mot qui tombe et se pose',
  },
};
