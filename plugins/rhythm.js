// Rhythm and coherence, checks only, like the accessibility pack: what a
// motion designer catches in a film that is right frame by frame and wrong as
// a whole. Cuts that land between two beats of the music, shots that plod at
// nearly the same length, a palette that drifts off the tokens, type sizes
// that near-duplicate. No nodes, no tools: the /review workflow adds the pack
// when the film has music, and the issues say what to do.

// ── the helpers ──────────────────────────────────────────────
/** cuts further than 2 frames from every beat */
export function offBeat(cuts, beats, fps) {
  const tol = 2 / (fps || 30);
  return (cuts ?? []).filter((c) => !(beats ?? []).some((b) => Math.abs(b - c) <= tol + 1e-9));
}

/** four shots or more of nearly the same length (their spread under 15 % of their mean): the film plods */
export function evenShots(lengths) {
  const xs = (lengths ?? []).filter((x) => Number.isFinite(x) && x > 0);
  if (xs.length < 4) return false;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean <= 0) return false;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return sd / mean < 0.15;
}

// ── colour: how far a fill sits from the tokens (CIE76 on Lab) ──
const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
};
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lab = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(lin);
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

/** the distance of two colours as the eye reads it (CIE76, on Lab) */
export function deltaE(a, b) {
  const A = lab(a), B = lab(b);
  if (!A || !B) return Infinity;
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

/**
 * What drifts off the palette: `far` lists the colours more than 10 of ΔE
 * from every token, `tooMany` says when more than five distinct colours
 * outside the tokens are on screen at once.
 */
export function paletteDrift(colours, tokens) {
  const outside = (colours ?? []).filter((c) => (tokens ?? []).every((t) => deltaE(c, t) > 10));
  const distinct = new Set(outside.map((c) => lab(c)?.map((x) => Math.round(x)).join(',')));
  distinct.delete(undefined);
  return { far: outside, tooMany: distinct.size > 5, count: distinct.size };
}

/** the type a frame carries: more than two faces, and pairs of sizes within 10 % of each other */
export function typeDrift(faces, sizesOnFrame) {
  const xs = [...new Set((sizesOnFrame ?? []).filter((x) => Number.isFinite(x) && x > 0))].sort((a, b) => a - b);
  const sizes = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length && xs[j] / xs[i] < 1.1; j++) sizes.push([xs[i], xs[j]]);
  }
  return { faces: (faces ?? []).length > 2, sizes };
}

// ── what the checks read ─────────────────────────────────────
/** the cuts of a composition: the in points of its video layers and nested compositions (the film's own start is not one), its scene markers */
function cutsOf(comp) {
  const cuts = [];
  for (const l of Object.values(comp.layers ?? {})) {
    if ((l.type === 'video' || l.type === 'comp') && Number.isFinite(l.in) && l.in > 1e-6) cuts.push(l.in);
  }
  for (const m of comp.markers ?? []) {
    if (Number.isFinite(m?.t) && (!m.kind || m.kind === 'scene')) cuts.push(m.t);
  }
  return cuts;
}

/** the beats of the film's music, from the analyses the check tool has loaded */
function beatsOf(ctx) {
  const beats = [], downbeats = [];
  for (const id of Object.keys(ctx.doc.assets ?? {})) {
    if (!id.startsWith('analysis-')) continue;
    try {
      const a = ctx.data?.(id);
      if (a && Array.isArray(a.beats)) { beats.push(...a.beats); if (Array.isArray(a.downbeats)) downbeats.push(...a.downbeats); }
    } catch { /* not loaded: not judged */ }
  }
  return { beats, downbeats };
}

// ── the checks ───────────────────────────────────────────────
const checks = [
  {
    name: 'off-beat', title: 'Off the beat',
    description: 'a cut landing more than 2 frames from every beat of the music (the film needs a beats analysis): the issue names the beat to move it to',
    run(ctx) {
      const out = [];
      const { beats, downbeats } = beatsOf(ctx);
      if (!beats.length) return out;
      const fps = ctx.comp.fps || 30;
      for (const c of offBeat(cutsOf(ctx.comp), beats, fps)) {
        const after = beats.filter((b) => b > c).sort((x, y) => x - y)[0];
        const before = beats.filter((b) => b < c).sort((x, y) => y - x)[0];
        const to = Math.abs(c - (before ?? c)) <= Math.abs((after ?? c) - c) ? before : after;
        const at = to?.toFixed(2) ?? '';
        const bar = downbeats.includes(to) ? ' — the bar line, where the ear expects a change' : '';
        out.push({ check: 'off-beat', severity: 'warning', t: c, message: `a cut at ${c.toFixed(2)} s lands between two beats — move it to ${at} s, where the music lands${bar}` });
      }
      return out;
    },
  },
  {
    name: 'even-shots', title: 'Even shots',
    description: 'four shots or more of nearly the same length (their spread under 15 % of their mean): the film plods',
    run(ctx) {
      const shots = Object.values(ctx.comp.layers ?? {}).filter((l) => l.type === 'video' || l.type === 'comp');
      const lengths = shots.map((l) => (l.out ?? ctx.comp.duration) - (l.in ?? 0));
      if (!evenShots(lengths)) return [];
      const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      return [{
        check: 'even-shots', severity: 'warning',
        message: `${lengths.length} shots of nearly the same length (about ${mean.toFixed(1)} s each): the film plods — vary them, a short one among the long carries the eye`,
      }];
    },
  },
  {
    name: 'palette-drift', title: 'Palette drift',
    description: 'colours written outside the tokens and far from all of them (ΔE over 10), or more than five colours on screen at once',
    run(ctx) {
      const out = [];
      const tokens = Object.values(ctx.doc.tokens ?? {}).filter((t) => t?.type === 'color').map((t) => String(t.value));
      for (const sample of ctx.samples) {
        const onScreen = new Set();
        for (const placed of sample.layers) {
          if (placed.opacity < 0.5) continue;
          for (const k of ['fill', 'stroke', 'color']) {
            const v = placed.props[k];
            if (typeof v === 'string' && hexToRgb(v)) onScreen.add(v.toLowerCase());
          }
        }
        const colours = [...onScreen];
        const { far, tooMany, count } = paletteDrift(colours, tokens);
        if (far.length) out.push({ check: 'palette-drift', severity: 'warning', t: sample.t, message: `${far.slice(0, 3).join(', ')}${far.length > 3 ? ` and ${far.length - 3} more` : ''} sit far from every token of the palette — write them as tokens (@ink, @accent) or bring them to the palette` });
        if (tooMany) out.push({ check: 'palette-drift', severity: 'warning', t: sample.t, message: `${count} colours on screen at once, none of them a token — more than five reads as noise; fold them into the palette` });
      }
      return out;
    },
  },
  {
    name: 'type-drift', title: 'Type drift',
    description: 'more than two typefaces in one film, or near-duplicate sizes on one frame (two sizes within 10 % of each other)',
    run(ctx) {
      const out = [];
      const faces = new Set();
      for (const l of Object.values(ctx.comp.layers ?? {})) {
        if (l.type === 'text' && typeof l.props?.font === 'string') faces.add(l.props.font);
      }
      if (faces.size > 2) out.push({ check: 'type-drift', severity: 'warning', message: `${faces.size} typefaces in one film — more than two reads as unfinished; keep the film\'s face and its mono` });
      for (const sample of ctx.samples) {
        const sizes = [...new Set(sample.layers
          .filter((p) => p.text !== undefined && (p.textSize ?? Number(p.props.size)) > 0 && p.opacity >= 0.5)
          .map((p) => Math.round(p.textSize ?? Number(p.props.size))))];
        const { sizes: pairs } = typeDrift([], sizes);
        if (pairs.length) out.push({ check: 'type-drift', severity: 'warning', t: sample.t, message: `two sizes within 10 % of each other on one frame (${pairs[0].join(' and ')} px) — one of them is a mistake; keep a scale the film reads` });
      }
      return out;
    },
  },
];

export const meta = { id: 'tramme/rhythm', name: 'rhythm', version: '1.0.0', description: 'Rhythm and coherence checks: cuts off the beat, even shots, a palette drifting off the tokens, near-duplicate type sizes', api: 1 };
export { checks };
export const messages = {
  fr: {
    'Off the beat': 'Hors du temps', 'Even shots': 'Plans jumeaux', 'Palette drift': 'Palette qui dérive', 'Type drift': 'Typographie qui dérive',
    'a cut landing more than 2 frames from every beat of the music (the film needs a beats analysis): the issue names the beat to move it to': 'une coupe qui tombe à plus de 2 images de chaque temps de la musique (le film demande une analyse de beats) : le problème nomme le temps où la déplacer',
    'four shots or more of nearly the same length (their spread under 15 % of their mean): the film plods': 'quatre plans ou plus de presque même longueur (leur écart sous 15 % de leur moyenne) : le film traîne',
    'colours written outside the tokens and far from all of them (ΔE over 10), or more than five colours on screen at once': 'des couleurs écrites hors des tokens et loin de chacun (ΔE au-dessus de 10), ou plus de cinq couleurs à l’écran à la fois',
    'more than two typefaces in one film, or near-duplicate sizes on one frame (two sizes within 10 % of each other)': 'plus de deux typographies dans un film, ou des corps quasi identiques sur une image (deux corps à moins de 10 % l’un de l’autre)',
  },
};
