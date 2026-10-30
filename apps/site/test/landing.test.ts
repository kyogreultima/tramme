import { describe, expect, it } from 'vitest';
import { read, sourcesOf } from './sources';

const landing = read('pages/index.astro');
const sections = [...(/<main>([\s\S]*?)<\/main>/.exec(landing)?.[1] ?? '').matchAll(/<([A-Z]\w+) \/>/g)].map((m) => m[1]);

describe('the landing page', () => {
  it('has five sections: the app, its tabs, the examples, the questions, the closing call', () => {
    expect(sections).toEqual(['Hero', 'Tabs', 'Made', 'Faq', 'Closing']);
  });

  it('keeps to one width: nothing of it breaks out of the container', () => {
    expect(sourcesOf('pages/index.astro').join('\n')).not.toContain('wrap-wide');
  });

  it('changes tab without script', () => {
    expect(read('components/Tabs.astro')).not.toContain('<script');
  });

  it('has one heading style: every section takes its heading from Head', () => {
    for (const file of ['Tabs', 'Made', 'Faq', 'Closing']) expect(read(`components/${file}.astro`), file).toContain("import Head from './Head.astro'");
  });
});
