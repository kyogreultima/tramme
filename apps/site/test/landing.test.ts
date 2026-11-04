import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../src/lib/i18n';
import { read, sourcesOf } from './sources';

const PAGE = 'pages/[...lang]/index.astro';
const landing = read(PAGE);
// the sections in use: what is commented out (paused) is not one
const used = (/<Page [^>]*>([\s\S]*?)<\/Page>/.exec(landing)?.[1] ?? '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const sections = [...used.matchAll(/<([A-Z]\w+) (?:locale=\{locale\} )?\/>/g)].map((m) => m[1]);

describe('the landing page', () => {
  it('is made of text and figures after the hero: no picture of the app, no video', () => {
    expect(sections).toEqual(['Hero', 'Materials', 'Inside', 'Tools', 'Render', 'Bento', 'LandingClosing']);
  });

  it('is served in both languages', () => {
    expect(landing).toContain('getStaticPaths = localePaths');
  });

  it('keeps to one width: nothing of it breaks out of the container', () => {
    expect(sourcesOf(PAGE).join('\n')).not.toContain('wrap-wide');
  });

  it('has one heading style: every section with a title card takes it from Head (the hero and the closing call set their own display type)', () => {
    for (const file of ['Inside', 'Tools', 'Render', 'Bento']) expect(read(`components/${file}.astro`), file).toContain("import Head from './Head.astro'");
  });

  it('links directly to sign-up, without script (the demonstration link is paused with the video sections)', () => {
    const hero = read('components/Hero.astro');
    expect(hero.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')).not.toContain('href="#film"');
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
