import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BAR_LINKS, FOOTER, MENUS, type NavLink } from '../src/lib/nav';
import { PAGES, docHref } from '../src/lib/docs';
import { SRC, idsOf, pageFile } from './sources';

const links: NavLink[] = [...MENUS.flatMap((m) => m.links), ...BAR_LINKS, ...FOOTER.flatMap((m) => m.links)];

describe('the site map', () => {
  it('every internal link leads to a page that exists, and its anchor to an id that page has', () => {
    const docs = new Set(PAGES.map((p) => docHref(p.slug)));
    for (const { href } of links.filter((l) => !l.href.startsWith('https://'))) {
      const [page, fragment] = href.split('#');
      const isDocs = docs.has(page);
      expect(isDocs || fs.existsSync(path.join(SRC, pageFile(page))), `${href} leads nowhere`).toBe(true);
      if (fragment && !isDocs) expect(idsOf(pageFile(page)).has(fragment), `${href}: no id="${fragment}" on that page`).toBe(true);
    }
  });

  it('has no two links of one menu to the same place', () => {
    for (const menu of [...MENUS, ...FOOTER]) {
      const hrefs = menu.links.map((l) => l.href);
      expect(new Set(hrefs).size, `${menu.id} repeats a link`).toBe(hrefs.length);
    }
  });
});
