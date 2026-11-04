import { describe, expect, it } from 'vitest';
import { barButtons, footerColumns, menus, type NavLink } from '../src/lib/nav';
import { APP } from '../src/lib/links';
import { LOCALES } from '../src/lib/i18n';
import { SRC, read } from './sources';
import fs from 'node:fs';
import path from 'node:path';

const walk = (dir: string): string[] =>
  fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const astro = [...walk('components'), ...walk('pages'), ...walk('layouts')].filter((f) => f.endsWith('.astro'));

describe('moving between the pages of the site', () => {
  it('goes by the router: no reload, a transition between pages', () => {
    expect(read('layouts/Base.astro')).toMatch(/import \{ ClientRouter \} from 'astro:transitions'/);
    expect(read('layouts/Base.astro')).toContain('<ClientRouter />');
  });

  it('sends a link to the documentation out of the router: it is another layout, with scripts of its own', () => {
    expect(read('layouts/Base.astro')).toContain("data-astro-reload");
    expect(read('layouts/Base.astro')).toMatch(/docs/);
  });

  it('puts the root attributes back after each swap (the router replaces them)', () => {
    expect(read('layouts/Base.astro')).toContain("astro:after-swap");
    expect(read('components/Platform.astro')).toContain("astro:after-swap");
  });

  it('runs the scripts of the pages at each page, not once: the router loads a script one time', () => {
    for (const file of ['Hero', 'Media', 'ProjectCard', 'Source']) expect(read(`components/${file}.astro`), file).toContain('astro:page-load');
  });
});

describe('the links that cross between the site and the app', () => {
  it('are marked as leading to the app in the menus, the bar and the footer', () => {
    for (const locale of LOCALES) {
      const all: NavLink[] = [...menus(locale).flatMap((m) => m.links), ...footerColumns(locale).flatMap((m) => m.links), barButtons(locale).logIn, barButtons(locale).start];
      const toTheApp = all.filter((l) => l.href.startsWith(APP));
      expect(toTheApp.length, locale).toBeGreaterThanOrEqual(5);
      for (const link of toTheApp) expect(link.app, `${link.label} leads to the app`).toBe(true);
      for (const link of all.filter((l) => !l.href.startsWith(APP))) expect(link.app, `${link.label} stays on the site`).toBeUndefined();
    }
  });

  it('open in a tab of their own, by attributes written on the anchor', () => {
    const leadsToApp = /href=\{(?:signUp\(|logIn\(|space\(|appProject\(|APP)/;
    for (const file of astro) {
      for (const tag of read(file).match(/<a[^>]*>/g) ?? []) {
        if (leadsToApp.test(tag)) expect(tag, `${file}: ${tag}`).toContain('target="_blank" rel="noopener"');
      }
    }
  });

  it('are rendered with the target by the bar, the menus and the footer, from the flag of each link', () => {
    for (const file of ['Nav', 'Menu', 'Footer']) expect(read(`components/${file}.astro`), file).toContain("target={app ? '_blank' : undefined}");
  });

  it('never get their attributes from a spread: Astro adds the style classes of the component to a spread object, which pile up and give the link the look of other components', () => {
    for (const file of astro) {
      for (const tag of read(file).match(/<a[^>]*>/g) ?? []) expect(tag, `${file}: ${tag}`).not.toMatch(/\{\.\.\./);
    }
  });
});
