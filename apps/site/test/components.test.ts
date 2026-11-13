import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, read } from './sources';

const walk = (dir: string): string[] =>
  fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

const components = walk('components').filter((f) => f.endsWith('.astro'));
const everything = [...walk('components'), ...walk('pages'), ...walk('layouts')].filter((f) => /\.(astro|ts)$/.test(f));
const withoutScript = (source: string) => source.replace(/<script[\s\S]*?<\/script>/g, '');

describe('the components', () => {
  it.each(['Plans', 'PlanCard', 'PlanTable', 'Faq', 'Menu', 'LanguageChoice'])('%s works without script', (name) => {
    expect(read(`components/${name}.astro`)).not.toContain('<script');
  });

  it('use no colour of their own: tokens only', () => {
    for (const file of components.filter((f) => !/Media|Brand|Platform|SocialImage/.test(f))) {
      const style = /<style[\s\S]*?<\/style>/.exec(read(file))?.[0] ?? '';
      expect(style.match(/#[0-9a-f]{3,8}\b/gi) ?? [], file).toEqual([]);
    }
  });

  it('leave none unused', () => {
    // Starlight loads the docs' overrides and the theme toggle itself (astro.config.mjs)
    const loadedByConfig = ['components/docs/Head.astro', 'components/docs/Footer.astro', 'components/docs/SiteTitle.astro', 'components/ThemeToggle.astro', 'components/ThemeProvider.astro'];
    for (const file of components.filter((f) => !loadedByConfig.includes(f))) {
      const name = path.basename(file, '.astro');
      const used = everything.some((other) => other !== file && new RegExp(`from '[^']*/${name}\\.astro'`).test(read(other)));
      expect(used, `${file} is not imported anywhere`).toBe(true);
    }
  });

  it('keep the scripts to the few that a behaviour needs', () => {
    const withScript = components.filter((f) => /<script/.test(read(f))).map((f) => path.basename(f, '.astro')).sort();
    // Proofs: its tabs, the line dragged between before and after, the sound switched at the same instant
    expect(withScript).toEqual(['Consent', 'Hero', 'Media', 'Nav', 'Platform', 'ProjectCard', 'Proofs', 'Source', 'ThemeProvider', 'ThemeToggle'].sort());
    expect(withoutScript(read('components/Nav.astro'))).toContain('<details');
  });
});
