import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { barLinks, footerColumns, menus, type NavLink } from '../src/lib/nav';
import { PAGES, docHref } from '../src/lib/docs';
import { LOCALES } from '../src/lib/i18n';
import { SRC, idsOf, pageFile, read } from './sources';

const linksOf = (locale: (typeof LOCALES)[number]): NavLink[] => [...menus(locale).flatMap((m) => m.links), ...barLinks(locale), ...footerColumns(locale).flatMap((m) => m.links)];

describe.each(LOCALES)('the site map (%s)', (locale) => {
  it('every internal link leads to a page that exists, and its anchor to an id that page has', () => {
    const docs = new Set(PAGES.map((p) => docHref(p.slug)));
    for (const { href } of linksOf(locale).filter((l) => !l.href.startsWith('https://'))) {
      const [page, fragment] = href.split('#');
      const isDocs = docs.has(page);
      expect(isDocs || fs.existsSync(path.join(SRC, pageFile(page))), `${href} leads nowhere`).toBe(true);
      if (fragment && !isDocs) expect(idsOf(pageFile(page)).has(fragment), `${href}: no id="${fragment}" on that page`).toBe(true);
    }
  });

  it('keeps French pages in French', () => {
    const docs = new Set(PAGES.map((p) => docHref(p.slug)));
    for (const { href } of linksOf(locale).filter((l) => l.href.startsWith('/') && !docs.has(l.href.split('#')[0]))) {
      expect(href.startsWith('/fr/') || href === '/fr', `${href}`).toBe(locale === 'fr');
    }
  });

  it('has no two links of one menu to the same place', () => {
    for (const menu of [...menus(locale), ...footerColumns(locale)]) {
      const hrefs = menu.links.map((l) => l.href);
      expect(new Set(hrefs).size, `${menu.id} repeats a link`).toBe(hrefs.length);
    }
  });
});

describe('the choices of the footer', () => {
  it('offers no theme choice: the site is dark only, the docs keep their toggle', () => {
    expect(read('components/Footer.astro')).not.toMatch(/Theme/);
    expect(read('layouts/Base.astro')).toContain("dataset.theme = 'dark'");
  });

  it('keeps no light surface on the site: the paper sections use the dark tokens', () => {
    const site = read('styles/site.css') + read('components/Community.astro');
    expect(site).not.toContain('--tramme-light');
    expect(/--paper[\w-]*: var\(--tramme-light/.test(read('styles/theme.css'))).toBe(false);
  });

  it('changes language with plain links, without script', () => {
    const source = read('components/LanguageChoice.astro');
    expect(source).not.toContain('<script');
    expect(source).toContain('pathFor');
  });

  it('opens the menus without script: they are <details>', () => {
    expect(read('components/Menu.astro')).toContain('<details');
    expect(read('components/Nav.astro')).toContain('<details');
    expect(read('components/Faq.astro')).toContain('<details');
  });
});
