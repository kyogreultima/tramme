// Kinetic type: one text node where every character lands on its own beat —
// a typewriter, a wave that keeps breathing, letters gathering from a
// scatter, dropping in with a bounce, or wiped on by a mask. A pure function
// of t: each character's move comes from its index and the clock, never from
// the wall clock or a random.

/** the state of character i at progress q (0..1) and time t: alpha, offset, rotation */
export function charState(mode, q, i, t) {
  const e = 1 - Math.pow(1 - q, 3); // ease out cubic
  switch (mode) {
    case 'typewriter':
      return { a: q >= 1 ? 1 : Math.min(1, q * 6), dx: 0, dy: 0, rot: 0 };
    case 'wave': {
      // landed by q, then it keeps breathing
      const dy = q >= 1 ? Math.sin(t * 4.4 + i * 0.55) : 0;
      return { a: Math.min(1, q * 2), dx: 0, dy: dy * 0.055, rot: 0, rel: true };
    }
    case 'scatter': {
      const h1 = Math.abs(hash2(i * 7 + 1) - 0.5) * 2, h2 = Math.abs(hash2(i * 13 + 5) - 0.5) * 2;
      const k = 1 - e;
      return { a: Math.min(1, q * 2.5), dx: h1 * 0.9 * k, dy: h2 * 0.6 * k, rot: (hash2(i * 29 + 3) - 0.5) * 100 * k };
    }
    case 'drop': {
      // a bounce that settles: |sin| decaying to 0 as q goes to 1
      const b = bounce(q);
      return { a: Math.min(1, q * 4), dx: 0, dy: -(1 - b) * 1.25, rot: 0 };
    }
    case 'mask':
      return { a: q >= 1 ? 1 : q > 0 ? 1 : 0, dx: 0, dy: 0, rot: 0, clip: q };
    default:
      return { a: 1, dx: 0, dy: 0, rot: 0 };
  }
}

/** deterministic 0..1 from an integer (characters must scatter the same way on every machine) */
function hash2(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** 0..1 with three decaying bounces (a ball settling) */
export function bounce(q) {
  const n = 7.5625, d = 2.75;
  if (q < 1 / d) return n * q * q;
  if (q < 2 / d) return n * (q -= 1.5 / d) * q + 0.75;
  if (q < 2.5 / d) return n * (q -= 2.25 / d) * q + 0.9375;
  return n * (q -= 2.625 / d) * q + 0.984375;
}

/** where a line of given char widths starts in a w-wide line, by align */
export function lineStart(widths, tracking, align, w) {
  const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, widths.length - 1);
  if (align === 'left') return 0;
  if (align === 'right') return w - total;
  return (w - total) / 2;
}

const MODES = ['typewriter', 'wave', 'scatter', 'drop', 'mask'];

const node = {
  type: 'text.kinetic', title: 'Kinetic text', category: 'Text',
  ai: { when: 'titles that move letter by letter (an opening line, a punchline): typewriter for anything said aloud, wave for a word that stays on screen, scatter or drop for an entrance that has energy, mask for a clean wipe; one short line per layer', avoid: 'long paragraphs (they turn to soup), more than 12 words on screen at once, a mode per word in the same composition' },
  props: {
    text: { type: 'text', default: 'Make it move', label: 'Text', animatable: false, description: 'several lines with line breaks' },
    mode: { type: 'enum', default: 'scatter', options: MODES, label: 'Moves', animatable: false },
    size: { type: 'number', default: 120, min: 4, unit: 'px', label: 'Size' },
    weight: { type: 'number', default: 800, min: 100, max: 900, step: 100, label: 'Weight', animatable: false },
    color: { type: 'paint', default: '#FFFFFF', label: 'Color' },
    align: { type: 'enum', default: 'center', options: ['center', 'left', 'right'], label: 'Align', animatable: false },
    tracking: { type: 'number', default: -0.01, step: 0.005, unit: 'em', label: 'Tracking', animatable: false },
    lineHeight: { type: 'number', default: 1.15, min: 0.8, step: 0.05, unit: 'x', label: 'Line height', animatable: false },
    stagger: { type: 'number', default: 0.045, min: 0, step: 0.005, unit: 's', label: 'Per letter', animatable: false, description: 'the delay between two characters' },
    duration: { type: 'number', default: 0.4, min: 0.05, step: 0.05, unit: 's', label: 'Per-letter move', animatable: false },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds(p) {
    const lines = String(p.text ?? '').split('\n');
    const w = Math.max(...lines.map((l) => l.length), 1) * p.size * 0.62;
    return { x: -w / 2, y: (-lines.length * p.size * p.lineHeight) / 2, w, h: lines.length * p.size * p.lineHeight };
  },
  render: {
    canvas2d(ctx, p, host) {
      const text = String(p.text ?? '');
      if (!text) return;
      const lines = text.split('\n');
      let family = '';
      if (p.font) { try { family = `"${host.asset(p.font)}", `; } catch { family = ''; } }
      ctx.font = `${p.weight} ${p.size}px ${family}system-ui, sans-serif`;
      ctx.fillStyle = p.color;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      const lh = p.size * p.lineHeight, tracking = p.tracking * p.size;
      const t = host.t - (host.layerIn ?? 0);
      // each line: its characters' widths, then its start in the widest line's box
      const measure = (l) => { const ws = [...l].map((ch) => ctx.measureText(ch).width); return { ws, w: ws.reduce((a, b) => a + b, 0) + tracking * Math.max(0, ws.length - 1) }; };
      const widest = Math.max(...lines.map(measure).map((m) => m.w), 1);
      let y = (-lines.length * lh) / 2 + p.size * 0.82;
      let gi = 0;
      for (const line of lines) {
        const { ws } = measure(line);
        let x = lineStart(ws, tracking, p.align, widest) - widest / 2;
        for (const ch of [...line]) {
          const w = ctx.measureText(ch).width;
          const q = Math.min(1, Math.max(0, (t - gi * p.stagger) / Math.max(0.001, p.duration)));
          const s = charState(p.mode, q, gi, t);
          if (s.a > 0) {
            ctx.save();
            ctx.globalAlpha *= Math.max(0, Math.min(1, s.a));
            ctx.translate(x + w / 2 + s.dx * p.size, y + s.dy * p.size);
            if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);
            ctx.fillText(ch, -w / 2, 0);
            ctx.restore();
          }
          x += w + tracking;
          gi++;
        }
        y += lh;
      }
    },
  },
};

export const meta = { id: 'tramme/kinetic', name: 'kinetic', version: '1.0.0', description: 'Text that moves letter by letter: typewriter, wave, scatter, drop, mask', api: 1 };
export const nodes = [node];
export const presets = [
  { name: 'kinetic-scatter', title: 'Kinetic text · scatter', category: 'Text', description: 'a line gathering from a scatter', layer: { type: 'text.kinetic', name: 'Kinetic text', props: { text: 'Make it move', mode: 'scatter' } } },
  { name: 'kinetic-typewriter', title: 'Kinetic text · typewriter', category: 'Text', description: 'a line typed on', layer: { type: 'text.kinetic', name: 'Kinetic text', props: { text: 'Written as you watch.', mode: 'typewriter', align: 'left' } } },
];
export const messages = {
  fr: {
    'Kinetic text': 'Texte cinétique', 'Text': 'Texte', 'Moves': 'Mouvement', 'Size': 'Corps', 'Weight': 'Graisse',
    'Color': 'Couleur', 'Align': 'Alignement', 'Tracking': 'Interlettrage', 'Line height': 'Interligne',
    'Per letter': 'Par lettre', 'Per-letter move': 'Mouvement par lettre', 'Font': 'Police',
    'a line gathering from a scatter': 'une ligne qui se rassemble d\'un nuage de lettres',
    'a line typed on': 'une ligne tapée sous vos yeux',
    'several lines with line breaks': 'plusieurs lignes avec des retours à la ligne',
    'the delay between two characters': 'le délai entre deux caractères',
    'Kinetic text · scatter': 'Texte cinétique · dispersion',
    'Kinetic text · typewriter': 'Texte cinétique · machine à écrire',
  },
};
