// QR codes, written in the pack's own code (ISO/IEC 18004: byte mode,
// versions 1 to 20, the four correction levels, the mask chosen by its
// penalty). The node draws the modules square, rounded or as dots, in ink on
// plate, a picture in the centre at level H, revealed module by module; the
// check says what a phone cannot read. A code is static: it exports to SVG
// and Lottie as it stands.

// ── the finite field GF(2^8), over x^8 + x^4 + x^3 + x^2 + 1 (0x11D) ──
/** the product of two field elements (Russian peasant, reduced by 0x11D) */
function gmul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** the Reed-Solomon divisor of `degree`: the product of (x - 2^i), its leading 1 left out */
function rsDivisor(degree) {
  const out = new Array(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = gmul(out[j], root);
      if (j + 1 < out.length) out[j] ^= out[j + 1];
    }
    root = gmul(root, 0x02);
  }
  return out;
}

/** the error-correction codewords of a block: the remainder of the data by the divisor */
export function rsRemainder(data, degree) {
  const div = rsDivisor(degree);
  const out = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ out.shift();
    out.push(0);
    for (let i = 0; i < degree; i++) out[i] ^= gmul(div[i], factor);
  }
  return out;
}

// ── the versions' tables, 1 to 20 (index 0 unused) ──────────
const LEVELS = ['L', 'M', 'Q', 'H'];
/** error-correction codewords per block */
const ECC_PER_BLOCK = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28],
};
/** the number of blocks the codewords are split into */
const BLOCKS = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25],
};
/** the format bits of a level */
const FORMAT = { L: 1, M: 0, Q: 3, H: 2 };
export const MAX_VERSION = 20;

export const sizeOf = (version) => 17 + 4 * version;

/** the modules a version leaves for the codewords: the whole square less its function patterns */
function rawModules(version) {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

/** the data codewords of a version at a level */
export function dataCodewords(version, level) {
  return Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[level][version] * BLOCKS[level][version];
}

/** how many bytes a version holds at a level, in byte mode */
export function byteCapacity(version, level) {
  return Math.floor((dataCodewords(version, level) * 8 - 4 - (version < 10 ? 8 : 16)) / 8);
}

/** the centres of a version's alignment patterns, on each axis */
export function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const out = [6];
  for (let pos = sizeOf(version) - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** the 15 format bits of a level and a mask: BCH(15, 5), masked by 0x5412 */
export function formatBits(level, mask) {
  const data = (FORMAT[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** the 18 version bits (versions 7 and up): BCH(18, 6) */
export function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// ── the masks ────────────────────────────────────────────────
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/**
 * A matrix's penalty (ISO/IEC 18004, 8.8.2), the lower the better: runs of
 * five or more of a colour in a row or a column (3, plus 1 per extra),
 * 2×2 blocks of a colour (3 each), finder-like 1:1:3:1:1 patterns with four
 * light modules on a side (40 each, the edge counting as light), and the
 * dark share away from half (10 per 5 %). `m[y][x]`, true = dark.
 */
export function penalty(m) {
  const n = m.length;
  let score = 0;
  const at = (y, x) => (y >= 0 && y < n && x >= 0 && x < n ? m[y][x] : false);
  for (let pass = 0; pass < 2; pass++) {
    const get = pass === 0 ? (a, b) => at(a, b) : (a, b) => at(b, a);
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b < n; b++) {
        if (get(a, b) === get(a, b - 1)) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
        else run = 1;
      }
      // the finder-like patterns, with four light modules before or after
      for (let b = -4; b < n; b++) {
        if (!(get(a, b) && !get(a, b + 1) && get(a, b + 2) && get(a, b + 3) && get(a, b + 4) && !get(a, b + 5) && get(a, b + 6))) continue;
        const before = !get(a, b - 1) && !get(a, b - 2) && !get(a, b - 3) && !get(a, b - 4);
        const after = !get(a, b + 7) && !get(a, b + 8) && !get(a, b + 9) && !get(a, b + 10);
        // a pattern counted, the search goes on past it (one sharing its last module is not counted again)
        if (before || after) { score += 40; b += 6; }
      }
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
  }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const total = n * n;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

// ── the encoder ──────────────────────────────────────────────
/** the codewords of the text in byte mode, padded to the version's capacity */
function dataOf(bytes, version, level) {
  const bits = [];
  const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const cap = dataCodewords(version, level) * 8;
  push(0, Math.min(4, cap - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** the data split into blocks, each with its error correction, interleaved as the symbol reads them */
export function interleaved(data, version, level) {
  const blocks = BLOCKS[level][version], ecc = ECC_PER_BLOCK[level][version];
  const raw = Math.floor(rawModules(version) / 8);
  const short = blocks - (raw % blocks), shortLen = Math.floor(raw / blocks);
  const list = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - ecc + (i < short ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const block = dat.concat(i < short ? [0] : [], rsRemainder(dat, ecc));
    list.push({ block, short: i < short });
  }
  const out = [];
  for (let i = 0; i < list[0].block.length; i++) {
    list.forEach(({ block, short: s }) => { if (i !== shortLen - ecc || !s) out.push(block[i]); });
  }
  return out;
}

/**
 * The text as a QR matrix, `m[y][x]` (true = dark), with its version, level
 * and mask: byte mode (UTF-8), the smallest version from 1 to 20 that holds
 * it at the level given (L, M, Q, H), the mask of least penalty unless one is
 * asked. Throws, saying so, when the text does not fit in version 20.
 */
export function encodeQr(text, level = 'M', mask = -1) {
  const lv = LEVELS.includes(level) ? level : 'M';
  const bytes = [...new TextEncoder().encode(String(text ?? ''))];
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) if (bytes.length <= byteCapacity(v, lv)) { version = v; break; }
  if (!version) throw new Error(`the text is too long for a QR code: ${bytes.length} bytes, ${byteCapacity(MAX_VERSION, lv)} at most at level ${lv} — shorten it, or put a short link in it`);
  const { modules, fn, drawFormat, late } = functionPatterns(version);
  const n = sizeOf(version);
  // the codewords, up and down the columns two at a time, from the bottom right
  const cw = interleaved(dataOf(bytes, version, lv), version, lv);
  let k = 0;
  for (const [x, y] of dataOrder(fn)) if (k < cw.length * 8) { modules[y][x] = ((cw[k >>> 3] >>> (7 - (k & 7))) & 1) === 1; k++; }
  // the mask: each one tried, the least penalty kept (or the one asked)
  let chosen = mask, best = null, bestScore = Infinity;
  for (let msk = 0; msk < 8; msk++) {
    if (mask >= 0 && msk !== mask) continue;
    const m = modules.map((row) => row.slice());
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && MASKS[msk](x, y)) m[y][x] = !m[y][x];
    // judged before the format bits are written (ISO/IEC 18004:2015, 7.8), then written
    const score = penalty(m.map((row, y) => row.map((v, x) => v && !late.has(y * n + x))));
    drawFormat(m, formatBits(lv, msk));
    if (score < bestScore) { bestScore = score; best = m; chosen = msk; }
  }
  return { matrix: best, version, level: lv, mask: chosen, size: n, penalty: bestScore };
}

/** the modules the data walks through, in order: up and down the columns two at a time from the bottom right, the timing column skipped */
export function dataOrder(fn) {
  const n = fn.length, out = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? n - 1 - vert : vert;
        if (!fn[y][x]) out.push([x, y]);
      }
    }
  }
  return out;
}

/**
 * A version's function patterns: the finders and their separators, the
 * timing lines, the alignment patterns, the version bits (7 and up), the
 * format area reserved. `modules[y][x]` and `fn[y][x]` (true where a pattern
 * is), and `drawFormat(matrix, bits)` writing the format bits into a matrix.
 */
export function functionPatterns(version) {
  const n = sizeOf(version);
  const modules = Array.from({ length: n }, () => new Array(n).fill(false));
  const fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (x, y, dark) => { if (x >= 0 && x < n && y >= 0 && y < n) { modules[y][x] = dark; fn[y][x] = true; } };
  // the timing patterns, then the finders with their separators over them
  for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx + dx, cy + dy, d !== 2 && d !== 4);
    }
  }
  // the alignment patterns, the three corners of the finders left out
  const al = alignmentPositions(version);
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // the format bits, around the finders: `set` reserves them here, `drawFormat` writes them into a masked matrix
  const formatAt = (put, bits) => {
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) put(8, i, bit(i));
    put(8, 7, bit(6)); put(8, 8, bit(7)); put(7, 8, bit(8));
    for (let i = 9; i < 15; i++) put(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) put(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) put(8, n - 15 + i, bit(i));
    put(8, n - 8, true); // the dark module, always
  };
  // the format and version areas are written last: the masks are judged without them
  const late = new Set();
  formatAt((x, y) => { set(x, y, false); late.add(y * n + x); }, 0);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1, a = n - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, dark); set(b, a, dark);
      late.add(b * n + a); late.add(a * n + b);
    }
  }
  return { modules, fn, late, drawFormat: (m, bits) => formatAt((x, y, dark) => { m[y][x] = dark; }, bits) };
}

// ── the node ─────────────────────────────────────────────────
const hexRgb = (c) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lum = (rgb) => {
  const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
/** the contrast of ink on plate (WCAG), and whether the code is inverted (light modules on dark): null when a colour is not hex */
export function inkOnPlate(ink, plate) {
  const a = hexRgb(ink), b = hexRgb(plate);
  if (!a || !b) return null;
  const la = lum(a), lb = lum(b);
  return { contrast: (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05), inverted: la > lb };
}

/** the code a node draws, memoised: encoding is the same every frame */
const cache = new Map();
function codeOf(p) {
  const level = p.picture ? 'H' : p.level;
  const key = `${level}\u0000${p.text}`;
  if (!cache.has(key)) {
    if (cache.size > 16) cache.clear();
    let code = null;
    try { code = encodeQr(p.text, level); } catch { code = null; }
    cache.set(key, code);
  }
  return cache.get(key);
}

/** the modules a centred picture covers: a square of about a fifth of the side, never over the finders */
export function pictureHole(size) {
  const side = Math.max(3, Math.round(size * 0.22) | 1);
  const from = Math.floor((size - side) / 2);
  return { from, to: from + side };
}

/** each dark module's moment in the reveal: a sweep from the top left, a seeded scatter, or all at once */
function rankOf(reveal, x, y, n) {
  if (reveal === 'scan') return (x + y) / (2 * n - 2);
  if (reveal === 'random') return ((Math.imul((x * 73856093) ^ (y * 19349663), 2654435761) >>> 0) % 1000) / 1000;
  return 0;
}

/** the dark modules shown at a progress, in module coordinates, the picture's hole left empty */
function shownModules(p, code) {
  const n = code.size, hole = p.picture ? pictureHole(n) : null;
  const u = Math.min(1, Math.max(0, p.progress ?? 1));
  const out = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!code.matrix[y][x]) continue;
    if (hole && x >= hole.from && x < hole.to && y >= hole.from && y < hole.to) continue;
    if (u < 1 && rankOf(p.reveal, x, y, n) >= u) continue;
    out.push([x, y]);
  }
  return out;
}

const qrNode = {
  type: 'qr.code', title: 'QR code', category: 'Print',
  description: 'the QR of a link or a text, square, rounded or dotted modules in ink on plate, a picture in the centre at level H, revealed module by module',
  ai: { when: 'an end card the viewer scans: one code with a short link, still for at least three seconds, at a size a phone reads (modules of 5 px at least); a logo in its middle (picture) raises it to level H', avoid: 'light modules on a dark plate (many phones fail), ink and plate under 4:1, a quiet zone under four modules, a long text (a short link reads faster), a code moving or on screen under 3 s, more than one code on screen' },
  props: {
    text: { type: 'string', default: 'https://example.com', label: 'Text', animatable: false, description: 'the link or text the code holds (a short link scans faster)' },
    level: { type: 'enum', default: 'M', options: ['L', 'M', 'Q', 'H'], label: 'Correction', animatable: false, description: 'L 7 %, M 15 %, Q 25 %, H 30 %: H is used whenever a picture sits in the middle' },
    style: { type: 'enum', default: 'square', options: ['square', 'rounded', 'dots'], label: 'Style', animatable: false },
    size: { type: 'number', default: 520, min: 40, unit: 'px', label: 'Size', description: 'the whole code, its quiet zone included' },
    quiet: { type: 'integer', default: 4, min: 0, max: 10, label: 'Quiet zone', animatable: false, description: 'the light modules around the code: four or more for a phone to find it' },
    picture: { type: 'asset', assetType: 'image', default: null, nullable: true, label: 'Picture', animatable: false, description: 'a logo in the centre, on a plate of its own; the code goes to level H to stand it' },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: '1: the whole code; key it to reveal the modules' },
    reveal: { type: 'enum', default: 'scan', options: ['scan', 'random', 'none'], label: 'Reveal', animatable: false, description: 'how the modules appear with the progress: a sweep, a seeded scatter, or all at once' },
    ink: { type: 'paint', default: '#111111', label: 'Ink' },
    plate: { type: 'paint', default: '#FFFFFF', label: 'Plate' },
  },
  bounds: (p) => ({ x: -p.size / 2, y: -p.size / 2, w: p.size, h: p.size }),
  render: {
    canvas2d(ctx, p, host) {
      const code = codeOf(p);
      if (!code) return;
      const n = code.size, quiet = Math.max(0, Math.round(p.quiet ?? 4));
      const cell = p.size / (n + 2 * quiet), o = -p.size / 2 + quiet * cell;
      ctx.fillStyle = p.plate;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.fillStyle = p.ink;
      for (const [x, y] of shownModules(p, code)) {
        const px = o + x * cell, py = o + y * cell;
        if (p.style === 'dots') { ctx.beginPath(); ctx.arc(px + cell / 2, py + cell / 2, cell * 0.44, 0, Math.PI * 2); ctx.fill(); }
        else if (p.style === 'rounded') { ctx.beginPath(); ctx.roundRect(px + cell * 0.06, py + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.3); ctx.fill(); }
        else ctx.fillRect(px, py, cell + 0.35, cell + 0.35); // a hair of overlap: no seam between modules
      }
      if (p.picture) {
        const hole = pictureHole(n), side = (hole.to - hole.from) * cell, at = o + hole.from * cell;
        ctx.fillStyle = p.plate;
        ctx.beginPath(); ctx.roundRect(at, at, side, side, cell * 0.8); ctx.fill();
        let img = null;
        try { img = host.asset(p.picture); } catch { img = null; }
        if (img) {
          // the picture fitted inside its plate, its proportions kept
          const iw = img.naturalWidth || img.width || 1, ih = img.naturalHeight || img.height || 1, pad = cell * 0.6;
          const k = (side - 2 * pad) / Math.max(iw, ih), w = iw * k, h = ih * k;
          ctx.drawImage(img, at + (side - w) / 2, at + (side - h) / 2, w, h);
        }
      }
    },
  },
  export: {
    svg(p) {
      const code = codeOf(p);
      if (!code) return '';
      const n = code.size, quiet = Math.max(0, Math.round(p.quiet ?? 4));
      const cell = p.size / (n + 2 * quiet), o = -p.size / 2 + quiet * cell;
      const ink = typeof p.ink === 'string' ? p.ink : '#111111', plate = typeof p.plate === 'string' ? p.plate : '#FFFFFF';
      const r = (v) => Math.round(v * 100) / 100;
      const mods = shownModules({ ...p, progress: 1 }, code);
      const body = p.style === 'dots'
        ? mods.map(([x, y]) => `<circle cx="${r(o + (x + 0.5) * cell)}" cy="${r(o + (y + 0.5) * cell)}" r="${r(cell * 0.44)}"/>`).join('')
        : p.style === 'rounded'
          ? mods.map(([x, y]) => `<rect x="${r(o + (x + 0.06) * cell)}" y="${r(o + (y + 0.06) * cell)}" width="${r(cell * 0.88)}" height="${r(cell * 0.88)}" rx="${r(cell * 0.3)}"/>`).join('')
          : `<path d="${mods.map(([x, y]) => `M${r(o + x * cell)},${r(o + y * cell)}h${r(cell)}v${r(cell)}h${r(-cell)}z`).join('')}"/>`;
      return `<rect x="${r(-p.size / 2)}" y="${r(-p.size / 2)}" width="${r(p.size)}" height="${r(p.size)}" fill="${plate}"/><g fill="${ink}">${body}</g>`;
    },
    lottie(p) {
      const code = codeOf(p);
      if (!code) return [];
      const n = code.size, quiet = Math.max(0, Math.round(p.quiet ?? 4));
      const cell = p.size / (n + 2 * quiet), o = -p.size / 2 + quiet * cell;
      const colour = (c, fallback) => [...(hexRgb(c) ?? fallback), 1];
      const st = (k) => ({ a: 0, k });
      const tr = { ty: 'tr', p: st([0, 0]), a: st([0, 0]), s: st([100, 100]), r: st(0), o: st(100) };
      const mods = shownModules({ ...p, progress: 1 }, code);
      // square modules merged into runs along each row: far fewer shapes for the player
      const shapes = [];
      if (p.style === 'square') {
        const set = new Set(mods.map(([x, y]) => `${x},${y}`));
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          if (!set.has(`${x},${y}`) || set.has(`${x - 1},${y}`)) continue;
          let len = 1;
          while (set.has(`${x + len},${y}`)) len++;
          shapes.push({ ty: 'rc', p: st([o + (x + len / 2) * cell, o + (y + 0.5) * cell]), s: st([len * cell + 0.35, cell + 0.35]), r: st(0) });
        }
      } else {
        for (const [x, y] of mods) {
          const c = [o + (x + 0.5) * cell, o + (y + 0.5) * cell];
          shapes.push(p.style === 'dots' ? { ty: 'el', p: st(c), s: st([cell * 0.88, cell * 0.88]) } : { ty: 'rc', p: st(c), s: st([cell * 0.88, cell * 0.88]), r: st(cell * 0.3) });
        }
      }
      return [
        { ty: 'gr', nm: 'Modules', it: [...shapes, { ty: 'fl', c: st(colour(p.ink, [0.07, 0.07, 0.07])), o: st(100), r: 1 }, tr] },
        { ty: 'gr', nm: 'Plate', it: [{ ty: 'rc', p: st([0, 0]), s: st([p.size, p.size]), r: st(0) }, { ty: 'fl', c: st(colour(p.plate, [1, 1, 1])), o: st(100), r: 1 }, tr] },
      ];
    },
  },
};

// ── the check ────────────────────────────────────────────────
const qrScannable = {
  name: 'qr-scannable', title: 'QR scannable',
  description: 'modules under 5 px at the export\'s size, a quiet zone under four modules, ink and plate under 4:1 or inverted, a code on screen under 3 s',
  run(ctx) {
    const out = [];
    const seen = new Set();
    for (const sample of ctx.samples) {
      for (const placed of sample.layers) {
        if (placed.node.type !== 'qr.code' || placed.opacity < 0.5 || seen.has(placed.id)) continue;
        seen.add(placed.id);
        const p = placed.props, name = placed.layer.name ?? placed.id;
        const warn = (message) => out.push({ check: 'qr-scannable', severity: 'warning', t: sample.t, layers: [placed.id], message: `${name}: ${message}` });
        const code = codeOf(p);
        if (!code) { warn('its text does not fit in a QR code — shorten it, or put a short link in it'); continue; }
        const quiet = Math.max(0, Math.round(p.quiet ?? 4));
        // the module's size on screen: the code's box as placed in the frame
        const side = placed.box ? Math.min(placed.box.w, placed.box.h) : p.size;
        const px = side / (code.size + 2 * quiet);
        if (px < 5) warn(`its modules are ${px.toFixed(1)} px — under 5 a phone cannot read them; make the code bigger (${Math.ceil((5 * (code.size + 2 * quiet)) / Math.max(1e-6, side / p.size))} px) or the text shorter`);
        if (quiet < 4) warn(`a quiet zone of ${quiet} module${quiet === 1 ? '' : 's'} — a phone needs four light modules around the code to find it`);
        const c = inkOnPlate(p.ink, p.plate);
        if (c?.inverted) warn('light modules on a dark plate — many phones only read a dark code on a light plate; swap the ink and the plate');
        else if (c && c.contrast < 4) warn(`ink and plate at ${c.contrast.toFixed(1)}:1 — under 4:1 a phone loses the modules in poor light`);
        const l = placed.layer, span = (l.out ?? ctx.comp.duration) - (l.in ?? 0);
        if (span > 0 && span < 3) warn(`on screen ${span.toFixed(1)} s — a viewer needs at least 3 s to raise a phone and scan it`);
      }
    }
    return out;
  },
};

export const meta = { id: 'tramme/qr', name: 'qr', version: '1.0.0', description: 'QR codes written in the pack\'s own code: versions 1 to 20, four levels, the mask by its penalty, square, rounded or dotted modules, a logo in the middle', api: 1 };
export const nodes = [qrNode];
export const checks = [qrScannable];
export const messages = {
  fr: {
    'QR code': 'Code QR', 'QR scannable': 'QR lisible',
    'Text': 'Texte', 'Correction': 'Correction', 'Style': 'Style', 'Size': 'Taille', 'Quiet zone': 'Marge de silence', 'Picture': 'Image', 'Progress': 'Progression', 'Reveal': 'Apparition', 'Ink': 'Encre', 'Plate': 'Fond',
    'the link or text the code holds (a short link scans faster)': 'le lien ou le texte que le code porte (un lien court se lit plus vite)',
    'L 7 %, M 15 %, Q 25 %, H 30 %: H is used whenever a picture sits in the middle': 'L 7 %, M 15 %, Q 25 %, H 30 % : H dès qu’une image se pose au milieu',
    'the whole code, its quiet zone included': 'le code entier, sa marge de silence comprise',
    'the light modules around the code: four or more for a phone to find it': 'les modules clairs autour du code : quatre ou plus pour qu’un téléphone le trouve',
    'a logo in the centre, on a plate of its own; the code goes to level H to stand it': 'un logo au centre, sur un fond à lui ; le code passe au niveau H pour le porter',
    '1: the whole code; key it to reveal the modules': '1 : le code entier ; keyframez-le pour révéler les modules',
    'how the modules appear with the progress: a sweep, a seeded scatter, or all at once': 'comment les modules apparaissent avec la progression : un balayage, une dispersion semée, ou tout d’un coup',
    'the QR of a link or a text, square, rounded or dotted modules in ink on plate, a picture in the centre at level H, revealed module by module': 'le QR d’un lien ou d’un texte, modules carrés, arrondis ou en points, encre sur fond, une image au centre au niveau H, révélé module par module',
    'modules under 5 px at the export\'s size, a quiet zone under four modules, ink and plate under 4:1 or inverted, a code on screen under 3 s': 'des modules sous 5 px à la taille de l’export, une marge de silence sous quatre modules, encre et fond sous 4:1 ou inversés, un code à l’écran moins de 3 s',
  },
};
