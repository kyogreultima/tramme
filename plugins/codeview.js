// Code and terminal on screen, for developer tools and product films: code
// that types, changes (a diff of tokens: what both versions share slides,
// the rest leaves and arrives) and points at itself, and a terminal session
// that runs — commands typed, output arriving, waits holding. The lexer is a
// table of sticky regexes per language, written here so the colours derive
// from the tokens at a contrast the format can read. The code-screen tool
// lays it in the walkthrough pack's window frame; the code-legibility check
// flags what a phone cannot read.

// ── seeded rhythm ────────────────────────────────────────────
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * One time per character: when it appears. Deterministic (the same seed gives
 * the same rhythm), uneven like a person typing, a pause at each line's end.
 * `cps` is the average pace, 18 characters a second by default.
 */
export function typingTimes(text, seed = 1, cps = 18) {
  const rnd = mulberry32(seed >>> 0);
  const out = [];
  let t = 0;
  for (const ch of String(text)) {
    out.push(t);
    let step = (0.55 + rnd() * 0.9) / cps;
    if (ch === '\n') step += 6 / cps;
    t += step;
  }
  return out;
}

// ── the lexer ────────────────────────────────────────────────
const words = (list) => new RegExp(`(?:${list.join('|')})\\b`, 'y');

const JS_KW = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'class', 'extends', 'new', 'import', 'from', 'export', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'switch', 'case', 'break', 'continue', 'delete', 'void', 'yield', 'static', 'get', 'set', 'this', 'super', 'null', 'undefined', 'true', 'false'];
const TS_KW = JS_KW.concat(['interface', 'enum', 'implements', 'private', 'public', 'protected', 'readonly', 'namespace', 'declare', 'abstract', 'as', 'satisfies', 'keyof', 'infer', 'never', 'unknown', 'any', 'string', 'number', 'boolean', 'object', 'symbol']);
const PY_KW = ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'import', 'from', 'as', 'class', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield', 'pass', 'break', 'continue', 'global', 'nonlocal', 'del', 'assert', 'async', 'await', 'is', 'None', 'True', 'False'];
const RS_KW = ['fn', 'let', 'mut', 'const', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'match', 'if', 'else', 'loop', 'while', 'for', 'in', 'return', 'break', 'continue', 'where', 'async', 'await', 'move', 'ref', 'dyn', 'crate', 'self', 'Self', 'super', 'as', 'type', 'unsafe', 'extern', 'static', 'true', 'false'];
const GO_KW = ['func', 'package', 'import', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer', 'if', 'else', 'for', 'range', 'return', 'switch', 'case', 'default', 'break', 'continue', 'fallthrough', 'select', 'goto', 'nil', 'true', 'false'];
const SH_KW = ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'export', 'local', 'source', 'set', 'shift', 'trap', 'in'];
const SQL_KW = ['select', 'from', 'where', 'and', 'or', 'not', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'drop', 'alter', 'add', 'join', 'left', 'right', 'inner', 'outer', 'on', 'as', 'group', 'by', 'order', 'having', 'limit', 'offset', 'distinct', 'union', 'all', 'null', 'is', 'in', 'like', 'between', 'case', 'when', 'then', 'else', 'end', 'primary', 'key', 'foreign', 'references', 'index', 'with', 'returning', 'asc', 'desc', 'true', 'false', 'count', 'sum', 'avg', 'min', 'max'];

const STR = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/y;
const NUM = /0[xXbBoO][0-9a-fA-F_]+n?|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?n?/y;
const ID = /[A-Za-z_$][\w$]*/y;
const FN = /[A-Za-z_$][\w$]*(?=[ \t]*\()/y;
const TYPE = /[A-Z][A-Za-z0-9_]*\b/y;
const OP = /[+\-*/%=<>!&|^~?:]+/y;
const PUNCT = /[{}[\]();,.@#]/y;
const WS = /\s+/y;

/** the lexer's table: one row of sticky regexes per language, applied in order */
const RULES = {
  js: [[WS, 'ws'], [ /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, 'com'], [STR, 'str'], [NUM, 'num'], [words(JS_KW), 'kw'], [FN, 'fn'], [TYPE, 'type'], [ID, 'id'], [OP, 'op'], [PUNCT, 'punct']],
  ts: [[WS, 'ws'], [ /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, 'com'], [STR, 'str'], [NUM, 'num'], [words(TS_KW), 'kw'], [FN, 'fn'], [TYPE, 'type'], [ID, 'id'], [OP, 'op'], [PUNCT, 'punct']],
  py: [[WS, 'ws'], [/#[^\n]*/y, 'com'], [/"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/y, 'str'], [STR, 'str'], [NUM, 'num'], [words(PY_KW), 'kw'], [FN, 'fn'], [TYPE, 'type'], [/[A-Za-z_][\w$]*/y, 'id'], [OP, 'op'], [PUNCT, 'punct']],
  rs: [[WS, 'ws'], [/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, 'com'], [/r?#*"(?:[^"\\]|\\.)*"#*/y, 'str'], [STR, 'str'], [NUM, 'num'], [words(RS_KW), 'kw'], [/'\w+\b/y, 'type'], [FN, 'fn'], [TYPE, 'type'], [ID, 'id'], [/->|=>|::|[-+*/%=<>!&|^~?:]+/y, 'op'], [PUNCT, 'punct']],
  go: [[WS, 'ws'], [/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, 'com'], [/`[^`]*`/y, 'str'], [STR, 'str'], [NUM, 'num'], [words(GO_KW), 'kw'], [FN, 'fn'], [TYPE, 'type'], [ID, 'id'], [/<-|:=|[-+*/%=<>!&|^~?:]+/y, 'op'], [PUNCT, 'punct']],
  sh: [[WS, 'ws'], [/#[^\n]*/y, 'com'], [STR, 'str'], [NUM, 'num'], [words(SH_KW), 'kw'], [/\$\{?[\w]+\}?/y, 'type'], [/[A-Za-z_][\w-]*(?=[ \t]*\()/y, 'fn'], [/[A-Za-z_][\w-]*/y, 'id'], [OP, 'op'], [/[{}[\]();,.@#]/y, 'punct']],
  json: [[WS, 'ws'], [/"(?:[^"\\]|\\.)*"(?=[ \t]*:)/y, 'type'], [/"(?:[^"\\]|\\.)*"/y, 'str'], [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, 'num'], [/\b(?:true|false|null)\b/y, 'kw'], [OP, 'op'], [/[{}[\],:]/y, 'punct']],
  css: [[WS, 'ws'], [/\/\*[\s\S]*?(?:\*\/|$)/y, 'com'], [STR, 'str'], [/@[\w-]+/y, 'kw'], [/\d+(?:\.\d+)?(?:px|em|rem|vh|vw|vmin|s|ms|deg|%)?/y, 'num'], [/[-a-zA-Z]+(?=[ \t]*:)/y, 'type'], [/[.#][\w-]+/y, 'fn'], [/[a-zA-Z-][\w-]*/y, 'id'], [OP, 'op'], [/[{}();,]/y, 'punct']],
  html: [[WS, 'ws'], [/<!--[\s\S]*?(?:-->|$)/y, 'com'], [/<!DOCTYPE[^>]*>/iy, 'kw'], [/<\/?[a-zA-Z][\w-]*/y, 'kw'], [/"[^"]*"|'[^']*'/y, 'str'], [/[a-zA-Z-]+(?==)/y, 'type'], [/[<>\/=]/y, 'punct'], [/&[\w#]+;/y, 'num'], [/[^\s<]+/y, 'id']],
  yaml: [[WS, 'ws'], [/#[^\n]*/y, 'com'], [/---|\.\.\./y, 'punct'], [/[\w.-]+(?=[ \t]*:(?:\s|$))/y, 'type'], [STR, 'str'], [/(?:true|false|null|yes|no|on|off|~)(?=\s|$)/iy, 'kw'], [/-?\d+(?:\.\d+)?(?=\s|$|,|\])/y, 'num'], [/[&*][\w-]+/y, 'fn'], [/[:\-|>[\]{},?]/y, 'punct'], [/[^\s#:,[\]{}]+/y, 'id']],
  sql: [[WS, 'ws'], [/--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, 'com'], [/'(?:[^']|'')*'/y, 'str'], [/"(?:[^"]|"")*"/y, 'type'], [NUM, 'num'], [new RegExp(`(?:${SQL_KW.join('|')})\\b`, 'iy'), 'kw'], [FN, 'fn'], [ID, 'id'], [/[<>!=]=?|\|\||[-+*/%]/y, 'op'], [/[(),;.]/y, 'punct']],
};
const LANGS = Object.keys(RULES);

/**
 * Code into tokens, one pass of sticky regexes per language, the whole text
 * kept (nothing dropped, the fallback one code point at a time). `lang`:
 * 'js', 'ts', 'py', 'rs', 'go', 'sh', 'json', 'yaml', 'sql', 'css' or 'html'.
 */
export function lex(code, lang = 'js') {
  const rules = RULES[lang] ?? RULES.js;
  const src = String(code);
  const out = [];
  let i = 0;
  while (i < src.length) {
    let hit = null;
    for (const [re, kind] of rules) {
      re.lastIndex = i;
      const m = re.exec(src);
      if (m && m[0].length > 0) { hit = { text: m[0], kind }; break; }
    }
    if (hit) { out.push(hit); i += hit.text.length; continue; }
    const cp = src.codePointAt(i);
    const n = cp > 0xffff ? 2 : 1;
    out.push({ text: src.slice(i, i + n), kind: 'punct' });
    i += n;
  }
  return out;
}

// ── the diff ─────────────────────────────────────────────────
const CAP = 2000;

/**
 * The two versions' tokens matched by longest common subsequence (on kind and
 * text): `kept` pairs a source index with its target one, `removed` and
 * `added` list the indexes that leave and arrive. A very large version is
 * matched whole (nothing kept) rather than costing a matrix of millions.
 */
export function tokenDiff(a, b) {
  if (a.length > CAP || b.length > CAP) return { kept: [], removed: a.map((_, i) => i), added: b.map((_, i) => i) };
  const key = (t) => `${t.kind}\u0000${t.text}`;
  const m = b.length;
  const row = (i) => i * (m + 1);
  const dp = new Int32Array((a.length + 1) * (m + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[row(i) + j] = key(a[i]) === key(b[j])
        ? dp[row(i + 1) + j + 1] + 1
        : Math.max(dp[row(i + 1) + j], dp[row(i) + j + 1]);
    }
  }
  const kept = [], removed = [], added = [];
  let i = 0, j = 0;
  while (i < a.length && j < m) {
    if (key(a[i]) === key(b[j])) { kept.push([i, j]); i++; j++; }
    else if (dp[row(i + 1) + j] >= dp[row(i) + j + 1]) { removed.push(i++); }
    else { added.push(j++); }
  }
  while (i < a.length) removed.push(i++);
  while (j < m) added.push(j++);
  return { kept, removed, added };
}

// ── the terminal session ─────────────────────────────────────
/** an ANSI escape as a session writes it: the ESC character, or its spellings "\e[", "\x1b[", "\033[" */
const ANSI = /(?:\u001b|\\e|\\x1b|\\033)\[([\d;]*)m/g;

/** the colour an SGR code asks, as the pack's own names: the tokens stand for the terminal's palette */
function sgrColour(codes, prev) {
  let c = prev;
  for (const n of codes) {
    if (n === 0 || n === 39 || n === 22) c = null;
    else if (n === 2 || n === 90) c = 'dim';
    else if ([32, 34, 36, 92, 94, 96].includes(n)) c = 'accent';
    else if ([31, 33, 35, 91, 93, 95].includes(n)) c = 'accent2';
    else if (n === 1 || n === 37 || n === 97) c = 'bright';
  }
  return c;
}

/** a line's ANSI colours into runs of text: { text, colour } with colour null, 'dim', 'accent', 'accent2' or 'bright' */
export function ansiRuns(line) {
  const runs = [];
  let colour = null, last = 0;
  const src = String(line ?? '');
  for (const m of src.matchAll(ANSI)) {
    if (m.index > last) runs.push({ text: src.slice(last, m.index), colour });
    colour = sgrColour((m[1] || '0').split(';').map(Number), colour);
    last = m.index + m[0].length;
  }
  if (last < src.length) runs.push({ text: src.slice(last), colour });
  return runs.filter((r) => r.text.length);
}

const plain = (s) => String(s ?? '').replace(ANSI, '');

/**
 * A session written as a script: a line `$ cmd` is a command typed, `...`
 * (or `…`, with optional seconds: `... 2.5`) a wait, `[###] 2.5 label` a
 * progress bar filling over its seconds, `> line` (or a bare line) output
 * arriving; ANSI colours (`\e[32m`) are read on the output.
 */
export function parseSession(script) {
  const out = [];
  for (const raw of String(script).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    let m = /^\$\s?(.*)$/.exec(line);
    if (m) { out.push({ kind: 'cmd', text: plain(m[1]) }); continue; }
    m = /^(?:\.{3}|…)(?:[ \t]+(\d+(?:\.\d+)?))?$/.exec(line.trim());
    if (m) { out.push({ kind: 'wait', text: line.trim(), seconds: m[1] ? Number(m[1]) : 1 }); continue; }
    m = /^\[#+\](?:[ \t]+(\d+(?:\.\d+)?))?(?:[ \t]+(.*))?$/.exec(line.trim());
    if (m) { out.push({ kind: 'bar', text: plain(m[2] ?? ''), seconds: m[1] ? Number(m[1]) : 1.5 }); continue; }
    m = /^>\s?(.*)$/.exec(line);
    if (m) { out.push({ kind: 'out', text: plain(m[1]), runs: ansiRuns(m[1]) }); continue; }
    out.push({ kind: 'out', text: plain(line), runs: ansiRuns(line) });
  }
  return out;
}

/** each item's window on the clock: a command typed at the human rhythm, output arriving, a wait holding */
function sessionTimeline(script) {
  const items = parseSession(script);
  let t = 0.35;
  return items.map((it) => {
    let dur;
    if (it.kind === 'cmd') dur = (typingTimes(it.text, 7).pop() ?? 0) + 0.35;
    else if (it.kind === 'wait' || it.kind === 'bar') dur = it.seconds ?? 1;
    else dur = 0.3 + Math.min(1.1, it.text.length / 45);
    const win = { ...it, at: +t.toFixed(3), until: +(t + dur).toFixed(3) };
    t += dur;
    return win;
  });
}

// ── layout, memoised ─────────────────────────────────────────
const memo = new Map();
const once = (key, make) => {
  if (memo.has(key)) return memo.get(key);
  if (memo.size > 24) memo.clear();
  const v = make();
  memo.set(key, v);
  return v;
};

/** a token's text split where it crosses a line, keeping its kind */
function segments(tk) {
  return String(tk.text).split('\n').map((part, k) => ({ text: part, kind: tk.kind, head: k === 0 }));
}

/** the lines of tokens laid out to their x positions (needs a measuring ctx) */
function layoutLines(text, lang, ctx, size) {
  const key = `L${lang}\u0000${size}\u0000${text}`;
  return once(key, () => {
    const lines = [[]];
    let x = 0, idx = 0;
    for (const tk of lex(text, lang)) {
      for (const seg of segments(tk)) {
        if (seg.head && lines[lines.length - 1].length) { /* token continues on its line */ }
        if (!seg.head) { lines.push([]); x = 0; }
        if (seg.text) {
          const w = ctx.measureText(seg.text).width;
          lines[lines.length - 1].push({ text: seg.text, kind: seg.kind, x, w, i: idx });
          x += w;
        }
      }
      idx++;
    }
    return lines;
  });
}

/** what fits: the lines a panel of this height holds at this type size */
export function maxLines(panelHeight, size) {
  const pad = Math.max(14, size * 0.55);
  return Math.max(1, Math.floor((panelHeight - 2 * pad) / (size * 1.55)));
}

const easeOut = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);

// ── readable colours ─────────────────────────────────────────
const rgbOf = (c) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lumOf = (rgb) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};

/** the contrast of two hex colours (WCAG), Infinity when one is not a hex colour */
export function contrastOf(a, b) {
  const A = rgbOf(a), B = rgbOf(b);
  if (!A || !B) return Infinity;
  const la = lumOf(A), lb = lumOf(B);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** a token's colour moved away from the plate (toward white on a dark one, black on a light one) until it reads at `min`:1; a colour that is not hex stays as given */
export function readable(colour, plate, min = 4.5) {
  const C = rgbOf(colour), P = rgbOf(plate);
  if (!C || !P || contrastOf(colour, plate) >= min) return colour;
  const to = lumOf(P) < 0.18 ? 255 : 0;
  for (let k = 1; k <= 10; k++) {
    const hex = `#${C.map((v) => Math.round(v + ((to - v) * k) / 10).toString(16).padStart(2, '0')).join('')}`;
    if (contrastOf(hex, plate) >= min) return hex;
  }
  return to ? '#ffffff' : '#000000';
}

/** the node's colours, each read against its panel */
const paletteOf = (p) => ({ ink: readable(p.ink, p.plate), accent: readable(p.accent, p.plate), accent2: readable(p.accent2 ?? p.accent, p.plate) });

// ── the code node ────────────────────────────────────────────
function familyOf(p, host) {
  if (!p.font) return 'ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';
  try { return `"${host.asset(p.font)}", ui-monospace, Menlo, Consolas, monospace`; } catch { return 'ui-monospace, Menlo, Consolas, monospace'; }
}

const codeNode = {
  type: 'codeview.code', title: 'Code', category: 'Code',
  description: 'a program on screen in the kit\'s mono typeface, coloured by its tokens, typed or changed from a previous version',
  ai: { when: 'a developer tool\'s film: a function typed, a change shown (fill "from" with the previous version and key "progress"), lines highlighted while the voice points at them; keep to the lines that matter', avoid: 'a whole file at once (cut it to the lines the voice speaks about), type under 24 px, code as a picture the viewer cannot read in time; the code view is never for prose' },
  props: {
    code: { type: 'string', default: 'const ready = true;\nship();', label: 'Code', description: 'the code shown, in the language set; multiline' },
    lang: { type: 'enum', default: 'js', options: LANGS, label: 'Language', animatable: false },
    from: { type: 'string', default: '', label: 'Previous version', description: 'the code it changes from: the tokens both share slide, the rest leaves and arrives, over "progress"' },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: '1: the whole code shown (or the change done); key it for the typing' },
    highlight: { type: 'array', default: [], items: { type: 'integer' }, label: 'Highlight', description: 'the lines (1-based) to lift; the others dim, the view scrolls to the first' },
    size: { type: 'number', default: 26, min: 8, step: 1, unit: 'px', label: 'Type size' },
    panel: { type: 'vec2', default: [960, 620], label: 'Panel', unit: 'px', animatable: false },
    ink: { type: 'paint', default: '@text', label: 'Code colour' },
    accent: { type: 'paint', default: '@accent', label: 'Accent' },
    accent2: { type: 'paint', default: '@accent', label: 'Second accent' },
    plate: { type: 'paint', default: '#0D1117', label: 'Panel' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds: ({ panel: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: {
    canvas2d(ctx, p, host) {
      const [w, h] = p.panel;
      if (w <= 0 || h <= 0) return;
      const size = p.size, lineH = size * 1.55, pad = Math.max(14, size * 0.55);
      const family = familyOf(p, host);
      ctx.font = `500 ${size}px ${family}`;
      const target = String(p.code ?? ''), source = String(p.from ?? '');
      const changing = source.length > 0 && p.progress < 0.999;
      const visible = Math.max(1, Math.floor((h - 2 * pad) / lineH));
      const lineCount = target.split('\n').length;
      // scrolled to the first highlighted line when the code is longer than the panel
      const hl = (p.highlight ?? []).map((n) => Number(n) - 1).filter((n) => n >= 0);
      const first = hl.length ? Math.min(...hl) : 0;
      const start = lineCount > visible ? Math.max(0, Math.min(first - 1, lineCount - visible)) : 0;
      // the panel
      ctx.fillStyle = p.plate;
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(18, size)); ctx.fill();
      // the highlighted lines' band, under everything
      const bandY = (n) => -h / 2 + pad + (n - start) * lineH;
      const pal = paletteOf(p);
      ctx.fillStyle = pal.ink;
      for (const n of hl) {
        if (n < start || n >= start + visible) continue;
        ctx.globalAlpha = 0.08;
        ctx.fillRect(-w / 2 + 4, bandY(n), w - 8, lineH);
        ctx.globalAlpha = 1;
      }
      // the line numbers
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillStyle = pal.ink;
      ctx.globalAlpha = 0.35;
      const gutter = Math.max(2, String(lineCount).length);
      for (let n = start; n < Math.min(lineCount, start + visible); n++) ctx.fillText(String(n + 1), -w / 2 + pad + gutter * size * 0.32, bandY(n) + (lineH - size) / 2);
      ctx.globalAlpha = 1;
      const x0 = -w / 2 + pad + gutter * size * 0.32 + size * 0.9;
      const kindColor = (kind) => (kind === 'kw' || kind === 'fn') ? pal.accent : kind === 'str' ? pal.accent2 : pal.ink;
      const inView = (n) => n >= start && n < start + visible;
      const dimmed = (n) => hl.length > 0 && !hl.includes(n);
      ctx.textAlign = 'left';
      const drawSeg = (text, kind, x, y, alpha) => {
        ctx.fillStyle = kindColor(kind);
        ctx.globalAlpha = alpha * (kind === 'com' ? 0.55 : 1);
        ctx.fillText(text, x, y);
        ctx.globalAlpha = 1;
      };
      if (changing) {
        // the change: what both share slides to its place, the rest fades out, the new types in
        const tgt = layoutLines(target, p.lang, ctx, size), src = layoutLines(source, p.lang, ctx, size);
        const flat = (lines) => {
          const map = new Map();
          for (let n = 0; n < lines.length; n++) for (const seg of lines[n]) if (!map.has(seg.i)) map.set(seg.i, { line: n, x: seg.x, text: seg.text, kind: seg.kind });
          return map;
        };
        const from = flat(src), to = flat(tgt);
        const { kept, removed, added } = once(`D\u0000${source.length}\u0000${target.length}\u0000${lex(source, p.lang).length}\u0000${lex(target, p.lang).length}\u0000${source}\u0000${target}`, () => tokenDiff(lex(source, p.lang), lex(target, p.lang)));
        const e = easeOut(p.progress);
        // a token on a line outside the panel's window is not drawn (never piled on the window's edge)
        const pos = (lines, map, i) => { const at = map.get(i); return at && inView(at.line) ? { x: x0 + at.x, y: bandY(at.line), line: at.line } : null; };
        for (const [ia, ib] of kept) {
          const a = pos(src, from, ia), b = pos(tgt, to, ib);
          if (!a || !b) continue;
          const seg = (() => { for (const s of tgt[b.line] ?? []) if (s.i === ib) return s; return null; })();
          if (!seg) continue;
          drawSeg(seg.text, seg.kind, a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, dimmed(b.line) ? 0.35 : 1);
        }
        for (const ia of removed) {
          const a = pos(src, from, ia);
          if (!a) continue;
          const seg = (() => { for (const s of src[a.line] ?? []) if (s.i === ia) return s; return null; })();
          if (!seg) continue;
          drawSeg(seg.text, seg.kind, a.x, a.y, (1 - Math.min(1, e * 2)) * (dimmed(a.line) ? 0.35 : 1));
        }
        // the new ones type in over the second half, in reading order
        const e2 = Math.min(1, Math.max(0, (e - 0.5) * 2));
        let shown = 0, caretAt = null;
        for (const ib of added) {
          const b = pos(tgt, to, ib);
          if (!b) continue;
          const seg = (() => { for (const s of tgt[b.line] ?? []) if (s.i === ib) return s; return null; })();
          if (!seg) continue;
          shown++;
          if (shown / Math.max(1, added.length) > e2) { caretAt = { x: b.x, y: b.y }; break; }
          drawSeg(seg.text, seg.kind, b.x, b.y, dimmed(b.line) ? 0.35 : 1);
        }
        if (caretAt && Math.floor(host.frame ?? 0) % 30 < 18) { ctx.fillStyle = pal.accent; ctx.fillRect(caretAt.x, caretAt.y + size * 0.1, Math.max(2, size * 0.09), size); }
      } else if (p.progress < 0.999) {
        // the typing: characters at the seeded rhythm, the caret after the last one
        const times = once(`T\u0000${target}\u0000${p.lang}`, () => typingTimes(target, 7, 18));
        const total = (times[times.length - 1] ?? 0) + 0.6;
        const now = p.progress * total;
        const lines = layoutLines(target, p.lang, ctx, size);
        // characters shown, counted in code points along the whole text, its line breaks included
        let shownChars = 0;
        for (const t of times) if (t <= now) shownChars++;
        let walked = 0, caret = null;
        outer:
        for (let n = 0; n < lines.length; n++) {
          if (n > 0) walked++; // the line break before this line
          let x = 0;
          for (const seg of lines[n]) {
            const chars = [...seg.text];
            const remain = shownChars - walked;
            walked += chars.length;
            if (!inView(n)) { if (remain < chars.length) break outer; continue; }
            if (remain <= 0) { caret = { x: x0 + x, y: bandY(n) }; break outer; }
            const text = chars.slice(0, remain).join('');
            drawSeg(text, seg.kind, x0 + x, bandY(n), dimmed(n) ? 0.35 : 1);
            if (remain < chars.length) { caret = { x: x0 + x + ctx.measureText(text).width, y: bandY(n) }; break outer; }
            x += seg.w;
          }
          if (inView(n)) caret = { x: x0 + x, y: bandY(n) };
          if (shownChars - walked <= 0) break;
        }
        if (caret && Math.floor(host.frame ?? 0) % 30 < 18) { ctx.fillStyle = pal.accent; ctx.fillRect(caret.x, caret.y + size * 0.1, Math.max(2, size * 0.09), size); }
      } else {
        // at rest: the whole code, read from the panel's top
        const lines = layoutLines(target, p.lang, ctx, size);
        for (let n = start; n < Math.min(lines.length, start + visible); n++) {
          for (const seg of lines[n]) drawSeg(seg.text, seg.kind, x0 + seg.x, bandY(n), dimmed(n) ? 0.35 : 1);
        }
      }
    },
  },
  export: {
    svg(p) {
      // a still: the code as text, coloured, the whole of it (progress held at its value)
      const plate = typeof p.plate === 'string' ? p.plate : '#0D1117';
      const ink = readable(typeof p.ink === 'string' ? p.ink : '#e6edf3', plate), accent = readable(typeof p.accent === 'string' ? p.accent : '#2ec4b6', plate), accent2 = typeof p.accent2 === 'string' ? readable(p.accent2, plate) : accent;
      const color = (kind) => (kind === 'kw' || kind === 'fn') ? accent : kind === 'str' ? accent2 : ink;
      const [w, h] = p.panel;
      const size = p.size, lineH = size * 1.55, pad = Math.max(14, size * 0.55);
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      let shown = String(p.code ?? '');
      if (p.progress < 0.999) {
        const times = typingTimes(shown, 7, 18), total = (times[times.length - 1] ?? 0) + 0.6;
        let n = 0; for (const t of times) if (t <= p.progress * total) n++;
        shown = [...shown].slice(0, n).join('');
      }
      const lines = lex(shown, p.lang);
      const rows = [];
      let row = [], x = 0;
      for (const tk of lines) {
        const parts = String(tk.text).split('\n');
        parts.forEach((part, k) => {
          if (k > 0) { rows.push(row); row = []; x = 0; }
          if (part) { row.push({ part, kind: tk.kind, x }); x += part.length * size * 0.6; }
        });
      }
      rows.push(row);
      const body = rows.map((row, n) => row.map((seg) =>
        `<tspan x="${(pad + seg.x).toFixed(1)}" y="${(pad + n * lineH + size).toFixed(1)}" fill="${color(seg.kind)}"${seg.kind === 'com' ? ' fill-opacity="0.55"' : ''}>${esc(seg.part)}</tspan>`
      ).join('')).join('');
      // the node's own space is centred on the layer, as on the canvas
      return `<g transform="translate(${-w / 2} ${-h / 2})"><rect x="0" y="0" width="${w}" height="${h}" rx="14" fill="${plate}"/><text font-family="ui-monospace, Menlo, Consolas, monospace" font-size="${size}">${body}</text></g>`;
    },
  },
};

// ── the terminal node ────────────────────────────────────────
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const terminalNode = {
  type: 'codeview.terminal', title: 'Terminal', category: 'Code',
  description: 'a session that runs: commands typed at a human rhythm, output arriving in chunks, waits holding, a spinner stepping with time',
  ai: { when: 'a build or a test run under the voice: "$ npm run build", its output, a "..." wait between them; keep the session to what the film needs', avoid: 'a session longer than six or seven lines, output nobody reads, a wait without anything happening on the picture' },
  props: {
    script: { type: 'string', default: '$ npm run build\nvite v5 building...\n> built in 1.2s', label: 'Session', description: 'lines "$ command", "..." (with seconds: "... 2.5"), "[###] 2 label" for a progress bar and "> output" (ANSI colours read)' },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: '1: the session over; key it to run it' },
    size: { type: 'number', default: 26, min: 8, step: 1, unit: 'px', label: 'Type size' },
    panel: { type: 'vec2', default: [960, 560], label: 'Panel', unit: 'px', animatable: false },
    ink: { type: 'paint', default: '@text', label: 'Text colour' },
    accent: { type: 'paint', default: '@accent', label: 'Accent' },
    accent2: { type: 'paint', default: '@accent', label: 'Second accent' },
    plate: { type: 'paint', default: '#0D1117', label: 'Panel' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds: ({ panel: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: {
    canvas2d(ctx, p, host) {
      const [w, h] = p.panel;
      if (w <= 0 || h <= 0) return;
      const size = p.size, lineH = size * 1.55, pad = Math.max(14, size * 0.55);
      ctx.font = `500 ${size}px ${familyOf(p, host)}`;
      const pal = paletteOf(p);
      const timeline = once(`S\u0000${p.script}`, () => sessionTimeline(p.script));
      const total = timeline.length ? timeline[timeline.length - 1].until : 1;
      const now = p.progress * total;
      // the lines the session has reached, the panel keeping its last ones
      const rows = [];
      for (const it of timeline) {
        if (now < it.at) break;
        if (it.kind === 'cmd') {
          const times = typingTimes(it.text, 7);
          const typed = times.filter((t) => t <= now - it.at).length;
          rows.push({ kind: 'prompt', text: it.text.slice(0, typed), typing: typed < it.text.length });
        } else if (it.kind === 'out') {
          // the output arrives in chunks: its runs cut where the arriving share stands
          let left = Math.min(it.text.length, Math.ceil(((now - it.at) / 0.3) * it.text.length));
          const runs = [];
          for (const r of it.runs ?? [{ text: it.text, colour: null }]) {
            if (left <= 0) break;
            runs.push({ text: r.text.slice(0, left), colour: r.colour });
            left -= r.text.length;
          }
          rows.push({ kind: 'out', runs });
        } else if (it.kind === 'bar') {
          // a progress bar stepping with time, full once its seconds are over
          const u = Math.min(1, Math.max(0, (now - it.at) / Math.max(0.05, it.until - it.at)));
          rows.push({ kind: 'bar', text: it.text, u });
        } else if (now < it.until) {
          rows.push({ kind: 'wait', text: SPIN[Math.floor(host.frame ?? 0) % SPIN.length] });
        }
      }
      const visible = Math.max(1, Math.floor((h - 2 * pad) / lineH));
      ctx.fillStyle = p.plate;
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(18, size)); ctx.fill();
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const shownRows = rows.slice(-visible);
      shownRows.forEach((row, k) => {
        const y = -h / 2 + pad + k * lineH;
        if (row.kind === 'prompt') {
          ctx.fillStyle = pal.accent;
          ctx.globalAlpha = 0.9;
          ctx.fillText('$', -w / 2 + pad, y);
          ctx.globalAlpha = 1;
          ctx.fillStyle = pal.ink;
          ctx.fillText(row.text, -w / 2 + pad + size * 0.9, y);
          if (row.typing && Math.floor(host.frame ?? 0) % 30 < 18) { ctx.fillStyle = pal.accent; ctx.fillRect(-w / 2 + pad + size * 0.9 + ctx.measureText(row.text).width, y + size * 0.1, Math.max(2, size * 0.09), size); }
        } else if (row.kind === 'wait') {
          ctx.fillStyle = pal.accent;
          ctx.globalAlpha = 0.8;
          ctx.fillText(row.text, -w / 2 + pad, y);
          ctx.globalAlpha = 1;
        } else if (row.kind === 'bar') {
          const cells = 24, full = Math.round(row.u * cells);
          let x = -w / 2 + pad;
          if (row.text) { ctx.fillStyle = pal.ink; ctx.globalAlpha = 0.85; ctx.fillText(row.text, x, y); x += ctx.measureText(`${row.text} `).width; }
          ctx.fillStyle = pal.accent; ctx.globalAlpha = 1;
          ctx.fillText('█'.repeat(full), x, y);
          const wFull = ctx.measureText('█'.repeat(full)).width;
          ctx.globalAlpha = 0.3;
          ctx.fillText('█'.repeat(cells - full), x + wFull, y);
          ctx.globalAlpha = 0.85; ctx.fillStyle = pal.ink;
          ctx.fillText(` ${Math.round(row.u * 100)}%`, x + ctx.measureText('█'.repeat(cells)).width, y);
          ctx.globalAlpha = 1;
        } else {
          let x = -w / 2 + pad;
          for (const r of row.runs) {
            ctx.fillStyle = r.colour === 'accent' ? pal.accent : r.colour === 'accent2' ? pal.accent2 : pal.ink;
            ctx.globalAlpha = r.colour === 'dim' ? 0.5 : r.colour === 'bright' || r.colour === 'accent' || r.colour === 'accent2' ? 1 : 0.85;
            ctx.fillText(r.text, x, y);
            x += ctx.measureText(r.text).width;
          }
          ctx.globalAlpha = 1;
        }
      });
    },
  },
};

// ── the tool ─────────────────────────────────────────────────
const isSession = (code) => /(^|\n)\s*\$/.test(code);

const codeScreen = {
  name: 'code-screen', title: 'Show code on screen',
  description: 'code or a terminal session in a window frame, typed at a readable rhythm, the lines that matter highlighted, a long file cut to what fits',
  input: {
    type: 'object',
    properties: {
      code: { type: 'string', title: 'Code', description: 'the code, or a session ("$ npm test", "> 3 passed", "...") for a terminal' },
      fixed: { type: 'string', title: 'Fixed version', description: 'when given, the code changes into it: the tokens both share slide, the rest leaves and arrives' },
      lang: { enum: LANGS, title: 'Language', description: 'js by default' },
      title: { type: 'string', title: 'Window title', description: 'the file name, in the bar' },
      lines: { type: 'array', title: 'Highlight', items: { type: 'integer' }, description: 'the lines (1-based) to lift; the view scrolls to the first' },
      size: { type: 'number', title: 'Type size', description: '24 px at least on a 1080-high frame, 28 in 9:16; larger by default' },
      seconds: { type: 'number', title: 'Seconds on screen', description: 'from the code\'s length by default' },
    },
    required: ['code'],
  },
  async run(a, ctx) {
    const comp = ctx.doc.compositions[ctx.compId];
    if (!comp) throw new Error('code-screen runs on a composition');
    const portrait = comp.height > comp.width;
    const floor = Math.round((portrait ? 28 / 1920 : 24 / 1080) * comp.height);
    const size = Math.max(floor, Math.round(a.size ?? (portrait ? 30 : 26)));
    const lang = a.lang ?? (isSession(a.code) ? 'sh' : 'js');
    const code = String(a.code ?? '');
    // the window frame: most of the format, its screen holding the code
    const frameW = Math.round(comp.width * 0.84), frameH = Math.round(comp.height * (portrait ? 0.72 : 0.82));
    const barH = Math.round(frameH * 0.07);
    const screenH = frameH - barH, screenW = frameW;
    // the lines that fit, the rest folded: a window around the first highlighted line when one is given
    const fit = maxLines(screenH, size);
    const lines = code.split('\n');
    const hl = (a.lines ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1);
    const first = hl.length ? Math.min(...hl) - 1 : 0;
    let shown = lines, cut = 0, at = 0;
    if (lines.length > fit) {
      at = Math.max(0, Math.min(first - Math.floor(fit / 3), lines.length - fit));
      shown = lines.slice(at, at + fit);
      cut = lines.length - fit;
    }
    // the highlighted lines counted in the window shown, the ones cut away dropped
    const lifted = hl.map((n) => n - at).filter((n) => n >= 1 && n <= shown.length);
    // the fixed version cut to the same window, so the change reads line for line
    const fixed = a.fixed ? (cut ? String(a.fixed).split('\n').slice(at, at + fit).join('\n') : String(a.fixed)) : '';
    const shownCode = shown.join('\n');
    const chars = shownCode.length;
    const seconds = Math.round(Math.max(3, Math.min(14, a.seconds ?? chars / 26 + 2)) * 100) / 100;
    const typeDur = Math.round(seconds * 0.62 * 100) / 100;
    const tokens = ctx.doc.tokens ?? {};
    const colorOf = (name, fallback) => (tokens[name]?.type === 'color' ? `@${name}` : fallback);
    const ink = colorOf('ink', colorOf('text', '#F4F5F7'));
    const accent = colorOf('accent', '#2EC4B6');
    const accent2 = colorOf('accent2', accent);
    const plate = colorOf('plate', colorOf('background', '#0D1117'));
    const font = Object.entries(ctx.doc.assets).find(([, x]) => x.type === 'font' && /mono/i.test(`${x.name} ${x.family ?? ''}`))?.[0] ?? null;
    const r2 = (v) => Math.round(v * 100) / 100;
    const fps = comp.fps ?? 30;
    const dur = r2(seconds + 0.6);
    const cid = `code-${Date.now().toString(36)}`;
    const layers = {}, order = [];
    layers.frame = {
      type: 'ui.device', name: a.title ? `Window ${a.title}` : 'Window', in: 0, out: dur,
      transform: { position: [Math.round(comp.width / 2), Math.round(comp.height / 2)] },
      props: { device: 'window', size: [frameW, frameH], url: a.title ?? '' },
    };
    order.push('frame');
    layers.screen = {
      type: isSession(code) ? 'codeview.terminal' : 'codeview.code', name: a.title || 'Code', in: 0, out: dur,
      transform: { position: [Math.round(comp.width / 2), Math.round(comp.height / 2 + barH / 2)] },
      props: isSession(code)
        ? { script: shownCode, size, panel: [screenW, screenH], ink, accent, accent2, plate, ...(font ? { font } : {}), progress: { $k: [{ t: 0.15, v: 0 }, { t: r2(0.15 + typeDur), v: 1 }] } }
        : {
            code: shownCode, lang, size, panel: [screenW, screenH], ink, accent, accent2, plate, ...(font ? { font } : {}),
            ...(lifted.length ? { highlight: lifted } : {}),
            ...(fixed ? { from: shownCode, code: fixed } : {}),
            progress: { $k: [{ t: 0.15, v: 0 }, { t: r2(0.15 + typeDur), v: 1 }] },
          },
    };
    order.push('screen');
    const ops = [
      { op: 'add', path: `/compositions/${cid}`, value: { name: a.title ? `Code · ${a.title}` : 'Code', width: comp.width, height: comp.height, fps, duration: dur, background: comp.background, layers, order } },
    ];
    const cutNote = cut ? ` showing ${shown.length} of ${lines.length} lines (${cut} left out — highlight the lines that matter, or split the file across scenes)` : '';
    return {
      ops, label: 'Code on screen',
      text: `The code fills a window of ${frameW}×${frameH} at ${size} px (the floor at this format is ${floor} px), ${typeDur} s of typing then held to ${seconds} s${a.fixed ? ', changing into the fixed version' : ''}${lifted.length ? `, lines ${lifted.map((n) => n + at).join(', ')} highlighted` : ''}.${cutNote} The composition "Code" is its own scene: move the window, retime the typing on the layer's progress, edit the code in the inspector.`,
    };
  },
};

// ── the check ────────────────────────────────────────────────
const codeLegibility = {
  name: 'code-legibility', title: 'Code legibility',
  description: 'type under 24 px on a 1080-pixel-high frame (28 px in 9:16), more lines than the panel fits, a line typed faster than it can be read',
  run(ctx) {
    const out = [];
    const portrait = ctx.comp.height > ctx.comp.width;
    const floor = Math.round((portrait ? 28 / 1920 : 24 / 1080) * ctx.comp.height);
    const seen = new Set();
    for (const sample of ctx.samples) {
      for (const placed of sample.layers) {
        const code = placed.node.type === 'codeview.code', term = placed.node.type === 'codeview.terminal';
        if ((!code && !term) || placed.opacity < 0.5 || seen.has(placed.id)) continue;
        seen.add(placed.id);
        const name = placed.layer.name ?? placed.id;
        const size = Number(placed.props.size) || 0;
        if (size && size < floor) out.push({ check: 'code-legibility', severity: 'warning', message: `${name}: the code is ${Math.round(size)} px — under ${floor} px at this format it cannot be read on a phone; set it to ${floor} px or more` });
        const panel = placed.props.panel;
        const text = String(placed.props.code ?? placed.props.script ?? '');
        if (size && Array.isArray(panel) && panel[1] > 0) {
          const fit = maxLines(panel[1], size);
          const lines = text.split('\n').length;
          if (lines > fit) out.push({ check: 'code-legibility', severity: 'warning', message: `${name}: ${lines} lines for the ${fit} the panel fits at ${Math.round(size)} px — cut the file to the lines that matter` });
        }
        const prog = placed.props.progress;
        if (text && prog && typeof prog === 'object' && Array.isArray(prog.$k) && prog.$k.length >= 2) {
          const span = Number(prog.$k[prog.$k.length - 1].t) - Number(prog.$k[0].t);
          if (span > 0.2 && text.length / span > 40) out.push({ check: 'code-legibility', severity: 'warning', message: `${name}: ${Math.round(text.length / span)} characters a second — over about 40 nobody reads what types; hold it longer or show less` });
        }
      }
    }
    return out;
  },
};

export const meta = { id: 'tramme/codeview', name: 'codeview', version: '1.0.0', description: 'Code and a terminal on screen: a lexer\'s colours, typing at a human rhythm, a change between two versions, a session that runs', api: 1 };
export const nodes = [codeNode, terminalNode];
export const tools = [codeScreen];
export const checks = [codeLegibility];
export const messages = {
  fr: {
    "lines \"$ command\", \"...\" (with seconds: \"... 2.5\"), \"[###] 2 label\" for a progress bar and \"> output\" (ANSI colours read)": "lignes « $ commande », « ... » (avec des secondes : « ... 2,5 »), « [###] 2 libellé » pour une barre de progression et « > sortie » (couleurs ANSI lues)",
    "the code, or a session (\"$ npm test\", \"> 3 passed\", \"...\") for a terminal": "le code, ou une session (« $ npm test », « > 3 passed », « ... ») pour un terminal",
    "Fixed version": "Version corrigée",
    "Window title": "Titre de la fenêtre",
    "Seconds on screen": "Secondes à l’écran",
    'Code': 'Code', 'Terminal': 'Terminal', 'Show code on screen': 'Montrer du code à l’écran', 'Code legibility': 'Lisibilité du code',
    'Language': 'Langage', 'Previous version': 'Version précédente', 'Progress': 'Progression', 'Highlight': 'Lignes soulignées',
    'Type size': 'Corps', 'Panel': 'Panneau', 'Code colour': 'Couleur du code', 'Accent': 'Accent', 'Second accent': 'Second accent', 'Font': 'Police',
    'Session': 'Session', 'Text colour': 'Couleur du texte',
    'the code shown, in the language set; multiline': 'le code montré, dans le langage choisi ; multi-ligne',
    'the code it changes from: the tokens both share slide, the rest leaves and arrives, over "progress"': 'le code dont il part : les tokens partagés glissent, les autres partent et arrivent, sur « progress »',
    '1: the whole code shown (or the change done); key it for the typing': '1 : tout le code montré (ou le changement fait) ; keyframez-le pour la frappe',
    'the lines (1-based) to lift; the others dim, the view scrolls to the first': 'les lignes (à partir de 1) à soulever ; les autres s’estompent, la vue rejoint la première',
    'a program on screen in the kit\'s mono typeface, coloured by its tokens, typed or changed from a previous version': 'un programme à l’écran dans la mono de la trousse, coloré par ses tokens, tapé ou changé depuis une version précédente',
    'a session that runs: commands typed at a human rhythm, output arriving in chunks, waits holding, a spinner stepping with time': 'une session qui tourne : commandes tapées à un rythme humain, sortie qui arrive en morceaux, attentes qui tiennent, un spinner qui suit le temps',
    'lines "$ command", "..." (with seconds: "... 2.5") and "> output"': 'lignes « $ commande », « ... » (avec des secondes : « ... 2,5 ») et « > sortie »',
    '1: the session over; key it to run it': '1 : la session finie ; keyframez-la pour la jouer',
    'the code or the session to show ("$ npm run build" lines make a terminal)': 'le code ou la session à montrer (des lignes « $ npm run build » font un terminal)',
    'when given, the code changes into it: the tokens both share slide, the rest leaves and arrives': 's’il est donné, le code change en lui : les tokens partagés glissent, les autres partent et arrivent',
    'js by default': 'js par défaut',
    'the file name, in the bar': 'le nom du fichier, dans la barre',
    'the lines (1-based) to lift; the view scrolls to the first': 'les lignes (à partir de 1) à soulever ; la vue rejoint la première',
    '24 px at least on a 1080-high frame, 28 in 9:16; larger by default': '24 px au moins sur un cadre de 1080 de haut, 28 en 9:16 ; plus grand par défaut',
    'from the code\'s length by default': 'd’après la longueur du code par défaut',
    'code or a terminal session in a window frame, typed at a readable rhythm, the lines that matter highlighted, a long file cut to what fits': 'du code ou une session de terminal dans un cadre de fenêtre, tapé à un rythme lisible, les lignes qui comptent soulevées, un long fichier coupé à ce qui tient',
    'type under 24 px on a 1080-pixel-high frame (28 px in 9:16), more lines than the panel fits, a line typed faster than it can be read': 'du texte sous 24 px sur un cadre de 1080 de haut (28 px en 9:16), plus de lignes que le panneau n’en tient, une ligne tapée plus vite qu’on ne la lit',
  },
};
