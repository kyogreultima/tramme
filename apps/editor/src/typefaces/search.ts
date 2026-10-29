// Search of the typeface catalogue by character ("condensed grotesque, heavy,
// for titles") and by the script of the text to set. Pure functions over the
// catalogue: nothing here reads the network or the document.

import { TAGS, type Catalogue, type Typeface } from './catalogue.ts';
import { slugOf } from './files.ts';

// ── the script of a text ─────────────────────────────────────
type Range = [number, number];
const SCRIPT_RANGES: [string, Range[]][] = [
  ['latin-ext', [[0x100, 0x24f], [0x1e00, 0x1e9f], [0x1ef0, 0x1eff], [0x2c60, 0x2c7f], [0xa720, 0xa7ff]]],
  ['vietnamese', [[0x1ea0, 0x1eef]]],
  ['cyrillic', [[0x400, 0x4ff]]],
  ['cyrillic-ext', [[0x500, 0x52f], [0x2de0, 0x2dff], [0xa640, 0xa69f]]],
  ['greek', [[0x370, 0x3ff]]],
  ['greek-ext', [[0x1f00, 0x1fff]]],
  ['armenian', [[0x530, 0x58f]]],
  ['hebrew', [[0x590, 0x5ff]]],
  ['arabic', [[0x600, 0x6ff], [0x750, 0x77f], [0xfb50, 0xfdff], [0xfe70, 0xfeff]]],
  ['devanagari', [[0x900, 0x97f]]],
  ['bengali', [[0x980, 0x9ff]]],
  ['gurmukhi', [[0xa00, 0xa7f]]],
  ['gujarati', [[0xa80, 0xaff]]],
  ['tamil', [[0xb80, 0xbff]]],
  ['telugu', [[0xc00, 0xc7f]]],
  ['kannada', [[0xc80, 0xcff]]],
  ['malayalam', [[0xd00, 0xd7f]]],
  ['sinhala', [[0xd80, 0xdff]]],
  ['thai', [[0xe00, 0xe7f]]],
  ['lao', [[0xe80, 0xeff]]],
  ['tibetan', [[0xf00, 0xfff]]],
  ['myanmar', [[0x1000, 0x109f]]],
  ['georgian', [[0x10a0, 0x10ff]]],
  ['ethiopic', [[0x1200, 0x137f]]],
  ['cherokee', [[0x13a0, 0x13ff]]],
  ['khmer', [[0x1780, 0x17ff]]],
];
const KANA: Range[] = [[0x3040, 0x30ff], [0xff66, 0xff9f]];
const HANGUL: Range[] = [[0x1100, 0x11ff], [0x3130, 0x318f], [0xac00, 0xd7af]];
const HAN: Range[] = [[0x3400, 0x4dbf], [0x4e00, 0x9fff]];
const within = (c: number, ranges: Range[]) => ranges.some(([lo, hi]) => c >= lo && c <= hi);

/** the Fontsource subsets a text needs, in the order they first appear: latin for Latin letters and digits, then each other script */
export function scriptsOf(text: string): string[] {
  const out = new Set<string>();
  let kana = false, hangul = false, han = false, digits = false;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0xff && c !== 0xd7 && c !== 0xf7)) { out.add('latin'); continue; }
    if (c >= 0x30 && c <= 0x39) { digits = true; continue; }
    if (within(c, KANA)) { kana = true; continue; }
    if (within(c, HANGUL)) { hangul = true; continue; }
    if (within(c, HAN)) { han = true; continue; }
    const found = SCRIPT_RANGES.find(([, ranges]) => within(c, ranges));
    if (found) {
      out.add(found[0]);
      // letters beyond Latin-1 come with the Latin letters around them
      if (found[0] === 'latin-ext' || found[0] === 'vietnamese') out.add('latin');
    }
  }
  if (kana) out.add('japanese');
  else if (hangul) out.add('korean');
  else if (han) out.add('chinese-simplified');
  if (digits && !out.size) out.add('latin');
  return [...out];
}

// ── the words of a query ─────────────────────────────────────
type Role = NonNullable<Typeface['for']>[number];
interface Meaning { tags?: string[]; category?: Typeface['category']; role?: Role; script?: string }

const WORDS: Record<string, Meaning> = {};
const word = (list: string[], meaning: Meaning) => { for (const w of list) WORDS[w] = meaning; };
for (const tag of TAGS) WORDS[tag] = { tags: [tag] };
word(['thick', 'black', 'fat', 'ultra', 'chunky'], { tags: ['heavy'] });
word(['thin', 'hairline', 'delicate'], { tags: ['light'] });
word(['narrow', 'compressed', 'tall'], { tags: ['condensed'] });
word(['extended', 'expanded'], { tags: ['wide'] });
word(['monospaced', 'monospace', 'code', 'coding', 'terminal', 'typewriter'], { tags: ['mono'] });
word(['script', 'cursive', 'handwriting', 'marker', 'brush', 'calligraphy', 'signature', 'note', 'sketch', 'diary', 'scribble', 'pen'], { tags: ['handwritten'] });
word(['round', 'soft', 'bubbly'], { tags: ['rounded'] });
word(['grotesk', 'grot', 'gothic'], { tags: ['grotesque'] });
word(['clean', 'minimal', 'plain', 'simple', 'modern'], { tags: ['neutral'] });
word(['luxury', 'luxurious', 'refined', 'classy', 'fashion', 'chic', 'sophisticated', 'classic'], { tags: ['elegant'] });
word(['fun', 'whimsical', 'quirk', 'cartoon', 'comic'], { tags: ['playful'] });
word(['tech', 'technical', 'futuristic', 'futurist', 'scifi', 'cyber', 'digital'], { tags: ['techno'] });
word(['magazine', 'newspaper', 'literary', 'journal', 'book'], { tags: ['editorial'] });
word(['warm', 'kind', 'approachable', 'casual'], { tags: ['friendly'] });
word(['strong', 'impact', 'punchy', 'sport', 'sporty', 'loud', 'powerful'], { tags: ['bold'] });
word(['retro', 'vintage', 'poster', 'decorative'], { tags: ['display'] });
word(['sans', 'sansserif'], { category: 'sans-serif' });
word(['title', 'headline', 'heading', 'header', 'hero'], { role: 'title' });
word(['body', 'paragraph', 'reading', 'article', 'text', 'copy'], { role: 'text' });
word(['ui', 'interface', 'app', 'button', 'label', 'caption'], { role: 'ui' });
word(['quote', 'quotation', 'pullquote', 'citation'], { role: 'quote' });
word(['number', 'figure', 'digit', 'stat', 'counter', 'price'], { role: 'number' });
for (const s of ['arabic', 'hebrew', 'cyrillic', 'greek', 'devanagari', 'thai', 'japanese', 'korean', 'armenian', 'georgian', 'bengali', 'tamil', 'telugu', 'khmer', 'vietnamese']) WORDS[s] = { script: s };
word(['russian', 'ukrainian', 'bulgarian'], { script: 'cyrillic' });
word(['hindi'], { script: 'devanagari' });
word(['chinese', 'mandarin'], { script: 'chinese-simplified' });
word(['kanji', 'kana'], { script: 'japanese' });
WORDS['serifed'] = { tags: ['serif'] };

/** words that say nothing about the character */
const FILLER = new Set(['a', 'an', 'the', 'for', 'of', 'with', 'and', 'or', 'in', 'to', 'on', 'my', 'some', 'that', 'is', 'it', 'its', 'look', 'looks', 'looking', 'like', 'font', 'typeface', 'type', 'family', 'face', 'letter', 'lettering', 'very', 'quite', 'more', 'but', 'not', 'no', 'good', 'nice', 'great', 'best', 'film', 'video', 'project', 'we', 'i', 'need', 'want', 'use', 'used', 'from', 'by', 'as', 'at', 'be', 'this', 'something', 'one']);

/** structural tags: what the face is made of, not how it feels; a query that asks for one gets only faces that have it */
const STRUCTURAL = new Set(['condensed', 'wide', 'serif', 'slab', 'mono', 'rounded', 'handwritten']);

function meaningOf(raw: string): Meaning | undefined {
  if (WORDS[raw]) return WORDS[raw];
  // plurals: titles, grotesques, families
  if (raw.endsWith('ies') && WORDS[raw.slice(0, -3) + 'y']) return WORDS[raw.slice(0, -3) + 'y'];
  if (raw.endsWith('s') && !raw.endsWith('ss') && WORDS[raw.slice(0, -1)]) return WORDS[raw.slice(0, -1)];
  if (raw.endsWith('es') && WORDS[raw.slice(0, -2)]) return WORDS[raw.slice(0, -2)];
  return undefined;
}

interface Parsed { tags: Set<string>; categories: Set<string>; roles: Set<string>; scripts: Set<string>; names: string[]; unknown: string[] }

function parse(query: string, catalogue: Catalogue): Parsed {
  const p: Parsed = { tags: new Set(), categories: new Set(), roles: new Set(), scripts: new Set(), names: [], unknown: [] };
  const words = query.toLowerCase().split(/[^a-z0-9À-ɏ]+/).filter(Boolean);
  for (const w of words) {
    if (FILLER.has(w)) continue;
    const m = meaningOf(w);
    if (m) {
      for (const t of m.tags ?? []) p.tags.add(t);
      if (m.category) p.categories.add(m.category);
      if (m.role) p.roles.add(m.role);
      if (m.script) p.scripts.add(m.script);
      // a word that is also a family's own word still names it ("display", "mono")
      continue;
    }
    // not a word of the vocabulary: the name of a family, or unknown
    if (w.length >= 3 && catalogue.fonts.some((f) => nameWords(f).includes(w))) p.names.push(w);
    else p.unknown.push(w);
  }
  return p;
}

const nameWords = (f: Typeface) => f.family.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** a family with a hand-written entry in the overlay */
const described = (f: Typeface) => !!(f.for || f.pairs || f.note);

interface Scored { font: Typeface; score: number; why: string[] }

/** a face that is only condensed or wide by a width axis (it can be, it is not) counts for half */
const native = (f: Typeface, tag: string) => (tag !== 'condensed' && tag !== 'wide') || !f.axes?.wdth || new RegExp(tag === 'condensed' ? 'condensed|narrow|compressed' : 'extended|expanded|wide', 'i').test(f.family);

function score(f: Typeface, p: Parsed): Scored {
  const why: string[] = [];
  let s = 0;
  for (const t of p.tags) if (f.tags.includes(t)) { s += native(f, t) ? 1 : 0.5; why.push(t); }
  for (const r of p.roles) if (f.for?.includes(r as Role)) { s += 1; why.push(r === 'text' || r === 'title' ? r : `for ${r}`); }
  for (const c of p.categories) if (f.category === c) { s += 1; why.push(c); }
  const own = nameWords(f);
  for (const n of p.names) if (own.includes(n)) { s += 2; why.push(`named ${n}`); }
  if (s > 0 && described(f)) s += 1;
  return { font: f, score: s, why };
}

/** by score, then the family with more weights to choose from, then by name */
const byRank = (a: Scored, b: Scored) => b.score - a.score || b.font.weights.length - a.font.weights.length || (a.font.family < b.font.family ? -1 : 1);

export interface Search { found: Scored[]; unknown: string[]; closest: boolean }

/**
 * the families that fit a character, best first: a font scores one per matched
 * tag, role or category, two more when its name holds a word of the query, one
 * more when it was described by hand; it must cover the script of `opts.text`
 * (and of any script named in the query). A query that matches nothing is
 * answered with the closest families, said so by `closest`.
 */
export function searchTypefaces(catalogue: Catalogue, query: string, opts: { text?: string; category?: Typeface['category']; count?: number } = {}): Search {
  const p = parse(query, catalogue);
  const count = Math.max(1, Math.min(opts.count ?? 6, 6));
  const need = [...new Set([...(opts.text ? scriptsOf(opts.text) : []), ...p.scripts])];
  const covering = catalogue.fonts.filter((f) => (!opts.category || f.category === opts.category) && need.every((s) => f.subsets.includes(s)));
  const result = (found: Scored[], closest: boolean): Search => ({ found: found.slice(0, count), unknown: p.unknown, closest });
  if (!covering.length) return result([], false);

  const hard = [...p.tags].filter((t) => STRUCTURAL.has(t));
  const ranked = covering.map((f) => score(f, p)).filter((x) => x.score > 0).sort(byRank);
  const exact = ranked.filter((x) => hard.every((t) => x.font.tags.includes(t)));
  if (exact.length) return result(exact, false);
  // what was asked is not all there: the nearest by what matches, then by name, then the described families of the commonest kind
  if (ranked.length) return result(ranked, true);
  const nearName = covering.filter((f) => p.unknown.some((w) => w.length >= 3 && f.family.toLowerCase().includes(w))).map((f) => ({ font: f, score: 1, why: ['name'] }));
  if (nearName.length) return result(nearName.sort(byRank), true);
  const kinds = new Map<string, number>();
  for (const f of covering) if (described(f)) kinds.set(f.category, (kinds.get(f.category) ?? 0) + 1);
  const kind = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const fallback = covering.filter((f) => described(f) && (!kind || f.category === kind)).sort((a, b) => b.weights.length - a.weights.length || (a.family < b.family ? -1 : 1));
  return result((fallback.length ? fallback : covering).map((font) => ({ font, score: 0, why: [] })), true);
}

/** the number of single-letter edits between two short words */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** the family a name points to (its id or its name, whatever the case or the spacing), else the three ids nearest to the name */
export function findFamily(catalogue: Catalogue, name: string): { font?: Typeface; closest: string[] } {
  const key = slugOf(name);
  const font = catalogue.fonts.find((f) => f.id === key || slugOf(f.family) === key);
  if (font) return { font, closest: [] };
  const near = (f: Typeface) => distance(key, f.id) - (f.id.includes(key) || key.includes(f.id) ? key.length : 0);
  return { closest: [...catalogue.fonts].sort((a, b) => near(a) - near(b) || (a.id < b.id ? -1 : 1)).slice(0, 3).map((f) => f.id) };
}
