import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGES, docHref } from '../src/lib/docs';
import { TOOL_GROUPS } from '../src/lib/tools';
import { SRC, idsOf, read, sourcesOf } from './sources';
import { APP, appProject, logIn, signUp, space } from '../src/lib/links';

const pages = fs.readdirSync(path.join(SRC, 'pages')).filter((f) => f.endsWith('.astro'));
const slugs = new Set(PAGES.map((p) => p.slug));

describe('the links written in the site\'s pages and components', () => {
  it.each(pages)('%s: an anchor of its own page leads to an id that the page has', (page) => {
    const ids = idsOf(`pages/${page}`);
    for (const [, fragment] of sourcesOf(`pages/${page}`).join('\n').matchAll(/href="#([\w-]+)"/g)) {
      expect(ids.has(fragment), `${page}: href="#${fragment}" leads nowhere on that page`).toBe(true);
    }
  });

  it('to a docs page name a page that exists', () => {
    const files = [...fs.readdirSync(path.join(SRC, 'components')).filter((f) => f.endsWith('.astro')).map((f) => `components/${f}`), ...pages.map((f) => `pages/${f}`)];
    for (const file of files) {
      for (const [, slug] of read(file).matchAll(/docHref\('([^']*)'\)/g)) {
        expect(slugs.has(slug), `${file}: docHref('${slug}') is not a docs page`).toBe(true);
      }
    }
  });

  it('from the toolbox name a docs page that exists', () => {
    const hrefs = new Set(PAGES.map((p) => docHref(p.slug)));
    for (const { name, doc } of TOOL_GROUPS) expect(hrefs.has(docHref(doc)), `${name}: no docs page '${doc}'`).toBe(true);
  });

  it('from llms.txt lead to pages of the site', () => {
    const paths = [...read('pages/llms.txt.ts').matchAll(/\['(\/[\w-]+\/)'/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(fs.existsSync(path.join(SRC, 'pages', `${p.replace(/\//g, '')}.astro`)), `${p} has no page`).toBe(true);
  });
});

describe('the addresses of the app', () => {
  it('carry the prompt and the language to sign-up', () => {
    expect(signUp({ prompt: 'a launch film', lang: 'fr' })).toBe(`${APP}/signup?prompt=a%20launch%20film&lang=fr`);
    expect(signUp()).toBe(`${APP}/signup`);
    expect(signUp({ prompt: '  ', lang: 'en' })).toBe(`${APP}/signup?lang=en`);
  });

  it('open a public project for reuse', () => {
    expect(appProject('anime', 'fr')).toBe(`${APP}/p/anime?lang=fr`);
    expect(logIn()).toBe(`${APP}/login`);
    expect(space('en')).toBe(`${APP}/space?lang=en`);
  });
});
