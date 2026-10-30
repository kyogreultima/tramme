import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BAR_LINKS, FOOTER, MENUS, type NavLink } from '../src/lib/nav';
import { PAGES, docHref } from '../src/lib/docs';

const SRC = path.join(import.meta.dirname, '../src');

/** pages the redesign adds, each removed from here by the task that makes it */
const PENDING = ['/features/', '/pricing/', '/about/', '/privacy/'];

const links: NavLink[] = [...MENUS.flatMap((m) => m.links), ...BAR_LINKS, ...FOOTER.flatMap((m) => m.links)];
const components = fs.readdirSync(path.join(SRC, 'components')).filter((f) => f.endsWith('.astro')).map((f) => fs.readFileSync(path.join(SRC, 'components', f), 'utf8')).join('\n');

describe('the site map', () => {
  it('every internal link leads to a page that exists', () => {
    const docs = new Set(PAGES.map((p) => docHref(p.slug)));
    for (const { href } of links.filter((l) => !l.href.startsWith('https://'))) {
      const [page, fragment] = href.split('#');
      const exists = page === '/' || PENDING.includes(page) || docs.has(page)
        || fs.existsSync(path.join(SRC, 'pages', `${page.replace(/^\/|\/$/g, '')}.astro`));
      expect(exists, `${href} leads nowhere`).toBe(true);
      if (fragment) expect(components, `${href}: no id="${fragment}" in a component`).toContain(`id="${fragment}"`);
    }
  });

  it('has no two links of one menu to the same place', () => {
    for (const menu of [...MENUS, ...FOOTER]) {
      const hrefs = menu.links.map((l) => l.href);
      expect(new Set(hrefs).size, `${menu.id} repeats a link`).toBe(hrefs.length);
    }
  });
});
