import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../src/lib/i18n';
import { read, sourcesOf } from './sources';

const PAGE = 'pages/[...lang]/index.astro';
const landing = read(PAGE);
const sections = [...(/<Page [^>]*>([\s\S]*?)<\/Page>/.exec(landing)?.[1] ?? '').matchAll(/<([A-Z]\w+) locale=\{locale\} \/>/g)].map((m) => m[1]);

describe('the landing page', () => {
  it('has five sections: hero, pillars, community, platform, closing', () => {
    expect(sections).toEqual(['Hero', 'Tabs', 'Community', 'Bento', 'Closing']);
  });

  it('is served in both languages', () => {
    expect(landing).toContain('getStaticPaths = localePaths');
  });

  it('keeps to one width: nothing of it breaks out of the container', () => {
    expect(sourcesOf(PAGE).join('\n')).not.toContain('wrap-wide');
  });

  it('changes tab without script', () => {
    expect(read('components/Tabs.astro')).not.toContain('<script');
  });

  it('has one heading style: every section but the hero takes its heading from Head', () => {
    for (const file of ['Tabs', 'Community', 'Bento', 'Closing']) expect(read(`components/${file}.astro`), file).toContain("import Head from './Head.astro'");
  });

  it('sends the hero field to the sign-up address, without script', () => {
    const hero = read('components/Hero.astro');
    expect(hero).toContain('<form');
    expect(hero).toContain('method="get"');
    expect(hero).toContain('name="prompt"');
    expect(hero).toContain("signUp");
    expect(hero).not.toContain('<script');
  });

  it('runs no engine', () => {
    expect(sourcesOf(PAGE).join('\n')).not.toMatch(/@tramme\/(render|core|nodes)/);
  });

  it('invents no proof: no testimonial, no count of users or creators', () => {
    const text = JSON.stringify(CATALOGS.en.landing);
    expect(text).not.toMatch(/testimonial|trusted by|loved by/i);
    expect(text).not.toMatch(/\d[\d,. ]*\+? (users|creators|filmmakers|projects)/i);
  });
});
