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
  ai: { when: 'a word that lands (a punchline, a brand): the letters fall, bounce once and settle into the line', avoid: 'more than about 20 characters (the wait gets longer than the joke), a drop taller than the frame' },
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
      const chars = [...String(p.text ?? '')];
      return {
        chars: chars.map((_, i) => ({ y: -p.height * (1 + i * 0.06), v: 0, rot: 0, vr: 0, started: i * p.per, landed: false })),
        t: 0,
      };
    },
    step(state, p, dt) {
      const t = state.t + dt;
      const chars = state.chars.map((c) => ({ ...c }));
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (t < c.started) continue;
        if (!c.landed) {
          c.v += 2600 * dt;
          c.y += c.v * dt;
          c.rot = clamp(c.rot + c.vr * dt, -0.35, 0.35);
          if (c.y >= 0) {
            c.y = 0;
            if (Math.abs(c.v) > 140) { c.v = -c.v * p.bounciness; c.vr = (i % 2 ? 1 : -1) * Math.abs(c.v) * 0.0012; }
            else { c.landed = true; c.v = 0; }
          }
        } else {
          // settled: the little leftover rotation eases out
          c.rot *= 1 - Math.min(1, 8 * dt);
        }
      }
      return { chars, t };
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
      const widths = chars.map((ch) => ctx.measureText(ch).width);
      const total = widths.reduce((a, b) => a + b, 0);
      let x = -total / 2;
      chars.forEach((ch, i) => {
        const c = s.chars[i];
        const w = widths[i];
        if (!c || s.t >= c.started) {
          const y = c ? c.y : 0, rot = c ? c.rot : 0;
          ctx.save();
          ctx.translate(x + w / 2, y);
          ctx.rotate(rot);
          ctx.fillText(ch, -w / 2, 0);
          ctx.restore();
        }
        x += w;
      });
    },
  },
};

export const meta = { id: 'tramme/physics', name: 'physics', version: '1.0.0', description: 'Confetti, bouncing balls, a rope and letters that drop: four simulated nodes', api: 1 };
export const nodes = [confetti, bounce, rope, textDrop];
export const presets = [
  { name: 'phys-confetti', title: 'Confetti burst', category: 'Physics', description: '120 pieces falling with wind', layer: { type: 'phys.confetti', name: 'Confetti', props: { size: [1200, 800] } } },
  { name: 'phys-bounce', title: 'Bouncing balls', category: 'Physics', description: 'ten balls loose in a box', layer: { type: 'phys.bounce', name: 'Balls', props: { size: [900, 600] } } },
  { name: 'phys-rope', title: 'Rope', category: 'Physics', description: 'a sagging rope pinned at both ends', layer: { type: 'phys.rope', name: 'Rope', props: { size: [1000, 500] } } },
  { name: 'phys-text-drop', title: 'Text drop', category: 'Physics', description: 'a word that falls and settles', layer: { type: 'phys.text-drop', name: 'Text drop', props: { text: 'BOOM' } } },
];
export const messages = {
  fr: {
    'Confetti': 'Confettis', 'Bouncing balls': 'Balles rebondissantes', 'Rope': 'Corde', 'Text drop': 'Texte qui tombe',
    'Pieces': 'Mordeaux', 'Emit over': 'Émis en', 'Gravity': 'Gravité', 'Wind': 'Vent', 'Air': 'Air', 'Loop': 'Boucle',
    'Area': 'Zone', 'Colors': 'Couleurs', 'Balls': 'Balles', 'Smallest': 'Petit rayon', 'Biggest': 'Grand rayon',
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
