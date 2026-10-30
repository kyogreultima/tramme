import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(import.meta.dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** the package.json of the repository and of each of its workspaces */
const manifests = ['package.json', ...['apps', 'packages'].flatMap((dir) => fs.readdirSync(path.join(ROOT, dir))
  .map((name) => `${dir}/${name}/package.json`)
  .filter((file) => fs.existsSync(path.join(ROOT, file))))];

/** every source file of the site, whose words must not call Tramme open source */
function sources(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const file = `${dir}/${e.name}`;
    if (e.isDirectory()) return sources(file);
    return /\.(astro|ts)$/.test(e.name) ? [file] : [];
  });
}

describe('the licence of the versions after 0.16.0', () => {
  it('is the Functional Source License, with its licensor and its year filled in', () => {
    const licence = read('LICENSE');
    expect(licence).toContain('Functional Source License, Version 1.1, ALv2 Future License');
    expect(licence).toContain('Copyright 2026 Aziz Chanou');
    expect(licence).not.toContain('${');
  });

  it('leaves the Apache licence beside it, for the versions up to 0.16.0 and the contributions that keep it', () => {
    expect(read('LICENSE-APACHE')).toContain('Apache License');
    expect(read('LICENSE-APACHE')).toContain('0.16.0');
  });

  it.each(manifests)('%s names it', (file) => {
    expect(JSON.parse(read(file)).license).toBe('FSL-1.1-ALv2');
  });

  it('asks contributors to sign off what they send, under that licence', () => {
    const contributing = read('CONTRIBUTING.md');
    expect(contributing).toContain('Signed-off-by');
    expect(contributing).toContain('Functional Source License');
  });
});

describe('the words that present Tramme', () => {
  // the Functional Source License is "source available", not open source: the term is the Open Source Initiative's
  it.each(['README.md', 'CONTRIBUTING.md', ...sources('apps/site/src')])('%s does not call it open source', (file) => {
    expect(read(file)).not.toMatch(/open[- ]source/i);
  });
});
