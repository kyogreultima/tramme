// Interface pieces: the rows, cards, rings, bars, badges, toasts, toggles,
// buttons and tables an app screen is made of, drawn by the engine in a light
// or a dark palette and sized from the width they are given (an 8 pt grid
// scaled), so a screen is a few pieces with parameters, not a hundred
// rectangles. Text goes through the engine's text path and the document's font
// assets, so it stays editable. The `screen` tool reads the size of the screen
// that device-screen (the walkthrough pack) made, stacks the pieces from its
// top and gives each its entrance.

/** the two palettes: true palettes of their own, not one inverted; the accent is the only colour a piece takes from outside */
export const PALETTE = {
  light: { bg: '#F4F5F8', surface: '#FFFFFF', text: '#14171C', sub: '#6A727F', line: '#E3E6EC', edge: '#C3C8D2', track: '#E7EAF0', onAccent: '#FFFFFF', success: '#16965A', warning: '#B86E00', shadow: 'rgba(20,23,28,0.14)' },
  dark: { bg: '#0D1014', surface: '#181C23', text: '#F2F4F8', sub: '#9AA3B2', line: '#262C36', edge: '#454D5C', track: '#262C36', onAccent: '#FFFFFF', success: '#3FD58C', warning: '#F2B253', shadow: 'rgba(0,0,0,0.5)' },
};

// ── what every piece shares ──────────────────────────────────

const COMMON = {
  theme: { type: 'enum', default: 'light', options: ['light', 'dark'], label: 'Theme', animatable: false },
  accent: { type: 'color', default: '#2E6BFF', label: 'Accent' },
  font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  width: { type: 'number', default: 340, min: 40, unit: 'px', label: 'Width', animatable: false, description: 'the piece\'s width: its type, spacing and radii follow it' },
  scale: { type: 'number', default: 1, min: 0.5, max: 2, step: 0.05, unit: 'x', label: 'Scale', animatable: false, description: 'type and spacing, relative to the width' },
};

/** the unit of the 8 pt grid: a 340 px wide piece draws in points */
const unit = (p) => (p.width / 340) * (p.scale || 1);
const palette = (p) => PALETTE[p.theme] ?? PALETTE.light;

const familyOf = (p, host) => {
  if (!p.font) return '';
  try { return `"${host.asset(p.font)}", `; } catch { return ''; }
};
const setFont = (ctx, p, host, size, weight) => { ctx.font = `${weight} ${Math.round(size * 10) / 10}px ${familyOf(p, host)}system-ui, sans-serif`; };

/** the text cut with an ellipsis to fit max px */
function fit(ctx, s, max) {
  if (!(max > 0) || ctx.measureText(s).width <= max) return s;
  let n = s.length;
  while (n > 1 && ctx.measureText(`${s.slice(0, n)}…`).width > max) n--;
  return `${s.slice(0, n).trimEnd()}…`;
}

/** a line of text, vertically centred on y */
function say(ctx, p, host, str, x, y, { size, weight = 500, color, align = 'left', max }) {
  setFont(ctx, p, host, size, weight);
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(fit(ctx, String(str ?? ''), max), x, y);
}

function widthOf(ctx, p, host, str, size, weight = 500) {
  setFont(ctx, p, host, size, weight);
  return ctx.measureText(String(str ?? '')).width;
}

const rrect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); };

/** the surface a piece sits on: a card with a hairline */
function card(ctx, c, w, h, r, u) {
  rrect(ctx, 0, 0, w, h, r);
  ctx.fillStyle = c.surface; ctx.fill();
  ctx.strokeStyle = c.line; ctx.lineWidth = Math.max(1, u); ctx.stroke();
}

/** a tick of the given size centred on (cx, cy) */
function tick(ctx, cx, cy, r, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.45, cy + r * 0.02); ctx.lineTo(cx - r * 0.1, cy + r * 0.38); ctx.lineTo(cx + r * 0.5, cy - r * 0.32);
  ctx.stroke();
}

/** a number as money in a language: whole amounts without cents */
export function money(value, currency = 'USD', locale = 'en') {
  const whole = Number.isInteger(value);
  try {
    return new Intl.NumberFormat(locale || 'en', { style: 'currency', currency: currency || 'USD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(whole ? 0 : 2)} ${currency ?? ''}`.trim();
  }
}

/** the margin on each side of the pieces: 6 % of the screen's width */
export const insetOf = (screenW) => Math.round(screenW * 0.06);

// ── the pieces ───────────────────────────────────────────────

/** a piece: the common props, a box hung from its top edge (so a stack of them does not overlap), a drawing in the piece's own 0..w × 0..h space */
function piece(type, title, ai, props, height, draw) {
  const h = (p) => height(p, unit(p));
  return {
    type, title, category: 'UI', ai,
    props: { ...props, ...COMMON },
    bounds: (p) => ({ x: -p.width / 2, y: 0, w: p.width, h: h(p) }),
    path(p) { const s = new Path2D(); s.rect(-p.width / 2, 0, p.width, h(p)); return s; },
    render: {
      canvas2d(ctx, p, host) {
        if (!(p.width > 0)) return;
        const u = unit(p);
        ctx.save();
        ctx.translate(-p.width / 2, 0);
        draw(ctx, p, host, { u, w: p.width, h: h(p), c: palette(p) });
        ctx.restore();
      },
    },
  };
}

const text = (def, label, description) => ({ type: 'string', default: def, label, animatable: false, ...(description ? { description } : {}) });

const row = piece('ui.row', 'Row',
  { when: 'a to-do row with a checkbox, a setting, a list entry with a figure on its right', avoid: 'drawing rows by hand with rectangles and texts; more than six rows on one screen' },
  {
    text: text('Plan the launch', 'Text'),
    sub: text('', 'Second line', 'a smaller line under the text; empty: none'),
    done: { type: 'bool', default: false, label: 'Done', animatable: false, description: 'ticked, and its text dimmed' },
    trailing: text('', 'Trailing', 'a figure or a word at the right end'),
    check: { type: 'enum', default: 'box', options: ['none', 'box', 'circle'], label: 'Check', animatable: false },
  },
  (p, u) => (p.sub ? 64 : 52) * u,
  (ctx, p, host, { u, w, h, c }) => {
    card(ctx, c, w, h, 14 * u, u);
    const pad = 16 * u, r = 11 * u;
    let x = pad;
    if (p.check !== 'none') {
      const cx = x + r, cy = h / 2;
      if (p.check === 'circle') { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); } else rrect(ctx, cx - r, cy - r, r * 2, r * 2, 6 * u);
      if (p.done) { ctx.fillStyle = p.accent; ctx.fill(); tick(ctx, cx, cy, r, c.onAccent, 2.4 * u); }
      else { ctx.strokeStyle = c.edge; ctx.lineWidth = 2 * u; ctx.stroke(); }
      x += r * 2 + 12 * u;
    }
    const tail = p.trailing ? widthOf(ctx, p, host, p.trailing, 15 * u, 600) + 16 * u : 0;
    if (p.trailing) say(ctx, p, host, p.trailing, w - pad, h / 2, { size: 15 * u, weight: 600, color: c.sub, align: 'right', max: w * 0.4 });
    const max = w - x - pad - tail;
    const color = p.done ? c.sub : c.text;
    if (p.sub) {
      say(ctx, p, host, p.text, x, h / 2 - 10 * u, { size: 16 * u, weight: 600, color, max });
      say(ctx, p, host, p.sub, x, h / 2 + 12 * u, { size: 13 * u, color: c.sub, max });
    } else say(ctx, p, host, p.text, x, h / 2, { size: 16 * u, weight: 600, color, max });
  });

const planH = (p, u) => (20 + 22 + 58 + (p.features?.length ? 14 + p.features.length * 28 : 0) + 20) * u;
const plan = piece('ui.plan', 'Plan card',
  { when: 'a price or plan card: a name, a price and period, what it includes, an optional badge ("Popular") and one plan highlighted among several', avoid: 'more than three plans side by side; more than six features per plan' },
  {
    title: text('Pro', 'Title'),
    price: text('€12', 'Price'),
    period: text('/ month', 'Period'),
    features: { type: 'json', default: ['Unlimited projects', 'Priority export', 'Shared libraries'], label: 'Features', animatable: false, description: 'a list of short lines' },
    badge: text('', 'Badge', 'a pill at the top right; empty: none'),
    highlight: { type: 'bool', default: false, label: 'Highlight', animatable: false, description: 'the accent outlines the card and colours its name' },
  },
  planH,
  (ctx, p, host, { u, w, h, c }) => {
    card(ctx, c, w, h, 20 * u, u);
    if (p.highlight) { ctx.strokeStyle = p.accent; ctx.lineWidth = 2 * u; rrect(ctx, u, u, w - 2 * u, h - 2 * u, 19 * u); ctx.stroke(); }
    const pad = 20 * u;
    const badgeW = p.badge ? widthOf(ctx, p, host, p.badge, 12 * u, 700) + 20 * u : 0;
    say(ctx, p, host, p.title, pad, pad + 11 * u, { size: 17 * u, weight: 700, color: p.highlight ? p.accent : c.sub, max: w - pad * 2 - badgeW - 8 * u });
    if (p.badge) {
      rrect(ctx, w - pad - badgeW, pad - u, badgeW, 24 * u, 12 * u); ctx.fillStyle = p.accent; ctx.fill();
      say(ctx, p, host, p.badge, w - pad - badgeW / 2, pad + 11 * u, { size: 12 * u, weight: 700, color: c.onAccent, align: 'center' });
    }
    const py = pad + 22 * u + 29 * u, priceW = widthOf(ctx, p, host, p.price, 38 * u, 800);
    say(ctx, p, host, p.price, pad, py, { size: 38 * u, weight: 800, color: c.text, max: w - pad * 2 });
    if (p.period) say(ctx, p, host, p.period, pad + priceW + 6 * u, py + 8 * u, { size: 15 * u, color: c.sub, max: w - pad * 2 - priceW - 6 * u });
    const top = pad + 22 * u + 58 * u + 14 * u;
    (p.features ?? []).forEach((f, i) => {
      const cy = top + i * 28 * u + 14 * u;
      tick(ctx, pad + 8 * u, cy, 9 * u, p.accent, 2.2 * u);
      say(ctx, p, host, f, pad + 26 * u, cy, { size: 15 * u, color: c.text, max: w - pad * 2 - 26 * u });
    });
  });

const itemsOf = (p) => (Array.isArray(p.items) ? p.items : []).map((it) => ({ name: String(it?.name ?? ''), qty: Number(it?.qty) || 1, price: Number(it?.price) || 0 }));
/** the sum of the items, what is taken off it, and the total shown: the one given when there is one */
export function cartTotals(p) {
  const sum = itemsOf(p).reduce((n, it) => n + it.qty * it.price, 0);
  const off = Math.max(0, Number(p.discount) || 0);
  return { sum, off, total: p.total > 0 ? p.total : Math.max(0, sum - off) };
}
const cartH = (p, u) => (16 + itemsOf(p).length * 40 + 14 + (p.discount > 0 ? 32 : 0) + 48 + 8) * u;
const cart = piece('ui.cart', 'Cart',
  { when: 'a cart or an order summary: lines with a quantity and a price, a discount, a total that is the sum unless one is given', avoid: 'more than five lines; prices typed as text (the node formats them for the language)' },
  {
    items: { type: 'json', default: [{ name: 'Ceramic mug', qty: 2, price: 30 }, { name: 'Linen tote', qty: 1, price: 60 }], label: 'Items', animatable: false, description: '[{ name, qty, price }, …]' },
    currency: text('USD', 'Currency', 'the code: EUR, USD, GBP'),
    locale: text('en', 'Language', 'how the amounts are written: en, fr'),
    discount: { type: 'number', default: 0, min: 0, label: 'Discount', animatable: false, description: 'the amount taken off the sum' },
    total: { type: 'number', default: 0, min: 0, label: 'Total', description: '0: the sum less the discount; key it to count up' },
    totalLabel: text('Total', 'Total label'),
    discountLabel: text('Discount', 'Discount label'),
  },
  cartH,
  (ctx, p, host, { u, w, h, c }) => {
    card(ctx, c, w, h, 20 * u, u);
    const pad = 16 * u, money_ = (v) => money(v, p.currency, p.locale);
    const items = itemsOf(p), { off, total } = cartTotals(p);
    items.forEach((it, i) => {
      const cy = pad + i * 40 * u + 20 * u, line = money_(it.qty * it.price), lw = widthOf(ctx, p, host, line, 15 * u, 600);
      say(ctx, p, host, line, w - pad, cy, { size: 15 * u, weight: 600, color: c.text, align: 'right' });
      const qty = it.qty > 1 ? `  × ${it.qty}` : '', nameW = widthOf(ctx, p, host, it.name, 15 * u, 600);
      say(ctx, p, host, it.name, pad, cy, { size: 15 * u, weight: 600, color: c.text, max: w - pad * 2 - lw - 16 * u - (qty ? 36 * u : 0) });
      if (qty) say(ctx, p, host, qty, pad + Math.min(nameW, w - pad * 2 - lw - 52 * u), cy, { size: 14 * u, color: c.sub });
    });
    const line = pad + items.length * 40 * u + 7 * u;
    ctx.strokeStyle = c.line; ctx.lineWidth = Math.max(1, u);
    ctx.beginPath(); ctx.moveTo(pad, line); ctx.lineTo(w - pad, line); ctx.stroke();
    let y = line + 7 * u;
    if (off > 0) {
      say(ctx, p, host, p.discountLabel, pad, y + 16 * u, { size: 14 * u, color: c.sub });
      say(ctx, p, host, `-${money_(off)}`, w - pad, y + 16 * u, { size: 14 * u, weight: 600, color: c.success, align: 'right' });
      y += 32 * u;
    }
    say(ctx, p, host, p.totalLabel, pad, y + 24 * u, { size: 16 * u, weight: 700, color: c.text });
    say(ctx, p, host, money_(total), w - pad, y + 24 * u, { size: 22 * u, weight: 800, color: p.accent, align: 'right' });
  });

const ringD = (p) => p.width * 0.6;
const ring = piece('ui.ring', 'Ring',
  { when: 'a level, a score or a goal as a ring that fills: a value from 0 to 1, a figure in the middle, a caption under it', avoid: 'several rings at once with no figure in them; a ring that fills to a value nobody reads' },
  {
    value: { type: 'number', default: 0.72, min: 0, max: 1, step: 0.01, label: 'Value', description: '0 to 1: key it to fill the ring' },
    label: text('Daily goal', 'Label', 'the caption under the ring'),
    centre: text('', 'Centre', 'the figure in the middle; empty: the value in percent'),
  },
  (p, u) => ringD(p) + 8 * u + (p.label ? 34 * u : 0),
  (ctx, p, host, { u, w, c }) => {
    const d = ringD(p), cx = w / 2, cy = d / 2 + 4 * u, line = d * 0.11, r = d / 2 - line / 2;
    const v = Math.min(1, Math.max(0, Number(p.value) || 0));
    ctx.lineWidth = line; ctx.lineCap = 'round';
    ctx.strokeStyle = c.track; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (v > 0.001) { ctx.strokeStyle = p.accent; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v); ctx.stroke(); }
    say(ctx, p, host, p.centre || `${Math.round(v * 100)}%`, cx, cy, { size: d * 0.24, weight: 800, color: c.text, align: 'center', max: d * 0.7 });
    if (p.label) say(ctx, p, host, p.label, cx, d + 8 * u + 14 * u, { size: 15 * u, weight: 500, color: c.sub, align: 'center', max: w });
  });

const bar = piece('ui.bar', 'Bar',
  { when: 'a progress or an XP bar: a label, a figure at the right, a track that fills', avoid: 'a bar without a label; a fill that does not start from zero' },
  {
    value: { type: 'number', default: 0.6, min: 0, max: 1, step: 0.01, label: 'Value', description: '0 to 1: key it to fill the bar' },
    label: text('Level 4', 'Label'),
    trailing: text('240 / 400 XP', 'Trailing', 'a figure at the right end'),
  },
  (p, u) => 44 * u,
  (ctx, p, host, { u, w, c }) => {
    const tail = p.trailing ? widthOf(ctx, p, host, p.trailing, 14 * u, 600) + 12 * u : 0;
    say(ctx, p, host, p.label, 0, 10 * u, { size: 15 * u, weight: 700, color: c.text, max: w - tail });
    if (p.trailing) say(ctx, p, host, p.trailing, w, 10 * u, { size: 14 * u, weight: 600, color: c.sub, align: 'right', max: w * 0.5 });
    const y = 26 * u, h = 10 * u, v = Math.min(1, Math.max(0, Number(p.value) || 0));
    rrect(ctx, 0, y, w, h, h / 2); ctx.fillStyle = c.track; ctx.fill();
    if (v > 0.001) { rrect(ctx, 0, y, Math.max(h, w * v), h, h / 2); ctx.fillStyle = p.accent; ctx.fill(); }
  });

const TONES = { accent: (p) => p.accent, neutral: (_p, c) => c.sub, success: (_p, c) => c.success, warning: (_p, c) => c.warning };
const badge = piece('ui.badge', 'Badge',
  { when: 'a small status or count: new, paid, 3 left, beta', avoid: 'a badge on every row; a long sentence in a badge' },
  {
    text: text('New', 'Text'),
    tone: { type: 'enum', default: 'accent', options: ['accent', 'neutral', 'success', 'warning'], label: 'Tone', animatable: false },
  },
  (p, u) => 28 * u,
  (ctx, p, host, { u, w, h, c }) => {
    const color = (TONES[p.tone] ?? TONES.accent)(p, c), bw = Math.min(w, widthOf(ctx, p, host, p.text, 13 * u, 700) + 22 * u);
    ctx.save(); ctx.globalAlpha = 0.14 * (ctx.globalAlpha ?? 1); rrect(ctx, 0, 0, bw, h, h / 2); ctx.fillStyle = color; ctx.fill(); ctx.restore();
    say(ctx, p, host, p.text, bw / 2, h / 2, { size: 13 * u, weight: 700, color, align: 'center', max: bw });
  });

/** a handful of Lucide glyphs (ISC) on the 24 grid, in the Icons pack's contour format: a pack cannot read another pack's data, so the toast carries the few it needs */
const GLYPHS = {
  'circle-check': [{v:[[22,12],[12,22],[2,12],[12,2]],closed:true,i:[[0,-5.52],[5.52,0],[0,5.52],[-5.52,0]],o:[[0,5.52],[-5.52,0],[0,-5.52],[5.52,0]]},{v:[[16,9],[10.5,14.5],[8,12]],closed:false}],
  'circle-x': [{v:[[22,12],[12,22],[2,12],[12,2]],closed:true,i:[[0,-5.52],[5.52,0],[0,5.52],[-5.52,0]],o:[[0,5.52],[-5.52,0],[0,-5.52],[5.52,0]]},{v:[[15,9],[9,15]],closed:false},{v:[[9,9],[15,15]],closed:false}],
  'info': [{v:[[22,12],[12,22],[2,12],[12,2]],closed:true,i:[[0,-5.52],[5.52,0],[0,5.52],[-5.52,0]],o:[[0,5.52],[-5.52,0],[0,-5.52],[5.52,0]]},{v:[[12,16],[12,12]],closed:false},{v:[[12,8],[12.01,8]],closed:false}],
  'triangle-alert': [{v:[[21.73,18],[13.73,4],[11.99,2.99],[10.25,4],[2.25,18],[2.25,20.01],[4,21],[20,21],[21.73,20],[21.73,18]],closed:false,i:[[0,0],[0,0],[0.72,0],[0.36,-0.63],[0,0],[-0.36,-0.62],[-0.72,0.01],[0,0],[-0.36,0.62],[0.36,0.62]],o:[[0,0],[-0.35,-0.63],[-0.72,0],[0,0],[-0.36,0.62],[0.36,0.62],[0,0],[0.71,0],[0.36,-0.62],[0,0]]},{v:[[12,9],[12,13]],closed:false},{v:[[12,17],[12.01,17]],closed:false}],
  'bell': [{v:[[10.27,21],[12,22],[13.73,21]],closed:false,i:[[0,0],[-0.71,0],[-0.36,0.62]],o:[[0.36,0.62],[0.71,0],[0,0]]},{v:[[3.26,15.33],[3.09,16.4],[4,17],[20,17],[20.92,16.41],[20.74,15.33],[18,8],[12,2],[6,8],[3.26,15.33]],closed:false,i:[[0,0],[-0.16,-0.36],[-0.4,0],[0,0],[-0.16,0.36],[0.27,0.29],[0,4.5],[3.31,0],[0,-3.31],[1.33,-1.37]],o:[[-0.27,0.29],[0.16,0.36],[0,0],[0.4,0],[0.16,-0.36],[-1.33,-1.37],[0,-3.31],[-3.31,0],[0,4.5],[0,0]]}],
  'mail': [{v:[[22,7],[13.01,12.73],[11,12.73],[2,7]],closed:false,i:[[0,0],[0,0],[0.62,0.36],[0,0]],o:[[0,0],[-0.62,0.36],[0,0],[0,0]]},{v:[[4,4],[20,4],[22,6],[22,18],[20,20],[4,20],[2,18],[2,6]],closed:true,i:[[-1.1,0],[0,0],[0,-1.1],[0,0],[1.1,0],[0,0],[0,1.1],[0,0]],o:[[0,0],[1.1,0],[0,0],[0,1.1],[0,0],[-1.1,0],[0,0],[0,-1.1]]}],
  'star': [{v:[[11.53,2.3],[12,2],[12.48,2.3],[14.79,6.97],[16.38,8.13],[21.55,8.89],[21.97,9.25],[21.84,9.79],[18.1,13.43],[17.49,15.31],[18.38,20.45],[18.17,20.97],[17.6,21.01],[12.99,18.58],[11.01,18.58],[6.4,21.01],[5.84,20.97],[5.63,20.45],[6.51,15.31],[5.9,13.43],[2.16,9.8],[2.02,9.25],[2.45,8.89],[7.62,8.13],[9.22,6.97]],closed:true,i:[[0,0],[-0.2,0],[-0.09,-0.18],[0,0],[-0.69,-0.1],[0,0],[-0.06,-0.19],[0.14,-0.14],[0,0],[-0.12,-0.69],[0,0],[0.16,-0.12],[0.18,0.1],[0,0],[0.62,-0.32],[0,0],[0.16,0.12],[-0.04,0.2],[0,0],[0.5,0.49],[0,0],[-0.06,0.19],[-0.2,0.03],[0,0],[-0.31,0.63]],o:[[0.09,-0.18],[0.2,0],[0,0],[0.31,0.63],[0,0],[0.2,0.03],[0.06,0.19],[0,0],[-0.5,0.49],[0,0],[0.04,0.2],[-0.16,0.12],[0,0],[-0.62,-0.32],[0,0],[-0.18,0.1],[-0.16,-0.12],[0,0],[0.12,-0.69],[0,0],[-0.15,-0.14],[0.06,-0.19],[0,0],[0.69,-0.1],[0,0]]}],
  'heart': [{v:[[2,9.5],[5.53,4.36],[11.59,5.82],[12,6],[12.41,5.82],[18.48,4.35],[22,9.5],[19,15],[13.51,20.31],[12.01,21],[10.51,20.33],[5,15],[2,9.5]],closed:false,i:[[0,0],[-2.13,0.82],[-1.52,-1.69],[-0.15,0],[-0.11,0.11],[-2.13,-0.82],[0.01,-2.28],[1.5,-1.5],[0,0],[0.57,0],[0.38,0.43],[0,0],[0,2.3]],o:[[0,-2.28],[2.13,-0.81],[0.11,0.11],[0.16,0],[1.52,-1.71],[2.13,0.82],[0,2.29],[0,0],[-0.38,0.43],[-0.57,0],[0,0],[-1.5,-1.5],[0,0]]}],
  'lock': [{v:[[5,11],[19,11],[21,13],[21,20],[19,22],[5,22],[3,20],[3,13]],closed:true,i:[[-1.1,0],[0,0],[0,-1.1],[0,0],[1.1,0],[0,0],[0,1.1],[0,0]],o:[[0,0],[1.1,0],[0,0],[0,1.1],[0,0],[-1.1,0],[0,0],[0,-1.1]]},{v:[[7,11],[7,7],[12,2],[17,7],[17,11]],closed:false,i:[[0,0],[0,0],[-2.76,0],[0,-2.76],[0,0]],o:[[0,0],[0,-2.76],[2.76,0],[0,0],[0,0]]}],
  'zap': [{v:[[15.91,4],[15.3,2.23],[13.44,2.44],[4.44,11.44],[4.11,13.07],[5.5,14],[9.5,14],[9.91,14.21],[9.97,14.67],[8.09,20],[8.7,21.77],[10.56,21.56],[19.56,12.56],[19.89,10.93],[18.5,10],[14.5,10],[14.09,9.79],[14.03,9.33]],closed:true,i:[[0,0],[0.59,0.37],[0.5,-0.49],[0,0],[-0.23,-0.56],[-0.61,0],[0,0],[-0.09,-0.13],[0.05,-0.15],[0,0],[-0.59,-0.37],[-0.49,0.5],[0,0],[0.23,0.56],[0.61,0],[0,0],[0.09,0.13],[-0.05,0.15]],o:[[0.23,-0.66],[-0.59,-0.37],[0,0],[-0.43,0.43],[0.23,0.56],[0,0],[0.16,0],[0.09,0.13],[0,0],[-0.23,0.66],[0.59,0.37],[0,0],[0.43,-0.43],[-0.23,-0.56],[0,0],[-0.16,0],[-0.09,-0.13],[0,0]]}],
};

function traceContour(ctx, c) {
  const n = c.v.length;
  ctx.moveTo(c.v[0][0], c.v[0][1]);
  const to = (k, j) => {
    const a = c.v[k], b = c.v[j], oa = c.o?.[k] ?? [0, 0], ib = c.i?.[j] ?? [0, 0];
    if (!oa[0] && !oa[1] && !ib[0] && !ib[1]) ctx.lineTo(b[0], b[1]);
    else ctx.bezierCurveTo(a[0] + oa[0], a[1] + oa[1], b[0] + ib[0], b[1] + ib[1], b[0], b[1]);
  };
  for (let k = 1; k < n; k++) to(k - 1, k);
  if (c.closed) { to(n - 1, 0); ctx.closePath(); }
}

const toast = piece('ui.toast', 'Toast',
  { when: 'a notification that slides in over a screen: an icon, a title, one line of text', avoid: 'a toast that stays more than three seconds; two toasts at once' },
  {
    icon: { type: 'enum', default: 'circle-check', options: [...Object.keys(GLYPHS), 'dot'], label: 'Icon', animatable: false, description: 'a Lucide icon among a few; the Icons pack draws any other as a layer beside the toast' },
    title: text('Payment received', 'Title'),
    text: text('Your order is on its way.', 'Text', 'one line under the title; empty: none'),
  },
  (p, u) => (p.text ? 72 : 56) * u,
  (ctx, p, host, { u, w, h, c }) => {
    ctx.save(); ctx.shadowColor = c.shadow; ctx.shadowBlur = 18 * u; ctx.shadowOffsetY = 6 * u;
    rrect(ctx, 0, 0, w, h, 18 * u); ctx.fillStyle = c.surface; ctx.fill(); ctx.restore();
    ctx.strokeStyle = c.line; ctx.lineWidth = Math.max(1, u); rrect(ctx, 0, 0, w, h, 18 * u); ctx.stroke();
    const pad = 14 * u, d = 36 * u, cx = pad + d / 2, cy = h / 2;
    ctx.save(); ctx.globalAlpha = 0.14 * (ctx.globalAlpha ?? 1); ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.fillStyle = p.accent; ctx.fill(); ctx.restore();
    const glyph = GLYPHS[p.icon];
    if (glyph) {
      ctx.save(); ctx.translate(cx, cy); ctx.scale((d * 0.5) / 24, (d * 0.5) / 24); ctx.translate(-12, -12);
      ctx.strokeStyle = p.accent; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); for (const contour of glyph) traceContour(ctx, contour); ctx.stroke();
      ctx.restore();
    } else { ctx.beginPath(); ctx.arc(cx, cy, d * 0.14, 0, Math.PI * 2); ctx.fillStyle = p.accent; ctx.fill(); }
    const x = pad + d + 12 * u, max = w - x - pad;
    if (p.text) {
      say(ctx, p, host, p.title, x, cy - 12 * u, { size: 16 * u, weight: 700, color: c.text, max });
      say(ctx, p, host, p.text, x, cy + 12 * u, { size: 14 * u, color: c.sub, max });
    } else say(ctx, p, host, p.title, x, cy, { size: 16 * u, weight: 700, color: c.text, max });
  });

const toggle = piece('ui.toggle', 'Toggle',
  { when: 'a setting with a switch: a label and a switch that slides from off to on', avoid: 'a switch without a label' },
  {
    on: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, label: 'On', description: '0: off, 1: on; key it from 0 to 1 for the switch to slide' },
    label: text('Notifications', 'Label'),
  },
  (p, u) => 56 * u,
  (ctx, p, host, { u, w, h, c }) => {
    card(ctx, c, w, h, 14 * u, u);
    const pad = 16 * u, tw = 52 * u, th = 30 * u, x = w - pad - tw, y = (h - th) / 2, k = Math.min(1, Math.max(0, Number(p.on) || 0));
    say(ctx, p, host, p.label, pad, h / 2, { size: 16 * u, weight: 600, color: c.text, max: x - pad * 2 });
    rrect(ctx, x, y, tw, th, th / 2); ctx.fillStyle = c.track; ctx.fill();
    if (k > 0.001) { ctx.save(); ctx.globalAlpha = k * (ctx.globalAlpha ?? 1); rrect(ctx, x, y, tw, th, th / 2); ctx.fillStyle = p.accent; ctx.fill(); ctx.restore(); }
    const kr = (th - 6 * u) / 2;
    ctx.save(); ctx.shadowColor = c.shadow; ctx.shadowBlur = 4 * u; ctx.shadowOffsetY = u;
    ctx.beginPath(); ctx.arc(x + 3 * u + kr + k * (tw - 6 * u - kr * 2), h / 2, kr, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.restore();
  });

const button = piece('ui.button', 'Button',
  { when: 'a call to action or a form button in one of its states: idle, hover, pressed, disabled, loading', avoid: 'two primary buttons on one screen' },
  {
    label: text('Continue', 'Label'),
    state: { type: 'enum', default: 'idle', options: ['idle', 'hover', 'pressed', 'disabled', 'loading'], label: 'State', animatable: false },
    kind: { type: 'enum', default: 'primary', options: ['primary', 'secondary', 'ghost'], label: 'Kind', animatable: false },
  },
  (p, u) => 52 * u,
  (ctx, p, host, { u, w, h, c }) => {
    ctx.save();
    if (p.state === 'pressed') { ctx.translate(w / 2, h / 2); ctx.scale(0.97, 0.97); ctx.translate(-w / 2, -h / 2); }
    if (p.state === 'disabled') ctx.globalAlpha *= 0.4;
    const primary = p.kind === 'primary', ghost = p.kind === 'ghost', ink = primary ? c.onAccent : ghost ? p.accent : c.text;
    rrect(ctx, 0, 0, w, h, 14 * u);
    if (primary) { ctx.fillStyle = p.accent; ctx.fill(); }
    else if (!ghost) { ctx.fillStyle = c.surface; ctx.fill(); ctx.strokeStyle = c.edge; ctx.lineWidth = Math.max(1, u); ctx.stroke(); }
    if (p.state === 'hover' || p.state === 'pressed') {
      ctx.save(); ctx.globalAlpha *= p.state === 'pressed' ? 0.16 : 0.08; rrect(ctx, 0, 0, w, h, 14 * u); ctx.fillStyle = primary ? '#000000' : p.accent; ctx.fill(); ctx.restore();
    }
    if (p.state === 'loading') {
      const a = (host.t ?? 0) * Math.PI * 2 * 1.2;
      ctx.strokeStyle = ink; ctx.lineWidth = 2.5 * u; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 9 * u, a, a + Math.PI * 1.4); ctx.stroke();
    } else say(ctx, p, host, p.label, w / 2, h / 2, { size: 16 * u, weight: 700, color: ink, align: 'center', max: w - 24 * u });
    ctx.restore();
  });

const tableH = (p, u) => (8 + (p.header?.length ? 30 : 0) + (p.rows?.length ?? 0) * 56 + 8) * u;
/** the picture of an image asset of the document, null for anything else: the host throws for an id it does not hold, and an avatar is as often initials */
function imageOf(host, id) {
  if (!id) return null;
  try { return host.assetInfo(id)?.type === 'image' ? host.asset(id) : null; } catch { return null; }
}
const initialsOf = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const table = piece('ui.table', 'Table',
  { when: 'a list of people or items with an avatar, a name and a figure: a team, a leaderboard, transactions', avoid: 'more than five rows on a phone; more than three columns' },
  {
    header: { type: 'json', default: ['Member', 'Points'], label: 'Header', animatable: false, description: 'the column titles: the first at the left, the last at the right, one between them centred' },
    rows: { type: 'json', default: [{ avatar: 'AL', name: 'Alice Lemaire', value: '1 240', sub: 'Design' }, { avatar: 'MB', name: 'Marc Bellon', value: '980', sub: 'Product' }, { avatar: 'SK', name: 'Sana Khoury', value: '860', sub: 'Growth' }], label: 'Rows', animatable: false, description: '[{ avatar (initials or an image asset), name, value, sub? }, …]' },
  },
  tableH,
  (ctx, p, host, { u, w, h, c }) => {
    card(ctx, c, w, h, 20 * u, u);
    const pad = 16 * u, head = p.header ?? [];
    let y = 8 * u;
    if (head.length) {
      const cy = y + 15 * u, opts = { size: 12 * u, weight: 600, color: c.sub };
      say(ctx, p, host, head[0], pad, cy, opts);
      if (head.length > 2) say(ctx, p, host, head[1], w / 2, cy, { ...opts, align: 'center' });
      if (head.length > 1) say(ctx, p, host, head.at(-1), w - pad, cy, { ...opts, align: 'right' });
      y += 30 * u;
    }
    (p.rows ?? []).forEach((r, i) => {
      const cy = y + i * 56 * u + 28 * u, d = 34 * u, ax = pad + d / 2;
      if (i > 0 || head.length) { ctx.strokeStyle = c.line; ctx.lineWidth = Math.max(1, u); ctx.beginPath(); ctx.moveTo(pad, cy - 28 * u); ctx.lineTo(w - pad, cy - 28 * u); ctx.stroke(); }
      const img = imageOf(host, r.avatar);
      if (img) {
        ctx.save(); ctx.beginPath(); ctx.arc(ax, cy, d / 2, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(img, ax - d / 2, cy - d / 2, d, d); ctx.restore();
      } else {
        ctx.save(); ctx.globalAlpha *= 0.14; ctx.beginPath(); ctx.arc(ax, cy, d / 2, 0, Math.PI * 2); ctx.fillStyle = p.accent; ctx.fill(); ctx.restore();
        say(ctx, p, host, r.avatar && String(r.avatar).length <= 3 ? String(r.avatar) : initialsOf(r.name), ax, cy, { size: 13 * u, weight: 700, color: p.accent, align: 'center' });
      }
      const x = pad + d + 12 * u, vw = widthOf(ctx, p, host, r.value, 15 * u, 700);
      say(ctx, p, host, r.value, w - pad, cy, { size: 15 * u, weight: 700, color: c.text, align: 'right' });
      const max = w - x - pad - vw - 12 * u;
      if (r.sub) {
        say(ctx, p, host, r.name, x, cy - 9 * u, { size: 15 * u, weight: 600, color: c.text, max });
        say(ctx, p, host, r.sub, x, cy + 11 * u, { size: 13 * u, color: c.sub, max });
      } else say(ctx, p, host, r.name, x, cy, { size: 15 * u, weight: 600, color: c.text, max });
    });
  });

export const meta = { id: 'tramme/interface', name: 'interface', version: '1.0.0', description: 'Interface pieces (rows, plan cards, a cart, rings, bars, badges, toasts, toggles, buttons, tables) in a light or a dark palette, and a tool that fills a device screen with them', api: 1 };
export const nodes = [row, plan, cart, ring, bar, badge, toast, toggle, button, table];

// ── laying a screen ──────────────────────────────────────────

const BY_TYPE = Object.fromEntries(nodes.map((n) => [n.type, n]));
const defaultsOf = (node) => Object.fromEntries(Object.entries(node.props).map(([k, d]) => [k, d.default]));

/** the height of a piece at a width: its own bounds, so the layout and the drawing agree */
export function pieceHeight(name, props = {}, width = 340) {
  const node = BY_TYPE[`ui.${name}`];
  if (!node) throw new Error(`"${name}" is not a piece`);
  return node.bounds({ ...defaultsOf(node), ...props, width }).h;
}

/**
 * The pieces stacked from y = 0, `gap` apart: each one's top and height. The
 * height is the piece's own at that width, unless `heightOf(piece, index)`
 * says otherwise.
 * @param {{ piece: string, props?: object }[]} pieces
 * @param {number} width
 * @param {number} gap
 * @param {(it: { piece: string, props?: object }, index: number) => number} [heightOf]
 * @returns {{ y: number, h: number }[]}
 */
export function layoutPieces(pieces, width, gap, heightOf = (it) => pieceHeight(it.piece, it.props, width)) {
  let y = 0;
  return pieces.map((it, i) => {
    const h = heightOf(it, i);
    const placed = { y, h };
    y += h + gap;
    return placed;
  });
}

const PIECES = ['row', 'plan', 'cart', 'ring', 'bar', 'badge', 'toast', 'toggle', 'button', 'table'];
/** the pause before each piece enters, uneven so the stack does not tick like a metronome (40 to 60 ms) */
const STAGGER = [0.05, 0.04, 0.06];
const ENTER = 0.45;
const r3 = (n) => +n.toFixed(3);

/** the content group device-screen made: found by its id or its name, or from its device's group */
function contentGroup(comp, into) {
  const isContent = (l) => l?.type === 'group' && l.clip && comp.layers[l.clip]?.type === 'shape.rect' && / · screen$/.test(comp.layers[l.clip].name ?? '');
  const named = Object.entries(comp.layers).filter(([id, l]) => id === into || l.name === into || l.name === `${into} · content`);
  if (!named.length) throw new Error(`"${into}": no such layer in the composition (name the content group device-screen made, "<device> · content")`);
  for (const [id, l] of named) {
    if (isContent(l)) return { id, group: l };
    const inside = (l.children ?? []).find((k) => isContent(comp.layers[k]));
    if (inside) return { id: inside, group: comp.layers[inside] };
  }
  throw new Error(`"${into}" is not a content group: name the group device-screen made, "<device> · content", whose screen clips what is built in it`);
}

const screenTool = {
  name: 'screen', title: 'Fill a screen with pieces',
  description: 'rows, plan cards, a cart, rings, bars, badges, toasts, toggles, buttons and tables stacked from the top of the screen device-screen made, each sized from that screen and entering in turn',
  input: {
    type: 'object',
    properties: {
      into: { type: 'string', title: 'Into', description: 'the content group device-screen made ("Phone · content"), by its id or its name' },
      theme: { enum: ['light', 'dark'], title: 'Theme', description: 'light by default; the screen takes the theme\'s colour' },
      title: { type: 'string', title: 'Title', description: 'a line above the pieces' },
      pieces: {
        type: 'array', title: 'Pieces', description: 'from the top down: { piece: row, plan, cart, ring, bar, badge, toast, toggle, button or table, props?, at? }, the props being the content: names, figures, states',
        items: { type: 'object', properties: { piece: { enum: PIECES }, props: { type: 'object' }, at: { type: 'number', minimum: 0 } }, required: ['piece'] },
      },
      gap: { type: 'number', minimum: 0, title: 'Gap (px)', description: 'between pieces: half a margin by default' },
      font: { type: 'string', format: 'asset', assetType: 'font', title: 'Font', description: 'the film\'s typeface, for every piece' },
    },
    required: ['into', 'pieces'],
  },
  ai: {
    when: 'an interface built in layers in a phone or a browser, after device-screen: a screen is one call, its parameters are the content (names, prices, states from the brief)',
    avoid: 'drawing interface pieces by hand with rectangles and texts; more pieces than the screen holds (the tool leaves them out and says so)',
  },
  async run({ into, theme = 'light', title, pieces, gap, font }, ctx) {
    const cid = ctx.compId, comp = ctx.doc.compositions[cid];
    if (!comp) throw new Error(`unknown composition: ${cid}`);
    if (!Array.isArray(pieces) || !pieces.length) throw new Error('pieces: at least one piece is expected');
    for (const it of pieces) if (!PIECES.includes(it?.piece)) throw new Error(`"${it?.piece}" is not a piece (${PIECES.join(', ')})`);
    const { id, group } = contentGroup(comp, into);
    // the screen's size is read from the document: the clip device-screen made is the screen, reaching up under a browser's bar
    const clip = comp.layers[group.clip], [sw, sh] = clip.props.size;
    const at = (l) => (Array.isArray(l.transform?.position) ? l.transform.position : [0, 0]);
    const H = 2 * (at(clip)[1] + sh / 2 - at(group)[1]), W = sw;
    const [, parent] = Object.entries(comp.layers).find(([, l]) => l.children?.includes(id)) ?? [];
    const under = (parent?.children ?? []).map((k) => ({ k, l: comp.layers[k] })).find(({ l }) => l?.type === 'ui.device' && l.props?.part === 'under');
    const phone = under?.l.props?.device === 'phone';
    const inset = insetOf(W), top = inset + (phone ? Math.round(W * 0.05) : 0), room = H - top - inset;
    const width = Math.round(W) - 2 * inset, between = gap ?? Math.round(inset / 2);
    const accent = ctx.doc.tokens?.accent?.type === 'color';
    const merged = pieces.map((it) => ({ ...it, props: { theme, width, ...(accent ? { accent: '@accent' } : {}), ...(font ? { font } : {}), ...(it.props ?? {}) } }));
    const heading = title ? Math.round(width * 0.075) : 0, headingH = heading ? Math.round(heading * 1.25) + between : 0;
    const placed = layoutPieces(merged, width, between);
    const bottom = (k) => headingH + placed[k].y + placed[k].h;
    let kept = placed.findIndex((_, k) => bottom(k) > room);
    if (kept < 0) kept = placed.length;
    const need = Math.ceil(bottom(placed.length - 1) - room);

    const token = (n) => ctx.doc.tokens?.[n]?.type === 'ease';
    const ease = token('out') ? '@out' : [0.16, 1, 0.3, 1];
    const base = parent?.in ?? 0, lift = Math.round(width * 0.06);
    const taken = new Set(Object.keys(comp.layers));
    const fresh = (stem) => { let k = stem, n = 2; while (taken.has(k)) k = `${stem}-${n++}`; taken.add(k); return k; };
    const ops = [], ids = [];
    let clock = base;
    const enter = (index, y, requested) => {
      const t0 = r3(requested ?? clock);
      clock = t0 + STAGGER[index % STAGGER.length];
      return {
        in: t0,
        transform: {
          position: { $k: [{ t: t0, v: [0, y + lift], ease }, { t: r3(t0 + ENTER), v: [0, y] }] },
          opacity: { $k: [{ t: t0, v: 0, ease: 'linear' }, { t: r3(t0 + 0.3), v: 1 }] },
        },
      };
    };
    const top0 = -H / 2 + top;
    if (title) {
      const lid = fresh('screen-title');
      const e = enter(0, top0, undefined);
      e.transform.position = { $k: [{ t: e.in, v: [-width / 2, top0 + lift], ease }, { t: r3(e.in + ENTER), v: [-width / 2, top0] }] };
      ops.push({ op: 'add', path: `/compositions/${cid}/layers/${lid}`, value: { type: 'text', name: 'Screen title', ...e, props: { text: String(title), size: heading, weight: 800, align: 'left', baseline: 'top', color: PALETTE[theme]?.text ?? PALETTE.light.text, ...(font ? { font } : {}) } } });
      ids.push(lid);
    }
    for (let k = 0; k < kept; k++) {
      const it = merged[k], lid = fresh(`ui-${it.piece}`), y = top0 + headingH + placed[k].y;
      ops.push({ op: 'add', path: `/compositions/${cid}/layers/${lid}`, value: { type: `ui.${it.piece}`, name: it.piece[0].toUpperCase() + it.piece.slice(1), ...enter(k + (title ? 1 : 0), y, it.at), props: it.props } });
      ids.push(lid);
    }
    for (const lid of ids) ops.push({ op: 'add', path: `/compositions/${cid}/layers/${id}/children/-`, value: lid });
    if (under) ops.push({ op: 'add', path: `/compositions/${cid}/layers/${under.k}/props/fill`, value: (PALETTE[theme] ?? PALETTE.light).bg });

    const left = merged.length - kept;
    const noun = kept === 1 ? 'piece' : 'pieces';
    return {
      ops, label: `Screen · ${kept} ${noun}`,
      text: `${kept} ${noun}${title ? ' and a title' : ''} in "${group.name ?? into}", ${theme}: the screen is ${Math.round(W)} x ${Math.round(H)} px, the pieces ${width} px wide with a ${inset} px margin, ${between} px apart, entering one after the other.` +
        (left ? ` ${left} of ${merged.length} pieces left out: they need ${need} px more than the ${Math.round(room)} px the screen holds; fewer pieces, a smaller scale or a taller device would fit them.` : '') +
        ' Edit their content in the inspector.',
    };
  },
};

export const tools = [screenTool];
export const messages = {
  fr: {
    'Row': 'Ligne', 'Plan card': 'Carte d\'offre', 'Cart': 'Panier', 'Ring': 'Anneau', 'Bar': 'Barre', 'Badge': 'Pastille', 'Toast': 'Notification', 'Toggle': 'Interrupteur', 'Button': 'Bouton', 'Table': 'Tableau',
    'Text': 'Texte', 'Second line': 'Deuxième ligne', 'Done': 'Fait', 'Trailing': 'À droite', 'Check': 'Case', 'Theme': 'Thème', 'Accent': 'Accent', 'Font': 'Police', 'Width': 'Largeur', 'Scale': 'Échelle',
    'Title': 'Titre', 'Price': 'Prix', 'Period': 'Période', 'Features': 'Contenu', 'Highlight': 'Mise en avant',
    'Items': 'Articles', 'Currency': 'Devise', 'Language': 'Langue', 'Discount': 'Remise', 'Total': 'Total', 'Total label': 'Libellé du total', 'Discount label': 'Libellé de la remise',
    'Value': 'Valeur', 'Label': 'Libellé', 'Centre': 'Centre', 'Tone': 'Ton', 'Icon': 'Icône', 'On': 'Activé', 'State': 'État', 'Kind': 'Type', 'Header': 'En-tête', 'Rows': 'Lignes',
    'Fill a screen with pieces': 'Remplir un écran de pièces', 'Into': 'Dans', 'Pieces': 'Pièces', 'Gap (px)': 'Espace (px)',
    'a smaller line under the text; empty: none': 'une ligne plus petite sous le texte ; vide : aucune',
    'ticked, and its text dimmed': 'cochée, et son texte atténué',
    'a figure or a word at the right end': 'un chiffre ou un mot au bout à droite',
    'the piece\'s width: its type, spacing and radii follow it': 'la largeur de la pièce : son texte, ses espaces et ses arrondis la suivent',
    'type and spacing, relative to the width': 'le texte et les espaces, relativement à la largeur',
    'a list of short lines': 'une liste de lignes courtes',
    'a pill at the top right; empty: none': 'une pastille en haut à droite ; vide : aucune',
    'the accent outlines the card and colours its name': 'l\'accent cerne la carte et colore son nom',
    '[{ name, qty, price }, …]': '[{ name, qty, price }, …]',
    'the code: EUR, USD, GBP': 'le code : EUR, USD, GBP',
    'how the amounts are written: en, fr': 'la façon d\'écrire les montants : en, fr',
    'the amount taken off the sum': 'le montant retiré de la somme',
    '0: the sum less the discount; key it to count up': '0 : la somme moins la remise ; keyframez-le pour compter',
    '0 to 1: key it to fill the ring': 'de 0 à 1 : keyframez-le pour remplir l\'anneau',
    'the caption under the ring': 'la légende sous l\'anneau',
    'the figure in the middle; empty: the value in percent': 'le chiffre au milieu ; vide : la valeur en pourcents',
    '0 to 1: key it to fill the bar': 'de 0 à 1 : keyframez-le pour remplir la barre',
    'a figure at the right end': 'un chiffre au bout à droite',
    'a Lucide icon among a few; the Icons pack draws any other as a layer beside the toast': 'une icône Lucide parmi quelques-unes ; le pack Icônes dessine toute autre icône en calque à côté de la notification',
    'one line under the title; empty: none': 'une ligne sous le titre ; vide : aucune',
    '0: off, 1: on; key it from 0 to 1 for the switch to slide': '0 : éteint, 1 : allumé ; keyframez-le de 0 à 1 pour faire glisser l\'interrupteur',
    'the column titles: the first at the left, the last at the right, one between them centred': 'les titres des colonnes : le premier à gauche, le dernier à droite, un entre les deux au centre',
    '[{ avatar (initials or an image asset), name, value, sub? }, …]': '[{ avatar (initiales ou une image), name, value, sub ? }, …]',
    'rows, plan cards, a cart, rings, bars, badges, toasts, toggles, buttons and tables stacked from the top of the screen device-screen made, each sized from that screen and entering in turn': 'des lignes, cartes d\'offre, un panier, anneaux, barres, pastilles, notifications, interrupteurs, boutons et tableaux empilés depuis le haut de l\'écran fait par device-screen, chacun dimensionné d\'après cet écran et entrant à son tour',
    'the content group device-screen made ("Phone · content"), by its id or its name': 'le groupe de contenu fait par device-screen (« Phone · content »), par son identifiant ou son nom',
    'light by default; the screen takes the theme\'s colour': 'clair par défaut ; l\'écran prend la couleur du thème',
    'a line above the pieces': 'une ligne au-dessus des pièces',
    'from the top down: { piece: row, plan, cart, ring, bar, badge, toast, toggle, button or table, props?, at? }, the props being the content: names, figures, states': 'de haut en bas : { piece : row, plan, cart, ring, bar, badge, toast, toggle, button ou table, props ?, at ? }, les props étant le contenu : noms, chiffres, états',
    'between pieces: half a margin by default': 'entre les pièces : une demi-marge par défaut',
    'the film\'s typeface, for every piece': 'la police du film, pour chaque pièce',
  },
};
