// The catalogue of open typefaces the editor searches (apps/editor/data/typefaces.json),
// built from Fontsource: the list of families, the axes of the variable ones, the
// tags their data gives (tags.ts) and the character written by hand (character.json).
// Nothing is written unless everything was read.
//
//   npm run typefaces:catalogue

import { readFileSync, writeFileSync } from 'node:fs';
import type { Catalogue, Typeface } from '../../apps/editor/src/typefaces/catalogue.ts';
import { TAGS, deriveTags } from './tags.ts';

const PIN = '5.3.0';
const API = 'https://api.fontsource.org/v1';
const CDN = 'https://cdn.jsdelivr.net/fontsource/fonts';
const LICENSES: Record<string, string> = { 'OFL-1.1': 'OFL-1.1', 'Apache-2.0': 'Apache-2.0', mit: 'MIT', MIT: 'MIT', 'CC0-1.0': 'CC0-1.0', Unlicense: 'Unlicense', 'UFL-1.0': 'UFL-1.0' };
const OUT = new URL('../../apps/editor/data/typefaces.json', import.meta.url);

interface Listed { id: string; family: string; subsets: string[]; weights: number[]; styles: string[]; defSubset: string; variable: boolean; category: string; license: string }
interface Character { tags?: string[]; for?: Typeface['for']; pairs?: string[]; note?: string }

const character: Record<string, Character> = JSON.parse(readFileSync(new URL('./character.json', import.meta.url), 'utf8'));

async function get<T>(url: string): Promise<T | null> {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** runs fn over the items, `n` at a time */
async function eachOf<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  }));
  return out;
}

/** whether the family's files exist at the pinned version (some families are newer than the pin) */
async function pinned(f: Listed): Promise<boolean> {
  const weight = f.weights.includes(400) ? 400 : f.weights[0];
  const r = await fetch(`${CDN}/${f.id}@${PIN}/${f.defSubset}-${weight}-normal.woff2`, { method: 'HEAD' });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`${f.id}: HTTP ${r.status}`);
  return true;
}

/** the weights of a variable family: the usual hundreds inside the range of its weight axis */
const spread = ([lo, hi]: [number, number]) => [100, 200, 300, 400, 500, 600, 700, 800, 900].filter((w) => w >= lo && w <= hi);

async function build(): Promise<Catalogue> {
  const all = (await get<Listed[]>(`${API}/fonts`)) ?? [];
  const listed = all.filter((f) => f.category !== 'icons' && LICENSES[f.license] && f.weights.length && f.subsets.length);
  console.log(`${all.length} families listed, ${listed.length} under an open licence`);

  const axesOf = new Map<string, Record<string, [number, number]>>();
  await eachOf(listed.filter((f) => f.variable), 8, async (f) => {
    const v = await get<{ axes: Record<string, { min: string; max: string }> }>(`${API}/variable/${f.id}`);
    if (!v) return;
    const axes: Record<string, [number, number]> = {};
    for (const [name, a] of Object.entries(v.axes)) if (name !== 'ital') axes[name] = [Number(a.min), Number(a.max)];
    if (Object.keys(axes).length) axesOf.set(f.id, axes);
  });

  const there = await eachOf(listed, 16, pinned);
  const kept = listed.filter((_, i) => there[i]);
  for (const id of Object.keys(character)) if (!kept.some((f) => f.id === id)) throw new Error(`${id} of character.json is not in the catalogue (unknown, closed licence or not published at ${PIN})`);
  console.log(`${kept.length} families have their files at ${PIN}`);

  const fonts: Typeface[] = kept.map((f) => {
    const axes = axesOf.get(f.id);
    const weights = axes?.wght ? spread(axes.wght) : [...f.weights].sort((a, b) => a - b);
    const italic = f.styles.includes('italic');
    const mine = character[f.id];
    const derived = deriveTags({ id: f.id, family: f.family, weights, axes, category: f.category, italic });
    const tags = [...new Set([...(mine?.tags ?? []), ...derived])];
    return {
      id: f.id, family: f.family, category: f.category as Typeface['category'], weights, italic, variable: !!axes,
      ...(axes ? { axes } : {}), subsets: f.subsets, license: LICENSES[f.license], tags,
      ...(mine?.for ? { for: mine.for } : {}), ...(mine?.pairs ? { pairs: mine.pairs } : {}), ...(mine?.note ? { note: mine.note } : {}),
    };
  }).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const f of fonts) for (const t of f.tags) if (!(TAGS as readonly string[]).includes(t)) throw new Error(`${f.id}: tag ${t} is not in the vocabulary`);
  return { pin: PIN, fonts };
}

try {
  const catalogue = await build();
  writeFileSync(OUT, JSON.stringify(catalogue));
  console.log(`${catalogue.fonts.length} families written to apps/editor/data/typefaces.json`);
} catch (e) {
  console.error(`the catalogue was not written: ${(e as Error).message}`);
  process.exit(1);
}
