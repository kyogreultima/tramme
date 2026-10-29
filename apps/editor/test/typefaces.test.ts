import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TAGS, deriveTags } from '../../../scripts/typefaces/tags.ts';
import type { Catalogue } from '../src/typefaces/catalogue.ts';

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
