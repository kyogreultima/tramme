// A user's own films kept as references: the reasons they work, in words, and
// the facts read from the document (palette, typefaces, kinds of picture, format).
// The library watches them for convergence: when the films kept start to share
// one look, the assistant is told and takes the next film elsewhere.

import { deltaE, toLab, type TrammeDoc } from '@tramme/core';
import type { FilmPlan } from '../filmplan.ts';

export interface OwnReference {
  /** how the library file says what it is */
  kind?: 'tramme-reference';
  id: string;
  /** the project it was kept from: keeping it again replaces it */
  project: string;
  kept: string;
  title: string;
  /** why it works, in words: the entry */
  why: string;
  tags: string[];
  facts: { palette: string[]; fonts: string[]; kinds: string[]; format: string };
}

const ratio = (w: number, h: number) => {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a), d = g(w, h) || 1;
  return `${w / d}:${h / d}`;
};

/** what a film is made of, read from its document and its plan: only what is there, never guessed */
export function factsOf(doc: TrammeDoc, plan: FilmPlan | null): OwnReference['facts'] {
  const root = doc.compositions[doc.root];
  const palette = Object.values(doc.tokens ?? {}).filter((t) => t.type === 'color' && typeof t.value === 'string').map((t) => String(t.value));
  const fonts = [...new Set(Object.values(doc.assets ?? {}).filter((a) => a.type === 'font').map((a) => a.family ?? a.name ?? '').filter(Boolean))];
  return { palette, fonts, kinds: (plan?.scenes ?? []).map((s) => s.kind), format: root ? ratio(root.width, root.height) : '' };
}

const rgbOf = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

const jaccard = (a: string[], b: string[]) => {
  const x = new Set(a), y = new Set(b), both = [...x].filter((v) => y.has(v)).length;
  return x.size + y.size === 0 ? 1 : both / (x.size + y.size - both);
};

/** how near two palettes are, 1 for the same colours: the mean Lab distance of each colour to the nearest of the other, both ways */
function paletteNear(a: string[], b: string[]): number | undefined {
  const pa = a.map(rgbOf).filter((c): c is [number, number, number] => !!c), pb = b.map(rgbOf).filter((c): c is [number, number, number] => !!c);
  if (!pa.length || !pb.length) return undefined;
  const side = (from: typeof pa, to: typeof pb) => from.reduce((s, c) => s + Math.min(...to.map((t) => deltaE(c, t))), 0) / from.length;
  return Math.max(0, 1 - (side(pa, pb) + side(pb, pa)) / 2 / 50);
}

/** 0 to 1: the mean of what can be compared (palette, typefaces, kinds with their order); what one of the films lacks is left out */
export function similarity(a: OwnReference['facts'], b: OwnReference['facts']): number {
  const parts: number[] = [];
  const colours = paletteNear(a.palette, b.palette);
  if (colours !== undefined) parts.push(colours);
  if (a.fonts.length && b.fonts.length) parts.push(jaccard(a.fonts, b.fonts));
  if (a.kinds.length && b.kinds.length) {
    const n = Math.max(a.kinds.length, b.kinds.length), same = a.kinds.filter((k, i) => b.kinds[i] === k).length;
    parts.push((jaccard(a.kinds, b.kinds) + same / n) / 2);
  }
  return parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : 0;
}

/** a colour as a word: blue, orange, a grey */
function hueName([r, g, b]: [number, number, number]): string {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 25) return 'grey';
  const h = (mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  const deg = (h + 360) % 360;
  return deg < 15 || deg >= 345 ? 'red' : deg < 45 ? 'orange' : deg < 70 ? 'yellow' : deg < 165 ? 'green' : deg < 200 ? 'teal' : deg < 255 ? 'blue' : deg < 290 ? 'purple' : 'pink';
}

/** a palette in words: its plate (the first colour) dark or light, and its most saturated colour as the accent */
function paletteWords(palette: string[]): string | null {
  const cols = palette.map(rgbOf).filter((c): c is [number, number, number] => !!c);
  if (cols.length < 2) return null;
  const plate = toLab(cols[0])[0] < 50 ? 'a dark plate' : 'a light plate';
  const chroma = (c: [number, number, number]) => Math.max(...c) - Math.min(...c);
  const accent = [...cols.slice(1)].sort((x, y) => chroma(y) - chroma(x))[0];
  return `${plate} with one ${hueName(accent)} accent`;
}

/**
 * How much the last `last` films kept look alike: the mean pairwise similarity,
 * and what they share in words. Null for fewer than three films: two are no trend.
 */
export function convergence(own: OwnReference[], last = 5): { score: number; shared: string[] } | null {
  const recent = [...own].sort((a, b) => (a.kept < b.kept ? -1 : 1)).slice(-last);
  if (recent.length < 3) return null;
  let sum = 0, n = 0, colour = 0, coloured = 0;
  for (let i = 0; i < recent.length; i++) for (let j = i + 1; j < recent.length; j++) {
    sum += similarity(recent[i].facts, recent[j].facts); n++;
    const p = paletteNear(recent[i].facts.palette, recent[j].facts.palette);
    if (p !== undefined) { colour += p; coloured++; }
  }
  const shared: string[] = [];
  const fonts = recent[0].facts.fonts.filter((f) => recent.every((r) => r.facts.fonts.includes(f)));
  if (fonts.length) shared.push(`the same fonts (${fonts.join(', ')})`);
  const words = coloured && colour / coloured >= 0.7 ? paletteWords(recent[0].facts.palette) : null;
  if (words) shared.push(words);
  for (const kind of new Set(recent[0].facts.kinds)) if (recent.every((r) => r.facts.kinds.includes(kind))) shared.push(`${kind} scenes in every film`);
  return { score: sum / n, shared };
}

/** the file of a project's entry in the library */
export const referenceFile = (project: string, slug: (s: string) => string) => `reference-${slug(project) || 'film'}.js`.slice(0, 66);
export const isReferenceFile = (name: string) => /^reference-[a-z0-9_-]+\.js$/.test(name);

/** an entry read from its library file, or null when the file is not one */
export function parseOwn(code: string): OwnReference | null {
  try {
    const p = JSON.parse(code.trim().replace(/^export default\s*/, '').replace(/;\s*$/, ''));
    return p && p.kind === 'tramme-reference' && typeof p.why === 'string' && p.facts ? (p as OwnReference) : null;
  } catch { return null; }
}
