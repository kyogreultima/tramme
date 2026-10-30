import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REF_TAGS, loadReferences, type Reference } from '../src/references/catalogue.ts';

const refs: Reference[] = JSON.parse(readFileSync(new URL('../data/references.json', import.meta.url), 'utf8'));
const CRAFT = REF_TAGS.slice(0, REF_TAGS.indexOf('interface'));

describe('the shipped references', () => {
  it('hold at least 45 principles and 20 faults', () => {
    expect(refs.filter((r) => r.kind === 'principle').length).toBeGreaterThanOrEqual(45);
    expect(refs.filter((r) => r.kind === 'fault').length).toBeGreaterThanOrEqual(20);
  });

  it('have unique ids of lower case letters, digits and dashes, and tags of the closed list', () => {
    const ids = refs.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of refs) {
      expect(r.id, r.id).toMatch(/^[a-z0-9-]+$/);
      expect(r.tags.length, r.id).toBeGreaterThan(0);
      for (const tag of r.tags) expect(REF_TAGS as readonly string[], `${r.id}: ${tag}`).toContain(tag);
    }
  });

  it('are 120 to 900 characters of text, and a fault says how to fix it', () => {
    for (const r of refs) {
      expect(r.text.length, r.id).toBeGreaterThanOrEqual(120);
      expect(r.text.length, r.id).toBeLessThanOrEqual(900);
      if (r.kind === 'fault') expect(r.fix, r.id).toBeTruthy();
    }
  });

  it('hold no media, no address, no colour value and no size in pixels: words, never a recipe or a copy', () => {
    for (const r of refs) {
      const all = [r.title, r.text, r.see, r.fix].join(' ');
      expect(all, r.id).not.toMatch(/https?:|www\.|\.(mp4|mov|png|jpe?g|gif|webm)\b/i);
      expect(all, r.id).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(all, r.id).not.toMatch(/\d\s?px\b/i);
    }
  });

  it('use every craft tag at least twice', () => {
    for (const tag of CRAFT) expect(refs.filter((r) => r.tags.includes(tag)).length, tag).toBeGreaterThanOrEqual(2);
  });

  it('name nothing of the test briefs: none of their proper nouns, nor the reference films', () => {
    const briefs = JSON.parse(readFileSync(new URL('../../../bench/briefs.json', import.meta.url), 'utf8')).briefs as { split: string; prompt: string }[];
    const nouns = new Set<string>();
    for (const b of briefs.filter((x) => x.split === 'test')) {
      // a capitalised word that does not start a sentence is a name
      for (const m of b.prompt.matchAll(/(?<![.!?:]\s)(?<!^)\b[A-Z][a-zA-Z]{2,}\b/g)) nouns.add(m[0].toLowerCase());
    }
    const text = refs.map((r) => [r.title, r.text, r.see, r.fix].join(' ').toLowerCase()).join(' ');
    for (const noun of nouns) expect(text, noun).not.toMatch(new RegExp(`\b${noun}\b`));
    for (const banned of ['marketing', 'bilal', 'axiom']) expect(text).not.toContain(banned);
  });
});

describe('loadReferences', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reads the file once, and tries again after a failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('x', { status: 500 }))
      .mockResolvedValue(new Response(JSON.stringify(refs.slice(0, 2)), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadReferences()).rejects.toThrow('HTTP 500');
    expect(await loadReferences()).toHaveLength(2);
    await loadReferences();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('the search of the references', () => {
  const idsOf = (r: { found: Reference[] }) => r.found.map((x) => x.id);

  it('reads a query as words: lower case, plurals folded, filler dropped', async () => {
    const { queryWords } = await import('../src/words.ts');
    expect(queryWords('Transitions between Scenes')).toEqual(['transition', 'scene']);
    expect(queryWords('the Boxes of a family')).toEqual(['box', 'family']);
    expect(queryWords('glass, class and stories')).toEqual(['glass', 'class', 'story']);
  });

  it('finds the entries tagged with what is asked first', async () => {
    const { searchReferences } = await import('../src/references/search.ts');
    const r = searchReferences(refs, 'transitions between scenes');
    expect(r.closest).toBe(false);
    expect(refs.find((x) => x.id === idsOf(r)[0])!.tags).toContain('transition');
    expect(r.found.length).toBeLessThanOrEqual(4);
  });

  it('finds the coverage principle and the speaker-alone fault for a talking video', async () => {
    const { searchReferences } = await import('../src/references/search.ts');
    const ids = idsOf(searchReferences(refs, 'talking video coverage', { count: 4 }));
    expect(ids).toContain('talking-video-covered');
    expect(ids).toContain('speaker-alone-too-long');
  });

  it('answers a query with no match with the entries of the closest tag, and says so', async () => {
    const { searchReferences } = await import('../src/references/search.ts');
    const r = searchReferences(refs, 'zzz');
    expect(r.closest).toBe(true);
    expect(r.found.length).toBeGreaterThan(0);
    const only = searchReferences(refs, 'the of a');
    expect(only.closest).toBe(true);
    expect(only.found.length).toBeGreaterThan(0);
  });

  it('keeps to faults, or to a tag, when asked', async () => {
    const { searchReferences } = await import('../src/references/search.ts');
    expect(searchReferences(refs, 'motion', { kind: 'fault' }).found.every((x) => x.kind === 'fault')).toBe(true);
    expect(searchReferences(refs, 'film', { tags: ['sound'] }).found.every((x) => x.tags.includes('sound'))).toBe(true);
  });
});
