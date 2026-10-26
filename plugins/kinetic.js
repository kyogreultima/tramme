// Kinetic type: one text node where every character lands on its own beat —
// a typewriter, a wave that keeps breathing, letters gathering from a
// scatter, dropping in with a bounce, wiped on by a mask, scrambling through
// other characters before they settle, or flipping on a split-flap board. A
// pure function of t: each character's move comes from its index, the seed
// and the clock, never from the wall clock or a random.

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

// ── scramble and flap: characters that change before they settle ──
/** the characters a scramble passes through */
const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=?<>/';
/** a split-flap board's drum, in order: a flap reaches its letter through the ones before it */
export const FLAPS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:!?-&/';

/**
 * The character a scramble shows at t: the text's own once it settles
 * (`settle`), before that one of the scramble set, changing `rate` times a
 * second, the same for the same seed and index. Spaces stay spaces; before
 * `start` the character is not shown (null).
 */
export function scrambleAt(target, i, t, start, settle, seed = 1, rate = 18) {
  if (t < start) return null;
  if (t >= settle || /\s/.test(target)) return target;
  const step = Math.floor(t * rate);
  return SCRAMBLE[Math.floor(hash2(seed * 7919 + i * 131 + step * 31) * SCRAMBLE.length)];
}

/**
 * A split-flap at t: the flap it shows (`from`), the one falling into place
 * (`to`) and how far the fall is (`phase`, 0 at rest). It starts on the blank
 * at `start` and flips `rate` times a second through the drum to its
 * character; a character off the drum goes round once, then shows itself.
 */
export function flapAt(target, t, start, rate = 15) {
  const up = String(target).toUpperCase();
  const index = FLAPS.indexOf(up);
  const flips = index >= 0 ? index : FLAPS.length;
  const at = (k) => (k >= flips ? target : FLAPS[k % FLAPS.length]);
  if (t <= start) return { from: ' ', to: ' ', phase: 0 };
  const f = (t - start) * rate;
  if (f >= flips) return { from: target, to: target, phase: 0 };
  const k = Math.floor(f);
  return { from: at(k), to: at(k + 1), phase: f - k };
}

/** a flap's cell, as wide as the type's widest figures, with a hair of gap */
const flapCell = (size) => ({ w: size * 0.76, h: size * 1.18, gap: size * 0.08 });

/**
 * One split-flap cell drawn at (x, y) (its top left): the plate, the
 * resting halves, and the falling flap — the top half of the old character
 * folding down onto the split, then the bottom half of the new one unfolding
 * from it. Both halves of every flap are drawn.
 */
function drawFlap(ctx, s, x, y, cell, size, ink, plate) {
  const { w, h } = cell, mid = y + h / 2, r = Math.min(size * 0.08, w * 0.12);
  const half = (ch, top, scale = 1) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, top ? y : mid, w, h / 2);
    ctx.clip();
    if (scale !== 1) { ctx.translate(0, mid); ctx.scale(1, Math.max(0.001, scale)); ctx.translate(0, -mid); }
    ctx.fillStyle = plate;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
    // the far flap is a shade darker than the near one: the light comes from the front
    if (scale !== 1) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x, top ? y : mid, w, h / 2); }
    ctx.fillStyle = ink;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, x + w / 2, mid + size * 0.04);
    ctx.restore();
  };
  if (!s.phase) { half(s.from, true); half(s.from, false); }
  else {
    // behind: the new top already there, the old bottom still there
    half(s.to, true);
    half(s.from, false);
    if (s.phase < 0.5) half(s.from, true, 1 - s.phase * 2);
    else half(s.to, false, (s.phase - 0.5) * 2);
  }
  // the split between the halves
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, mid - Math.max(1, size * 0.012), w, Math.max(1.5, size * 0.024));
}

const MODES = ['typewriter', 'wave', 'scatter', 'drop', 'mask', 'scramble', 'flap'];

const node = {
  type: 'text.kinetic', title: 'Kinetic text', category: 'Text',
  ai: { when: 'titles that move letter by letter (an opening line, a punchline): typewriter for anything said aloud, wave for a word that stays on screen, scatter or drop for an entrance that has energy, mask for a clean wipe; scramble (a decoding, a reveal) or flap (a departures board, a counter) for a word, a name or a figure — never for body text, which moves as a block or word by word; one short line per layer', avoid: 'long paragraphs (they turn to soup), scramble or flap on a sentence (nobody reads it settling), more than 12 words on screen at once, a mode per word in the same composition' },
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
    seed: { type: 'integer', default: 1, min: 0, label: 'Seed', animatable: false, description: 'scramble: another seed, other characters on the way' },
    plate: { type: 'paint', default: '#15181D', label: 'Flaps', description: 'flap: the colour of the flaps' },
  },
  bounds(p) {
    const lines = String(p.text ?? '').split('\n');
    const chars = Math.max(...lines.map((l) => [...l].length), 1);
    if (p.mode === 'flap') {
      const c = flapCell(p.size), w = chars * (c.w + c.gap) - c.gap, h = lines.length * (c.h + c.gap) - c.gap;
      return { x: -w / 2, y: -h / 2, w, h };
    }
    const w = chars * p.size * 0.62;
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
      if (p.mode === 'flap') {
        // a board of cells, one per character, each flipping from its start
        const c = flapCell(p.size), widest = Math.max(...lines.map((l) => [...l].length), 1);
        const W = widest * (c.w + c.gap) - c.gap, H = lines.length * (c.h + c.gap) - c.gap;
        let gi = 0;
        lines.forEach((line, row) => {
          const chars = [...line], used = chars.length * (c.w + c.gap) - c.gap;
          const x0 = -W / 2 + (p.align === 'left' ? 0 : p.align === 'right' ? W - used : (W - used) / 2);
          chars.forEach((ch, k) => {
            drawFlap(ctx, flapAt(ch, t, gi * p.stagger), x0 + k * (c.w + c.gap), -H / 2 + row * (c.h + c.gap), c, p.size, p.color, p.plate);
            gi++;
          });
        });
        return;
      }
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
          if (p.mode === 'scramble') {
            // every character scrambles from the start, settling left to right on its own beat
            const shown = scrambleAt(ch, gi, t, 0, gi * p.stagger + p.duration, p.seed ?? 1);
            if (shown !== null) ctx.fillText(shown, x + (w - ctx.measureText(shown).width) / 2, y);
            x += w + tracking;
            gi++;
            continue;
          }
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

export const meta = { id: 'tramme/kinetic', name: 'kinetic', version: '1.1.0', description: 'Text that moves letter by letter: typewriter, wave, scatter, drop, mask, scramble, a split-flap board', api: 1 };
export const nodes = [node];
export const presets = [
  { name: 'kinetic-scatter', title: 'Kinetic text · scatter', category: 'Text', description: 'a line gathering from a scatter', layer: { type: 'text.kinetic', name: 'Kinetic text', props: { text: 'Make it move', mode: 'scatter' } } },
  { name: 'kinetic-typewriter', title: 'Kinetic text · typewriter', category: 'Text', description: 'a line typed on', layer: { type: 'text.kinetic', name: 'Kinetic text', props: { text: 'Written as you watch.', mode: 'typewriter', align: 'left' } } },
  { name: 'kinetic-scramble', title: 'Kinetic text · scramble', category: 'Text', description: 'a word decoding itself, left to right', layer: { type: 'text.kinetic', name: 'Kinetic text', props: { text: 'DECODED', mode: 'scramble', stagger: 0.07, duration: 0.5 } } },
  { name: 'kinetic-flap', title: 'Kinetic text · split-flap', category: 'Text', description: 'a departures board flipping to its word', layer: { type: 'text.kinetic', name: 'Kinetic text', props: { text: 'GATE 12', mode: 'flap', stagger: 0.06 } } },
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
    'Seed': 'Graine', 'Flaps': 'Palettes',
    'scramble: another seed, other characters on the way': 'scramble : une autre graine, d’autres caractères en chemin',
    'flap: the colour of the flaps': 'flap : la couleur des palettes',
    'Kinetic text · scramble': 'Texte cinétique · brouillage', 'Kinetic text · split-flap': 'Texte cinétique · tableau à palettes',
    'a word decoding itself, left to right': 'un mot qui se décode, de gauche à droite',
    'a departures board flipping to its word': 'un tableau des départs qui bascule jusqu’à son mot',
  },
};
