// Formulas: a TeX subset laid out by the pack, glyph by glyph, in STIX Two
// Math (OFL). The parser reads fractions, scripts, roots, sums and integrals
// with their limits, small matrices, the Greek letters and the common
// operators; the layout walks the tree and places each glyph from the font's
// own table (glyphs.json, extracted once from the font), so a formula is a
// pure function of its props; the change between two formulas moves the
// symbols they share, the way a proof unfolds on a board. No MathJax, no
// network: the glyphs ship beside the pack.

// ── the parser ───────────────────────────────────────────────
/** the Greek letters the parser knows */
const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
const OPS = { cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', gets: '←', in: '∈', sum: '∑', prod: '∏', int: '∫', partial: '∂', nabla: '∇', cdots: '…', ldots: '…', R: 'ℝ', N: 'ℕ', Z: 'ℤ' };
/** the sets written \mathbb{R}, as their double-struck letters */
const BB = { R: 'ℝ', N: 'ℕ', Z: 'ℤ' };
/** a variable is set in the font's math italic, when it has one (TeX's way: x, not an upright x) */
const italicOf = (ch) => {
  const c = ch.codePointAt(0);
  if (c >= 97 && c <= 122) return c === 104 ? 'ℎ' : String.fromCodePoint(0x1d44e + c - 97);
  if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d434 + c - 65);
  return ch;
};
const SYMS = { '%': '%', '&': '&', '#': '#', _: '_', '{': '{', '}': '}', $: '$' };

/**
 * A TeX subset into a tree. Read: `{a}` groups, `^` and `_` the scripts
 * (x^2, a_1, \sum_{i=1}^{n}), `\frac{a}{b}`, `\sqrt{a}`, the Greek letters,
 * the operators (`\cdot \times \le \ge \ne \infty \to`), and
 * `\begin{pmatrix}` with rows separated by `\\` and cells by `&`. An unknown
 * command throws, naming its position.
 */
export function parseTex(src) {
  const s = String(src ?? '');
  let i = 0;
  const fail = (why, at) => { throw new Error(`${why} at position ${at} of "${s}"`); };
  const word = () => { const m = /^[a-zA-Z]+/.exec(s.slice(i)); return m ? m[0] : ''; };

  // one thing, its scripts attached: a character, a command, a group, a matrix
  const atom = () => {
    while (s[i] === ' ') i++;
    if (i >= s.length || s[i] === '}' || s[i] === '&') return null;
    const at = i;
    let base;
    const ch = s[i];
    if (ch === '{') {
      i++;
      const items = list('}');
      if (s[i] !== '}') fail('a group without its closing brace', at);
      i++;
      base = items.length === 1 ? items[0] : { t: 'row', items };
    } else if (ch === '\\') {
      i++;
      const w = word();
      if (!w) {
        const one = s[i];
        if (one === undefined) fail('a command without its name', at);
        i++;
        if (SYMS[one]) base = { t: 'sym', ch: SYMS[one] };
        else fail(`unknown command "\\${one}"`, at);
      } else if (GREEK[w]) {
        i += w.length;
        base = { t: 'sym', ch: GREEK[w] };
      } else if (OPS[w] && w !== 'sum' && w !== 'prod' && w !== 'int') {
        i += w.length;
        base = { t: 'sym', ch: OPS[w] };
      } else if (w === 'sum' || w === 'prod' || w === 'int') {
        i += w.length;
        base = { t: 'big', ch: OPS[w] };
      } else if (w === 'frac' || w === 'dfrac' || w === 'tfrac') {
        i += w.length;
        base = { t: 'frac', a: need(at), b: need(at) };
      } else if (w === 'sqrt') {
        i += w.length;
        base = { t: 'sqrt', a: need(at) };
      } else if (w === 'text' || w === 'mathrm' || w === 'operatorname') {
        // upright words: the text as written, a space kept as a space
        i += w.length;
        while (s[i] === ' ') i++;
        if (s[i] !== '{') fail(`\\${w} without its braces`, at);
        const end = s.indexOf('}', i);
        if (end < 0) fail('a group without its closing brace', at);
        base = { t: 'row', items: [...s.slice(i + 1, end)].map((c) => ({ t: 'sym', ch: c, upright: true })) };
        i = end + 1;
      } else if (w === 'mathbb') {
        i += w.length;
        while (s[i] === ' ') i++;
        const m = /^\{([A-Z])\}/.exec(s.slice(i));
        if (!m || !BB[m[1]]) fail('\\mathbb knows R, N and Z', at);
        i += m[0].length;
        base = { t: 'sym', ch: BB[m[1]] };
      } else if (w === 'color' || w === 'textcolor') {
        // \color{accent}{a^2}: the group in a colour (a token name, a hex)
        i += w.length;
        while (s[i] === ' ') i++;
        const m = /^\{([#\w@-]+)\}/.exec(s.slice(i));
        if (!m) fail(`\\${w} without its colour`, at);
        i += m[0].length;
        const c = m[1].startsWith('#') || m[1].startsWith('@') ? m[1] : `@${m[1]}`;
        base = { t: 'color', c, a: need(at) };
      } else if (w === 'begin') {
        i += w.length;
        while (s[i] === ' ') i++;
        if (s.slice(i, i + 9) !== '{pmatrix}') fail(`the only matrix known is pmatrix (found "${s.slice(i, i + 12)}…")`, at);
        i += 9;
        const rows = [];
        let cells = [[]];
        for (;;) {
          while (s[i] === ' ') i++;
          if (s.startsWith('\\end', i)) {
            i += 4;
            while (s[i] === ' ') i++;
            if (s.slice(i, i + 9) !== '{pmatrix}') fail('a matrix without its \\end{pmatrix}', at);
            i += 9;
            break;
          }
          if (i >= s.length) fail('a matrix without its \\end{pmatrix}', at);
          if (s[i] === '&') { i++; cells.push([]); continue; }
          if (s.startsWith('\\\\', i)) { i += 2; rows.push(cells); cells = [[]]; continue; }
          const a = atom();
          if (!a) fail('a matrix cell that reads nothing', at);
          cells[cells.length - 1].push(a);
        }
        rows.push(cells);
        base = { t: 'matrix', rows };
      } else {
        fail(`unknown command "\\${w}"`, at);
      }
    } else if (ch === '^' || ch === '_') {
      fail(`a ${ch === '^' ? 'superscript' : 'subscript'} with nothing under it`, at);
    } else {
      const cp = s.codePointAt(i);
      const n = cp > 0xffff ? 2 : 1;
      i += n;
      const ch = s.slice(at, at + n);
      // a hyphen is the minus sign in a formula
      base = { t: 'sym', ch: ch === '-' ? '−' : ch };
    }
    return base;
  };
  const need = (at) => {
    const a = atom();
    if (!a) fail('an argument missing', at);
    return a;
  };
  const list = (until) => {
    const items = [];
    for (;;) {
      let node = atom();
      if (!node) return items;
      // the scripts attach to what they follow; a big operator's are its limits
      while (s[i] === '^' || s[i] === '_') {
        const kind = s[i] === '^' ? 'sup' : 'sub';
        i++;
        const arg = need(i - 1);
        if (node.t === 'big' || node.t === 'script') node[kind] = arg;
        else node = { t: 'script', base: node, [kind]: arg };
      }
      void until;
      items.push(node);
    }
  };
  const out = list('');
  return out.length === 1 ? out[0] : { t: 'row', items: out };
}

// ── the layout ───────────────────────────────────────────────
const FONTUP = 1000;

/**
 * The tree placed: one entry per glyph, its pen position in px (the baseline
 * at y 0), its scale, and an id stable per symbol (`a#1`, the first `a` of
 * the formula), so two layouts of near formulas match their symbols. Pure
 * and deterministic: the same tree and size give the same places.
 */
export function layout(node, size, glyphs) {
  const scale = size / (glyphs.upem || FONTUP);
  const G = glyphs.glyphs ?? {};
  const placed = [];
  const seen = {};
  let colour = null;
  // the glyph a symbol draws with: a variable in math italic when the font has it, \text upright
  const glyphOf = (n) => (n.upright ? n.ch : G[italicOf(n.ch)] ? italicOf(n.ch) : n.ch);
  const sym = (ch, x, y, sc, key = ch) => {
    const g = G[ch];
    if (!g) return 0.55 * size;
    // the id names the symbol as written (a, not its italic), so two formulas match their a's
    const id = `${key}#${(seen[key] = (seen[key] ?? 0) + 1)}`;
    placed.push({ glyph: ch, x: +x.toFixed(2), y: +y.toFixed(2), scale: +(sc * scale).toFixed(4), id, ...(colour ? { color: colour } : {}) });
    return g.adv * sc * scale;
  };
  const width = (n, k, sc) => {
    if (n.t === 'sym') { const g = G[glyphOf(n)]; return g ? g.adv * sc * scale : 0.55 * size; }
    if (n.t === 'color') return width(n.a, k, sc);
    if (n.t === 'row') return n.items.reduce((w, it) => w + width(it, k, sc), 0);
    if (n.t === 'script') return Math.max(width(n.base, k, sc) + (n.sup ? width(n.sup, k, 0.6 * sc) : 0), width(n.base, k, sc) + (n.sub ? width(n.sub, k, 0.6 * sc) : 0));
    if (n.t === 'frac') return Math.max(width(n.a, k, 0.85 * sc), width(n.b, k, 0.85 * sc)) + 0.24 * size;
    if (n.t === 'sqrt') return 0.55 * size + width(n.a, k, sc) + 0.12 * size;
    if (n.t === 'big') return 1.5 * size * 0.62;
    if (n.t === 'matrix') {
      const cols = Math.max(...n.rows.map((r) => Math.max(1, r.length)));
      const colW = [];
      for (let c = 0; c < cols; c++) colW.push(Math.max(0.2 * size, ...n.rows.map((r) => (r[c] ? width({ t: 'row', items: r[c] }, k, sc) : 0))));
      return colW.reduce((a, b) => a + b, 0) + (cols - 1) * 0.5 * size + 1.1 * size;
    }
    return 0;
  };
  const walk = (n, x, y, k, sc) => {
    if (n.t === 'sym') { sym(glyphOf(n), x, y, sc, n.ch); return width(n, k, sc); }
    if (n.t === 'color') { const before = colour; colour = n.c; const w = walk(n.a, x, y, k, sc); colour = before; return w; }
    if (n.t === 'row') { let w = 0; for (const it of n.items) w += walk(it, x + w, y, k, sc); return w; }
    if (n.t === 'script') {
      const wBase = walk(n.base, x, y, k, sc);
      let w = wBase;
      if (n.sup) w = Math.max(w, wBase + walk(n.sup, x + wBase, y - 0.42 * size, k, 0.6 * sc));
      if (n.sub) w = Math.max(w, wBase + walk(n.sub, x + wBase, y + 0.2 * size, k, 0.6 * sc));
      return w;
    }
    if (n.t === 'frac') {
      const wMax = Math.max(width(n.a, k, 0.85 * sc), width(n.b, k, 0.85 * sc));
      walk(n.a, x + 0.12 * size + (wMax - width(n.a, k, 0.85 * sc)) / 2, y - 0.58 * size, k, 0.85 * sc);
      walk(n.b, x + 0.12 * size + (wMax - width(n.b, k, 0.85 * sc)) / 2, y + 0.78 * size, k, 0.85 * sc);
      // the bar, drawn by the node as a rule: a placed marker the renderer reads
      placed.push({ glyph: '\u2500', x: +x.toFixed(2), y: +(y - 0.26 * size).toFixed(2), scale: +(scale).toFixed(4), id: `bar#${placed.filter((p) => p.glyph === '\u2500').length + 1}`, rule: wMax + 0.24 * size, ...(colour ? { color: colour } : {}) });
      return wMax + 0.24 * size;
    }
    if (n.t === 'sqrt') {
      const inner = width(n.a, k, sc);
      const h = 0.72 * size;
      // the radical, stretched over the content: the glyph drawn tall
      const g = G['\u221A'];
      if (g) {
        const id = `\u221A#${(seen['\u221A'] = (seen['\u221A'] ?? 0) + 1)}`;
        placed.push({ glyph: '\u221A', x: +x.toFixed(2), y: +y.toFixed(2), scale: +(sc * scale).toFixed(4), id, stretch: (h * 1.15) / (Math.abs(g.bounds[3] - g.bounds[1]) * scale || 1) });
      }
      const w = walk(n.a, x + 0.55 * size, y, k, sc);
      // the overbar, a rule over the content
      placed.push({ glyph: '\u2500', x: +(x + 0.42 * size).toFixed(2), y: +(y - 0.74 * size).toFixed(2), scale: +scale.toFixed(4), id: `bar#${placed.filter((p) => p.glyph === '\u2500').length + 1}`, rule: w + 0.14 * size });
      return 0.55 * size + w + 0.12 * size;
    }
    if (n.t === 'big') {
      const big = 1.5;
      const w = 0.62 * size * big;
      if (n.ch === '\u222B') {
        // the integral keeps its scripts at its side
        if (n.sup) walk(n.sup, x + w, y - 0.5 * size, k, 0.6 * sc);
        if (n.sub) walk(n.sub, x + w, y + 0.24 * size, k, 0.6 * sc);
        sym(n.ch, x, y, sc * big);
        return w + (n.sup || n.sub ? 0.7 * size : 0);
      }
      sym(n.ch, x + (w - symWidth(n.ch, sc * big)) / 2, y, sc * big);
      if (n.sup) walk(n.sup, x + w / 2 - width(n.sup, k, 0.6 * sc) / 2, y - 1.15 * size, k, 0.6 * sc);
      if (n.sub) walk(n.sub, x + w / 2 - width(n.sub, k, 0.6 * sc) / 2, y + 0.62 * size, k, 0.6 * sc);
      return w;
    }
    if (n.t === 'matrix') {
      // the columns measured, the rows spaced, parens stretched at the sides
      const cols = Math.max(...n.rows.map((r) => r.length));
      const colW = [], rowH = [];
      const cellW = n.rows.map((r) => r.map((c) => width({ t: 'row', items: c }, k, sc)));
      for (let c = 0; c < cols; c++) colW.push(Math.max(0.2 * size, ...cellW.map((r) => r[c] ?? 0)));
      const hRow = 1.35 * size;
      const totalW = colW.reduce((a, b) => a + b, 0) + (cols - 1) * 0.5 * size;
      const totalH = n.rows.length * hRow;
      n.rows.forEach((r, ri) => {
        let cx = x + (totalW - colW.reduce((a, b) => a + b, 0) - (cols - 1) * 0.5 * size) / 2;
        r.forEach((c, ci) => {
          const w = width({ t: 'row', items: c }, k, sc);
          walk({ t: 'row', items: c }, cx + (colW[ci] - w) / 2, y - totalH / 2 + hRow * (ri + 0.62), k, sc);
          cx += colW[ci] + 0.5 * size;
        });
      });
      // the parens, stretched over the matrix
      for (const [ch, px] of [['(', x - 0.3 * size], [')', x + totalW + 0.3 * size]]) {
        const g = G[ch];
        if (g) placed.push({ glyph: ch, x: +px.toFixed(2), y: +(y + totalH / 2 - Math.abs(g.bounds[3]) * scale).toFixed(2), scale: +scale.toFixed(4), id: `${ch}#${placed.filter((p) => p.glyph === ch).length + 1}`, stretch: (totalH * 1.05) / (Math.abs(g.bounds[3] - g.bounds[1]) * scale || 1) });
      }
      return totalW + 1.1 * size;
    }
    return 0;
  };
  const symWidth = (ch, sc) => { const g = G[ch]; return g ? g.adv * sc * scale : 0.55 * size; };
  const w = walk(node, 0, 0, 0, 1);
  return { placed, width: w };
}

/**
 * The symbols two layouts share, paired by their stable ids: the a's with
 * the a's, the b's with the b's — the pairs the change animation rides.
 */
export function matchSymbols(a, b) {
  const at = new Map();
  a.placed.forEach((p, i) => { if (!at.has(p.id)) at.set(p.id, i); });
  const out = [];
  b.placed.forEach((p, j) => {
    const i = at.get(p.id);
    if (i !== undefined) out.push([i, j]);
  });
  return out;
}

const easeOut = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);

/** one contour of a glyph, its Béziers drawn from the relative tangents (the closing segment included) */
function traceContour(ctx, c) {
  const v = c.v, n = v.length;
  if (n < 2) return;
  const zero = [0, 0];
  const seg = (a, b) => {
    const o = c.o?.[a] ?? zero, inn = c.i?.[b] ?? zero;
    if (!o[0] && !o[1] && !inn[0] && !inn[1]) ctx.lineTo(v[b][0], v[b][1]);
    else ctx.bezierCurveTo(v[a][0] + o[0], v[a][1] + o[1], v[b][0] + inn[0], v[b][1] + inn[1], v[b][0], v[b][1]);
  };
  ctx.moveTo(v[0][0], v[0][1]);
  for (let k = 0; k < n - 1; k++) seg(k, k + 1);
  if (c.closed) { seg(n - 1, 0); ctx.closePath(); }
}

/** the laid-out formula, memoised: the same TeX, size and table give the same layout (a node draws it every frame) */
const laidCache = new Map();
function laidOut(tex, size, glyphs) {
  const key = `${size}\u0000${tex}`;
  let byTable = laidCache.get(glyphs);
  if (!byTable) { byTable = new Map(); laidCache.set(glyphs, byTable); if (laidCache.size > 4) laidCache.delete(laidCache.keys().next().value); }
  if (!byTable.has(key)) { if (byTable.size > 32) byTable.clear(); byTable.set(key, layout(parseTex(tex), size, glyphs)); }
  return byTable.get(key);
}

const formula = {
  type: 'math.formula', title: 'Formula', category: 'Math',
  description: 'a TeX formula drawn glyph by glyph in STIX Two Math, written on in reading order, changing into another with its shared symbols moving',
  ai: { when: 'an explainer\'s formula: a² + b² = c² written on, rearranged into c = √(a² + b²) with the symbols moving to their places (fill "to" and key the progress); the fractions, roots, sums and small matrices it reads', avoid: 'a formula nobody reads at that size (24 px at least on a 1080-high frame), more than one formula on screen, a formula on screen for less than its reading time (slower than text), symbols the model invented without computing' },
  props: {
    tex: { type: 'string', default: 'a^2 + b^2 = c^2', label: 'TeX', animatable: false, description: 'the subset the pack parses: \\frac{}{}, \\sqrt{}, ^, _, \\sum, \\int, \\begin{pmatrix}, \\text{}, \\color{accent}{}, \\mathbb{R}, the Greek letters, \\cdot \\times \\le \\ge \\ne \\infty \\to' },
    to: { type: 'string', default: '', label: 'Changes into', animatable: false, description: 'the formula it becomes: the symbols both share move, the others leave and arrive, over the progress' },
    glyphs: { type: 'asset', assetType: 'json', default: null, nullable: true, label: 'Glyphs', animatable: false, description: 'the font\'s glyph table, copied into the project by the formula tool' },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: 'the writing on, or the change' },
    size: { type: 'number', default: 64, min: 12, unit: 'px', label: 'Size' },
    colours: { type: 'json', default: {}, label: 'Colours', animatable: false, description: '{ "a": "@accent", "c": "#C2503C" }: the symbols named, coloured' },
    fill: { type: 'paint', default: '@text', label: 'Ink' },
    accent: { type: 'paint', default: '@accent', label: 'Accent', description: 'the colour of \\color{accent} and of "@accent" in the colours' },
    accent2: { type: 'paint', default: '@accent', label: 'Second accent', description: 'the colour of \\color{accent2}' },
  },
  bounds(p, host) {
    const size = p.size ?? 64;
    let w = Math.max(120, String(p.tex ?? '').length * size * 0.6);
    try {
      const glyphs = p.glyphs ? host?.asset?.(p.glyphs) : null;
      if (glyphs?.glyphs) w = Math.max(laidOut(p.tex, size, glyphs).width, p.to ? laidOut(p.to, size, glyphs).width : 0);
    } catch { /* the estimate */ }
    return { x: -w / 2, y: -size * 1.1, w, h: size * 2.2 };
  },
  render: {
    canvas2d(ctx, p, host) {
      let glyphs = null;
      try { glyphs = p.glyphs ? host.asset(p.glyphs) : null; } catch { glyphs = null; }
      if (!glyphs?.glyphs) return;
      const size = p.size;
      const ink = typeof p.fill === 'string' ? p.fill : '#F4F5F7';
      // a symbol's colour: \color in the TeX, else the colours map by the symbol as written, else the ink
      // a token named in the TeX or the map reads through the node's own paints (the tokens resolve there)
      const named = (c) => (c === '@accent' ? p.accent : c === '@accent2' ? p.accent2 : c.startsWith('@') ? ink : c);
      const colorOf = (g) => {
        if (typeof g.color === 'string') return named(g.color);
        const ch = String(g.id ?? '').split('#')[0];
        return p.colours && typeof p.colours[ch] === 'string' ? named(p.colours[ch]) : ink;
      };
      const drawGlyph = (g) => {
        const def = glyphs.glyphs[g.glyph];
        if (!def) return;
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.scale(g.scale || 1, -(g.scale || 1));
        ctx.fillStyle = colorOf(g);
        ctx.globalAlpha = g.alpha ?? 1;
        // the contours of a glyph filled together, so the counter of an o stays a hole
        ctx.beginPath();
        for (const path of def.v) traceContour(ctx, path);
        ctx.fill('nonzero');
        ctx.restore();
      };
      const drawRule = (g) => {
        ctx.fillStyle = colorOf(g);
        ctx.globalAlpha = g.alpha ?? 1;
        ctx.fillRect(g.x, g.y - size * 0.03, g.rule || size * 0.5, Math.max(1.5, size * 0.055));
        ctx.globalAlpha = 1;
      };
      const drawOne = (g, u) => {
        if (g.rule) { if (u > 0.3) drawRule({ ...g, rule: (g.rule || 0) * Math.min(1, (u - 0.3) / 0.7) }); return; }
        if (u >= 1) { drawGlyph(g); return; }
        if (u > 0.55) drawGlyph({ ...g, alpha: Math.min(1, (u - 0.55) / 0.45) });
      };
      const A = laidOut(p.tex, size, glyphs);
      // the formula centred on the layer: its width (or the change's, sliding from one to the other)
      const B = p.to ? laidOut(p.to, size, glyphs) : null;
      ctx.save();
      ctx.translate(-(B ? A.width + (B.width - A.width) * easeOut(p.progress) : A.width) / 2, 0);
      if (!p.to) {
        // the writing on, in reading order
        const count = A.placed.length + 1;
        A.placed.forEach((g, i) => drawOne(g, Math.min(1, Math.max(0, (p.progress * count - i) / 1.4))));
      } else {
        // the change: the shared symbols slide, the rest fades and arrives
        const pairs = matchSymbols(A, B);
        const gone = A.placed.map((_, i) => !pairs.some((pr) => pr[0] === i));
        const fresh = B.placed.map((_, j) => !pairs.some((pr) => pr[1] === j));
        const e = easeOut(p.progress);
        for (const [i, j] of pairs) {
          const a = A.placed[i], b = B.placed[j];
          drawOne({ ...b, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }, 1);
        }
        for (let i = 0; i < A.placed.length; i++) if (gone[i]) drawOne({ ...A.placed[i], alpha: 1 - Math.min(1, e * 2) }, 1);
        const newCount = Math.max(1, fresh.filter(Boolean).length);
        let k = 0;
        for (let j = 0; j < B.placed.length; j++) if (fresh[j]) {
          const u = Math.min(1, Math.max(0, (e - 0.5) * 2 * newCount - k));
          k++;
          if (u > 0) drawOne({ ...B.placed[j], alpha: Math.min(1, u * 2) }, 1);
        }
      }
      ctx.restore();
    },
  },
};

// ── the tool ─────────────────────────────────────────────────
const GLYPHS_PATH = 'assets/math/glyphs.json';

const formulaTool = {
  name: 'formula', title: 'Show a formula',
  description: 'a TeX formula laid out in STIX Two Math, written on or changing into a second one, the font\'s glyph table copied into the project so it draws the same everywhere',
  input: {
    type: 'object',
    properties: {
      tex: { type: 'string', title: 'TeX', description: '"a^2 + b^2 = c^2", "\\frac{a}{b}", "\\sum_{i=1}^{n} x_i"' },
      to: { type: 'string', title: 'Changes into', description: 'the formula it becomes: the shared symbols move to their places' },
      size: { type: 'number', title: 'Size', description: 'the em in px; 24 at least on a 1080-high frame' },
      seconds: { type: 'number', title: 'Seconds', description: 'from the symbol count by default (a formula is slower than text)' },
    },
    required: ['tex'],
  },
  ai: { when: 'a formula the film reads out: written on symbol by symbol, or rearranged (fill "to") the way a proof unfolds on a board; the tool copies the font\'s glyphs into the project', avoid: 'a formula the voice does not explain, more than one on screen, a size under 24 px, symbols invented without computing (a wrong formula is worse than none)' },
  async run({ tex, to = '', size, seconds }, ctx) {
    const comp = ctx.doc.compositions[ctx.compId];
    const portrait = comp.height > comp.width;
    const floor = Math.round((portrait ? 28 / 1920 : 24 / 1080) * comp.height);
    const em = Math.max(floor, Math.round(size ?? (portrait ? 44 : 56)));
    let glyphs;
    try { glyphs = JSON.parse(await ctx.packFile('glyphs.json')); } catch { glyphs = null; }
    if (!glyphs?.glyphs) throw new Error('the font\'s glyph table is missing beside the pack');
    // the formula must parse before anything is written
    const tree = parseTex(tex);
    if (to) parseTex(to);
    const laid = layout(tree, em, glyphs);
    // a symbol the shipped font does not carry would leave a hole: said before anything is written
    const missing = [...new Set([tex, to].filter(Boolean).flatMap((x) => [...String(x).replace(/\\[a-zA-Z]+/g, '')]).filter((c) => /\S/.test(c) && !'{}^_&\\'.includes(c) && !glyphs.glyphs[c] && !glyphs.glyphs[c === '-' ? '−' : c]))];
    if (missing.length) throw new Error(`the formula's font has no glyph for ${missing.map((c) => `"${c}"`).join(', ')} — write it another way`);
    const symbols = laid.placed.filter((g) => !g.rule).length;
    const dur = Math.max(2.5, Math.min(14, seconds ?? 2 + symbols * 0.35));
    // the glyph table rides with the project, once: the node reads it as an asset, every formula the same one
    const ops = [];
    let gid = Object.entries(ctx.doc.assets).find(([, x]) => x.type === 'json' && x.src === GLYPHS_PATH)?.[0];
    if (!gid) {
      const path = await ctx.writeFile(GLYPHS_PATH, JSON.stringify(glyphs));
      gid = 'math-glyphs';
      for (let n = 2; ctx.doc.assets[gid]; n++) gid = `math-glyphs-${n}`;
      ops.push({ op: 'add', path: '/assets/' + gid, value: { type: 'json', src: path, name: 'Math glyphs' } });
    }
    const accent = ctx.doc.tokens?.accent?.type === 'color' ? '@accent' : '#2EC4B6';
    const cid = 'formula-' + Date.now().toString(36);
    const layer = {
      type: 'math.formula', name: String(tex).slice(0, 24), in: 0.2, out: dur,
      transform: { position: [Math.round(comp.width / 2), Math.round(comp.height / 2)] },
      props: {
        tex, glyphs: gid, size: em,
        fill: ctx.doc.tokens?.text?.type === 'color' ? '@text' : '#F4F5F7',
        ...(to ? { to } : {}),
        progress: { $k: [{ t: 0.2, v: 0 }, { t: Math.round(0.2 + dur * 0.55 * 1000) / 1000, v: 1 }] },
      },
    };
    ops.push({ op: 'add', path: '/compositions/' + cid, value: { name: 'Formula · ' + String(tex).slice(0, 24), width: comp.width, height: comp.height, fps: comp.fps ?? 30, duration: dur, background: comp.background, layers: { f: layer }, order: ['f'] } });
    return {
      ops, label: 'Formula',
      text: symbols + ' symbols at ' + em + ' px (the floor at this format is ' + floor + ' px), on screen ' + dur.toFixed(1) + ' s' + (to ? ', changing into "' + to + '" — the shared symbols move, the others leave and arrive' : ', written on in reading order') + '. The glyph table is an asset of the project (' + Object.keys(glyphs.glyphs).length + ' glyphs from STIX Two Math); colour a symbol with the colours map ("a": "' + accent + '").',
    };
  },
};

// ── the check ────────────────────────────────────────────────
const formulaLegibility = {
  name: 'formula-legibility', title: 'Formula legibility',
  description: 'type under its size for the format (24 px on a 1080-high frame, 28 in 9:16), a formula on screen for less than its reading time (slower than text)',
  run(ctx) {
    const out = [];
    const portrait = ctx.comp.height > ctx.comp.width;
    const floor = Math.round((portrait ? 28 / 1920 : 24 / 1080) * ctx.comp.height);
    const seen = new Set();
    for (const sample of ctx.samples) {
      for (const placed of sample.layers) {
        if (placed.node.type !== 'math.formula' || placed.opacity < 0.5 || seen.has(placed.id)) continue;
        seen.add(placed.id);
        const name = placed.layer.name ?? placed.id;
        const size = Number(placed.props.size) || 0;
        if (size && size < floor) out.push({ check: 'formula-legibility', severity: 'warning', message: name + ': the formula is ' + Math.round(size) + ' px — under ' + floor + ' px at this format it cannot be read; set it to ' + floor + ' px or more' });
        const l = placed.layer, span = (l.out ?? ctx.comp.duration) - (l.in ?? 0);
        const symbols = String(placed.props.tex ?? '').length;
        const read = 1.6 + symbols * 0.3;
        if (span > 0 && span < read) out.push({ check: 'formula-legibility', severity: 'warning', message: name + ': on screen ' + span.toFixed(1) + ' s — reading it wants about ' + read.toFixed(1) + ' s; a formula is slower than text' });
      }
    }
    return out;
  },
};

export const meta = { id: 'tramme/math', name: 'math', version: '1.0.0', description: 'Formulas: a TeX subset laid out glyph by glyph in STIX Two Math, written on or changing like a proof on a board', api: 1 };
export const nodes = [formula];
export const tools = [formulaTool];
export const checks = [formulaLegibility];
export const messages = {
  fr: {
    "Accent": "Accent",
    "the colour of \\color{accent} and of \"@accent\" in the colours": "la couleur de \\color{accent} et de « @accent » dans les couleurs",
    "Second accent": "Second accent",
    "the colour of \\color{accent2}": "la couleur de \\color{accent2}",
    "\"a^2 + b^2 = c^2\", \"\\frac{a}{b}\", \"\\sum_{i=1}^{n} x_i\"": "« a^2 + b^2 = c^2 », « \\frac{a}{b} », « \\sum_{i=1}^{n} x_i »",
    'Formula': 'Formule', 'Show a formula': 'Montrer une formule', 'Formula legibility': 'Lisibilité d’une formule',
    'TeX': 'TeX', 'Changes into': 'Devient', 'Glyphs': 'Glyphes', 'Progress': 'Progression', 'Size': 'Corps', 'Colours': 'Couleurs', 'Ink': 'Encre',
    'Seconds': 'Secondes',
    'the subset the pack parses: \\frac{}{}, \\sqrt{}, ^, _, \\sum, \\int, \\begin{pmatrix}, \\text{}, \\color{accent}{}, \\mathbb{R}, the Greek letters, \\cdot \\times \\le \\ge \\ne \\infty \\to': 'le sous-ensemble que le pack lit : \\frac{}{}, \\sqrt{}, ^, _, \\sum, \\int, \\begin{pmatrix}, \\text{}, \\color{accent}{}, \\mathbb{R}, les lettres grecques, \\cdot \\times \\le \\ge \\ne \\infty \\to',
    'the formula it becomes: the symbols both share move, the others leave and arrive, over the progress': 'la formule qu’elle devient : les symboles partagés glissent, les autres partent et arrivent, sur la progression',
    'the font\'s glyph table, copied into the project by the formula tool': 'la table de glyphes de la police, copiée dans le projet par l’outil formule',
    'the writing on, or the change': 'l’écriture, ou le changement',
    '{ "a": "@accent", "c": "#C2503C" }: the symbols named, coloured': '{ « a » : « @accent », « c » : « #C2503C » } : les symboles nommés, colorés',
    'a TeX formula drawn glyph by glyph in STIX Two Math, written on in reading order, changing into another with its shared symbols moving': 'une formule TeX dessinée glyphe par glyphe en STIX Two Math, écrite dans l’ordre de lecture, changeant en une autre avec ses symboles partagés qui glissent',
    'the em in px; 24 at least on a 1080-high frame': 'le corps en px ; 24 au moins sur un cadre de 1080 de haut',
    'from the symbol count by default (a formula is slower than text)': 'd’après le nombre de symboles par défaut (une formule est plus lente que le texte)',
    'the formula it becomes: the shared symbols move to their places': 'la formule qu’elle devient : les symboles partagés rejoignent leur place',
    'a TeX formula laid out in STIX Two Math, written on or changing into a second one, the font\'s glyph table copied into the project so it draws the same everywhere': 'une formule TeX disposée en STIX Two Math, écrite ou changeant en une seconde, la table de glyphes de la police copiée dans le projet pour qu’elle se dessine pareil partout',
    'type under its size for the format (24 px on a 1080-high frame, 28 in 9:16), a formula on screen for less than its reading time (slower than text)': 'du texte sous sa taille pour le format (24 px sur un cadre de 1080 de haut, 28 en 9:16), une formule à l’écran moins de son temps de lecture (plus lente que le texte)',
  },
};
