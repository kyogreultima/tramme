import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TAGS, deriveTags } from '../../../scripts/typefaces/tags.ts';
import type { Catalogue } from '../src/typefaces/catalogue.ts';
import { scriptsOf, searchTypefaces } from '../src/typefaces/search.ts';

const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const catalogue = read<Catalogue>('../data/typefaces.json');
const character = read<Record<string, { tags?: string[]; for?: string[]; pairs?: string[]; note?: string }>>('../../../scripts/typefaces/character.json');
const ALLOWED = ['OFL-1.1', 'Apache-2.0', 'MIT', 'CC0-1.0', 'Unlicense', 'UFL-1.0'];
const range = (from: number, to: number) => Array.from({ length: (to - from) / 100 + 1 }, (_, i) => from + i * 100);

describe('typeface tags', () => {
  it('derive the character from the name, the axes, the weights and the category', () => {
    const condensed = deriveTags({ id: 'roboto-condensed', family: 'Roboto Condensed', weights: range(100, 900), axes: { wght: [100, 900] }, category: 'sans-serif' });
    expect(condensed).toEqual(expect.arrayContaining(['condensed', 'heavy', 'light', 'variable']));
    const playfair = deriveTags({ id: 'playfair-display', family: 'Playfair Display', weights: range(400, 900), category: 'serif' });
    expect(playfair).toEqual(expect.arrayContaining(['serif', 'heavy']));
    expect(deriveTags({ id: 'x', family: 'X', weights: [400], axes: { wdth: [75, 100] }, category: 'sans-serif' })).toContain('condensed');
    expect(deriveTags({ id: 'x', family: 'X', weights: [400], axes: { wdth: [100, 151] }, category: 'sans-serif' })).toContain('wide');
    expect(deriveTags({ id: 'jetbrains-mono', family: 'JetBrains Mono', weights: [400], category: 'monospace' })).toContain('mono');
    const display = deriveTags({ id: 'y', family: 'Y', weights: [400], category: 'display' });
    expect(display).toContain('display');
    expect(display).not.toContain('heavy');
    expect(display).not.toContain('light');
  });

  it('read the words of a name', () => {
    const of = (family: string) => deriveTags({ id: family, family, weights: [400], category: 'sans-serif' });
    expect(of('Archivo Narrow')).toContain('condensed');
    expect(of('Syne Extended')).toContain('wide');
    expect(of('Roboto Slab')).toContain('slab');
    expect(of('Varela Round')).toContain('rounded');
    expect(of('Alfa Slab One Black')).toEqual(expect.arrayContaining(['slab', 'heavy']));
  });
});

describe('the generated catalogue', () => {
  it('is pinned and large', () => {
    expect(catalogue.pin).toBe('5.3.0');
    expect(catalogue.fonts.length).toBeGreaterThanOrEqual(1500);
  });

  it('describes each family completely', () => {
    for (const f of catalogue.fonts) {
      expect(f.family, f.id).not.toBe('');
      expect(f.subsets.length, f.id).toBeGreaterThan(0);
      expect(f.weights.length, f.id).toBeGreaterThan(0);
      expect(ALLOWED, f.id).toContain(f.license);
      expect(f.id).toMatch(/^[a-z0-9-]+$/);
      for (const tag of f.tags) expect(TAGS, `${f.id}: ${tag}`).toContain(tag);
    }
    expect(new Set(catalogue.fonts.map((f) => f.id)).size).toBe(catalogue.fonts.length);
  });
});

describe('the hand-written character of families', () => {
  const ids = new Set(catalogue.fonts.map((f) => f.id));
  const entries = Object.entries(character);

  it('names families of the catalogue, with tags of the vocabulary', () => {
    expect(entries.filter(([id]) => !ids.has(id)).map(([id]) => id)).toEqual([]);
    for (const [id, c] of entries) {
      for (const tag of c.tags ?? []) expect(TAGS, `${id}: ${tag}`).toContain(tag);
      for (const p of c.pairs ?? []) expect(ids.has(p), `${id} pairs ${p}`).toBe(true);
    }
  });

  it('covers enough families of each character', () => {
    expect(entries.length).toBeGreaterThanOrEqual(150);
    const count = (tag: string) => catalogue.fonts.filter((f) => character[f.id] && f.tags.includes(tag)).length;
    expect(count('condensed')).toBeGreaterThanOrEqual(6);
    expect(count('slab')).toBeGreaterThanOrEqual(6);
    expect(count('mono')).toBeGreaterThanOrEqual(6);
    expect(count('serif')).toBeGreaterThanOrEqual(10);
    expect(count('rounded')).toBeGreaterThanOrEqual(10);
  });
});

describe('scripts of a text', () => {
  it('name the subsets a text needs', () => {
    expect(scriptsOf('Prix : 40 €')).toEqual(['latin']);
    expect(scriptsOf('Évasion')).toEqual(['latin']);
    expect(scriptsOf('Łódź')).toEqual(expect.arrayContaining(['latin', 'latin-ext']));
    expect(scriptsOf('Việt Nam')).toEqual(expect.arrayContaining(['latin', 'vietnamese']));
    expect(scriptsOf('Привет')).toEqual(['cyrillic']);
    expect(scriptsOf('Γειά σου')).toEqual(['greek']);
    expect(scriptsOf('مرحبا')).toEqual(['arabic']);
    expect(scriptsOf('שלום')).toEqual(['hebrew']);
    expect(scriptsOf('こんにちは')).toEqual(['japanese']);
    expect(scriptsOf('안녕하세요')).toEqual(['korean']);
    expect(scriptsOf('สวัสดี')).toEqual(['thai']);
    expect(scriptsOf('नमस्ते')).toEqual(['devanagari']);
    expect(scriptsOf('Hello Привет')).toEqual(expect.arrayContaining(['latin', 'cyrillic']));
    expect(scriptsOf('2024')).toEqual(['latin']);
    expect(scriptsOf('')).toEqual([]);
  });
});

describe('search by character', () => {
  const search = (query: string, opts?: Parameters<typeof searchTypefaces>[2]) => searchTypefaces(catalogue, query, opts);
  const names = (r: ReturnType<typeof search>) => r.found.map((x) => x.font.id);

  it('finds condensed heavy faces for titles', () => {
    const r = search('condensed grotesque heavy titles');
    expect(r.found.length).toBeGreaterThan(0);
    expect(r.found.length).toBeLessThanOrEqual(6);
    for (const x of r.found) expect(x.font.tags, x.font.id).toContain('condensed');
    expect(r.found[0].font.tags).toContain('heavy');
    expect(r.found[0].why).toEqual(expect.arrayContaining(['condensed', 'heavy']));
    expect(r.unknown).toEqual([]);
    expect(r.closest).toBe(false);
  });

  it('keeps to the kind asked for', () => {
    const serif = search('elegant serif for a quote');
    expect(serif.found.length).toBeGreaterThan(0);
    for (const x of serif.found) {
      expect(x.font.tags.includes('serif') || x.font.tags.includes('elegant'), x.font.id).toBe(true);
      expect(x.font.category).not.toBe('monospace');
    }
    const hand = search('handwritten marker');
    expect(hand.found.length).toBeGreaterThan(0);
    for (const x of hand.found) expect(x.font.category, x.font.id).toBe('handwriting');
    for (const x of search('technical mono').found) expect(x.font.tags, x.font.id).toContain('mono');
  });

  it('says which words it did not know and still answers', () => {
    const r = search('quirky zebra');
    expect(r.unknown).toEqual(['quirky', 'zebra']);
    expect(r.closest).toBe(true);
    expect(r.found.length).toBeGreaterThan(0);
    const some = search('heavy quirky');
    expect(some.unknown).toEqual(['quirky']);
    expect(some.closest).toBe(false);
  });

  it('answers a name', () => {
    const r = search('bebas');
    expect(names(r)[0]).toBe('bebas-neue');
    expect(r.unknown).toEqual([]);
  });

  it('keeps to the families whose subsets cover the text', () => {
    for (const x of search('sans', { text: 'Привет' }).found) expect(x.font.subsets, x.font.id).toContain('cyrillic');
    const arabic = search('headline', { text: 'مرحبا' });
    expect(arabic.found.length).toBeGreaterThan(0);
    for (const x of arabic.found) expect(x.font.subsets, x.font.id).toContain('arabic');
    for (const x of search('serif', { text: 'Évasion 12,50 €' }).found) expect(x.font.subsets, x.font.id).toContain('latin');
    const none = search('serif', { text: 'こんにちは مرحبا' });
    expect(none.found).toEqual([]);
    expect(none.closest).toBe(false);
  });

  it('takes a script named in the query', () => {
    for (const x of search('arabic headline').found) expect(x.font.subsets, x.font.id).toContain('arabic');
  });

  it('ignores case and plurals and knows the synonyms', () => {
    expect(names(search('Titles HEAVY'))).toEqual(names(search('title heavy')));
    for (const [word, tag] of [['thick', 'heavy'], ['black', 'heavy'], ['fat', 'heavy'], ['narrow', 'condensed'], ['compressed', 'condensed'], ['monospaced', 'mono'], ['code', 'mono'], ['script', 'handwritten'], ['cursive', 'handwritten']]) {
      const r = search(word);
      expect(r.unknown, word).toEqual([]);
      expect(r.found.length, word).toBeGreaterThan(0);
      expect(r.found[0].why, word).toContain(tag);
    }
    for (const word of ['title', 'titles', 'headline', 'headlines', 'heading', 'headings']) expect(search(`${word} heavy`).found[0].why, word).toContain('title');
    for (const word of ['body', 'paragraph']) expect(search(`${word} humanist`).found[0].why, word).toContain('text');
  });

  it('puts the families described by hand before the ones matched by their data alone', () => {
    const base = { category: 'sans-serif' as const, weights: [400], italic: false, variable: false, subsets: ['latin'], license: 'OFL-1.1' };
    const small = { pin: '5.3.0', fonts: [{ ...base, id: 'aaa', family: 'Aaa', tags: ['condensed'] }, { ...base, id: 'zzz', family: 'Zzz', tags: ['condensed'], for: ['text' as const] }] };
    expect(searchTypefaces(small, 'condensed').found.map((x) => x.font.id)).toEqual(['zzz', 'aaa']);
  });

  it('respects the count and the category', () => {
    expect(search('sans', { count: 2 }).found).toHaveLength(2);
    for (const x of search('heavy', { category: 'serif', count: 6 }).found) expect(x.font.category).toBe('serif');
  });
});
