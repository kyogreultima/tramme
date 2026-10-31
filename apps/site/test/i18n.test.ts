import { describe, expect, it } from 'vitest';
import { CATALOGS, pathFor, pathIn, translate } from '../src/lib/i18n';

const keys = (node: unknown, prefix = ''): string[] =>
  typeof node === 'object' && node ? Object.entries(node).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k)) : [prefix];

describe('the site\'s languages', () => {
  it('has the same keys in both catalogs', () => {
    expect(keys(CATALOGS.fr).sort()).toEqual(keys(CATALOGS.en).sort());
  });

  it('falls back to English for a missing key, then to the key', () => {
    const catalogs = { en: { a: { b: 'Hello {name}' } }, fr: {} };
    expect(translate(catalogs, 'fr', 'a.b', { name: 'Ana' })).toBe('Hello Ana');
    expect(translate(catalogs, 'fr', 'nope.x')).toBe('nope.x');
  });

  it('prefixes French paths only', () => {
    expect(pathIn('en', '/pricing/')).toBe('/pricing/');
    expect(pathIn('fr', '/pricing/')).toBe('/fr/pricing/');
    expect(pathIn('fr', '/')).toBe('/fr/');
    expect(pathIn('fr', '/docs/')).toBe('/docs/');
    expect(pathIn('fr', 'https://app.tramme.dev')).toBe('https://app.tramme.dev');
    expect(pathIn('fr', '/features/#studio')).toBe('/fr/features/#studio');
  });

  it('finds the same page in the other language', () => {
    expect(pathFor('fr', '/pricing/')).toBe('/fr/pricing/');
    expect(pathFor('en', '/fr/pricing/')).toBe('/pricing/');
    expect(pathFor('en', '/fr/')).toBe('/');
    expect(pathFor('fr', '/fr/')).toBe('/fr/');
  });

  it('fills every text of every language', () => {
    for (const locale of ['en', 'fr'] as const) for (const k of keys(CATALOGS[locale])) expect(translate(CATALOGS, locale, k).trim(), `${locale}:${k}`).not.toBe('');
  });
});
