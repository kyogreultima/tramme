import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guidesOf, systemParts } from '../src/index.ts';

const reference = fs.readFileSync(new URL('../../../docs/document.md', import.meta.url), 'utf8');

describe('the guides read on demand', () => {
  it('finds every guide it names: a renamed heading or chapter is not dropped in silence', () => {
    const names = guidesOf(reference).map((g) => g.name).sort();
    expect(names).toEqual(['clips', 'critic', 'events', 'film-plan', 'hydracept', 'interface', 'node-plugins', 'references', 'scenes', 'shorts', 'sources', 'speaking', 'stock', 'surfaces', 'tilts', 'typefaces']);
  });

  it('leaves their text out of the system prompt and lists them at its end', () => {
    const { fixed } = systemParts(reference);
    for (const g of guidesOf(reference)) {
      expect(fixed).not.toContain(g.text);
      expect(fixed).toContain(`- ${g.name}: ${g.line}`);
    }
    // what every film needs stays: the rules, motion, sound, the document's structure and properties
    for (const kept of ['Rules:', 'Motion: space before time', 'Sound: a video without sound', '## Structure', '## Properties']) expect(fixed).toContain(kept);
  });

  it('shrinks the system prompt by a quarter at least', () => {
    const whole = systemParts(reference).fixed.length + guidesOf(reference).reduce((n, g) => n + g.text.length, 0);
    expect(systemParts(reference).fixed.length).toBeLessThan(whole * 0.75);
  });
});
