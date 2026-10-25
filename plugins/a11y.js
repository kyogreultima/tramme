// Accessibility checks: they read the document the way a tired viewer does —
// text too small for a phone, letters too close to the colour behind them, a
// picture that blinks faster than a body tolerates, a line on screen too
// briefly to be read. They run with the other checks (the check tool, the
// assistant before it sums up) and say what to change.

const TEXT_NODES = ['text', 'text.counter'];

/** #rgb, #rgba, #rrggbb, #rrggbbaa or rgb()/rgba() as [r, g, b], or null */
export function parseColor(color) {
  if (typeof color !== 'string') return null;
  const s = color.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)[),]/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** relative luminance of a colour, 0..1 (WCAG), null when the colour is not readable */
export function lum(color) {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const chan = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

/** contrast ratio of two colours, 1..21 (WCAG), null when either is unreadable */
export function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** how many times a second a series of opacities blinks on (an appearance followed by darkness) */
export function flashRate(opacities, step) {
  let on = 0;
  for (let i = 1; i < opacities.length; i++) {
    if (opacities[i - 1] <= 0.1 && opacities[i] >= 0.6) on++;
  }
  const seconds = (opacities.length - 1) * step;
  return seconds > 0 ? on / seconds : 0;
}

/** does the box hold the centre of the inner one */
const covers = (box, inner) => !!box && !!inner && box.x <= inner.x + inner.w / 2 && box.x + box.w >= inner.x + inner.w / 2 && box.y <= inner.y + inner.h / 2 && box.y + box.h >= inner.y + inner.h / 2;

const isText = (placed) => TEXT_NODES.includes(placed.node.type) || (typeof placed.props.text === 'string' && typeof placed.props.color === 'string' && typeof placed.props.size === 'number');
const u = (ctx) => Math.min(ctx.comp.width, ctx.comp.height);

const checks = [
  {
    name: 'a11y-text-size', title: 'Text size',
    description: 'under about 3 % of the frame\'s short side, text is unreadable on a phone',
    run(ctx) {
      const out = [], floor = u(ctx) * 0.03, seen = new Set();
      for (const sample of ctx.samples) {
        for (const placed of sample.layers) {
          if (!isText(placed) || seen.has(placed.id)) continue;
          seen.add(placed.id);
          const size = Number(placed.props.size);
          if (size > 0 && size < floor) out.push({ check: 'a11y-text-size', severity: 'warning', message: `${placed.layer.name ?? placed.id}: the text is ${Math.round((size / u(ctx)) * 1000) / 10} % of the frame — under 3 % it is unreadable on a phone; make it bigger or cut the words` });
        }
      }
      return out;
    },
  },
  {
    name: 'a11y-contrast', title: 'Text contrast',
    description: 'text too close in colour to what sits behind it (3:1 for large text, WCAG)',
    run(ctx) {
      const out = [], seen = new Set();
      for (const sample of ctx.samples) {
        for (let i = 0; i < sample.layers.length; i++) {
          const placed = sample.layers[i];
          if (!isText(placed) || seen.has(placed.id) || placed.opacity <= 0.5) continue;
          seen.add(placed.id);
          const c = typeof placed.props.color === 'string' ? placed.props.color : null;
          if (!c) continue;
          // the topmost opaque fill drawn before the text and covering it; the composition's background otherwise
          let behind = typeof ctx.comp.background === 'string' ? ctx.comp.background : null;
          for (let j = 0; j < i; j++) {
            const under = sample.layers[j];
            if (typeof under.props.fill === 'string' && parseColor(under.props.fill) && under.opacity > 0.5 && covers(under.box, placed.box)) behind = under.props.fill;
          }
          if (!behind) continue;
          const ratio = contrast(c, behind);
          if (ratio !== null && ratio < 3) out.push({ check: 'a11y-contrast', severity: 'warning', message: `${placed.layer.name ?? placed.id}: the text stands at ${Math.round(ratio * 10) / 10}:1 over its background — 3:1 is the floor for readable type; lighten or darken one of the two` });
        }
      }
      return out;
    },
  },
  {
    name: 'a11y-flash', title: 'Blinking',
    description: 'something appearing and disappearing more than 3 times a second (photosensitivity)',
    run(ctx) {
      const out = [], step = ctx.samples.length > 1 ? ctx.samples[1].t - ctx.samples[0].t : 0;
      if (step <= 0) return out;
      const series = new Map(), names = new Map();
      for (const sample of ctx.samples) for (const placed of sample.layers) {
        if (!series.has(placed.id)) series.set(placed.id, []);
        names.set(placed.id, placed.layer.name ?? placed.id);
        series.get(placed.id).push(placed.opacity);
      }
      for (const [id, opacities] of series) {
        const rate = flashRate(opacities, step);
        if (rate > 3) out.push({ check: 'a11y-flash', severity: 'warning', message: `${names.get(id)}: appears ${Math.round(rate)} times a second — over 3 flashes a second is hard to watch and can trigger photosensitivity; slow it or hold it` });
      }
      return out;
    },
  },
  {
    name: 'a11y-duration', title: 'Time to read',
    description: 'a line of text on screen for less than 0.6 s cannot be read',
    run(ctx) {
      const out = [], seen = new Set();
      for (const sample of ctx.samples) {
        for (const placed of sample.layers) {
          if (!isText(placed) || seen.has(placed.id)) continue;
          seen.add(placed.id);
          const l = placed.layer, span = (l.out ?? ctx.comp.duration) - (l.in ?? 0);
          if (span > 0 && span < 0.6) out.push({ check: 'a11y-duration', severity: 'info', message: `${placed.layer.name ?? placed.id}: on screen ${span.toFixed(2)} s — under 0.6 s nobody finishes reading it; hold it longer` });
        }
      }
      return out;
    },
  },
];

export const meta = { id: 'tramme/a11y', name: 'a11y', version: '1.0.0', description: 'Accessibility checks: text size, contrast, blinking, time to read', api: 1 };
export { checks };
export const messages = {
  fr: {
    'Text size': 'Corps du texte', 'Text contrast': 'Contraste du texte', 'Blinking': 'Clignotement', 'Time to read': 'Temps de lecture',
    'under about 3 % of the frame\'s short side, text is unreadable on a phone': 'sous environ 3 % du petit côté du cadre, le texte est illisible sur un téléphone',
    'text too close in colour to what sits behind it (3:1 for large text, WCAG)': 'un texte trop proche en couleur de ce qui est derrière lui (3:1 pour les grands textes, WCAG)',
    'something appearing and disappearing more than 3 times a second (photosensitivity)': 'quelque chose qui apparaît et disparaît plus de 3 fois par seconde (photosensibilité)',
    'a line of text on screen for less than 0.6 s cannot be read': 'une ligne de texte à l\'écran moins de 0,6 s ne peut pas être lue',
  },
};
