import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../src/lib/i18n';
import { read, sourcesOf } from './sources';

const PAGE = 'pages/[...lang]/index.astro';
const landing = read(PAGE);
const sections = [...(/<Page [^>]*>([\s\S]*?)<\/Page>/.exec(landing)?.[1] ?? '').matchAll(/<([A-Z]\w+) locale=\{locale\} \/>/g)].map((m) => m[1]);

describe('the landing page', () => {
  it('follows the reference composition with the film journey after the hero', () => {
    expect(sections).toEqual(['Hero', 'Tabs', 'Showcase', 'Materials', 'Bento', 'Community', 'LandingClosing']);
  });

  it('is served in both languages', () => {
    expect(landing).toContain('getStaticPaths = localePaths');
  });

  it('keeps to one width: nothing of it breaks out of the container', () => {
    expect(sourcesOf(PAGE).join('\n')).not.toContain('wrap-wide');
  });

  it('progressively enhances the film journey with a scroll controller', () => {
    expect(read('components/Tabs.astro')).toContain('setupJourney');
    expect(read('components/Tabs.astro')).not.toMatch(/<article[^>]*\shidden[=>\s]/);
  });

  it('has one heading style: every section with a title card takes it from Head (the hero and the closing call set their own display type)', () => {
    for (const file of ['Tabs', 'Community', 'Bento']) expect(read(`components/${file}.astro`), file).toContain("import Head from './Head.astro'");
  });

  it('links directly to sign-up and the demonstration, without script', () => {
    const hero = read('components/Hero.astro');
    expect(hero).toContain('href="#film"');
    expect(hero).toContain("signUp");
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
