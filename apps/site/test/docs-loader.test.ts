import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rewriteLinks } from '../src/lib/docs-loader';
import { REPO } from '../src/lib/links';

const ROOT = pathToFileURL(path.join(import.meta.dirname, '../../../') + path.sep);
const CHANGELOG = { slug: 'changelog', label: 'Changelog', file: 'CHANGELOG.md' };

describe('the links of a page made from the repository\'s Markdown', () => {
  it('that leave the repository\'s files lead where GitHub would take them', () => {
    expect(rewriteLinks('[0.16.0](../../compare/v0.15.1...v0.16.0)', CHANGELOG, ROOT)).toBe(`[0.16.0](${REPO}/compare/v0.15.1...v0.16.0)`);
  });

  it('written as reference definitions are rewritten the same way', () => {
    const md = '## [0.16.0] - 2026-10-30\n\n[0.16.0]: ../../compare/v0.15.1...v0.16.0\n[0.1.0]: ../../releases/tag/v0.1.0';
    const out = rewriteLinks(md, CHANGELOG, ROOT);
    expect(out).toContain(`[0.16.0]: ${REPO}/compare/v0.15.1...v0.16.0`);
    expect(out).toContain(`[0.1.0]: ${REPO}/releases/tag/v0.1.0`);
  });

  it('are left alone in a code block', () => {
    const md = '```md\n[0.16.0]: ../../compare/v0.15.1...v0.16.0\n```';
    expect(rewriteLinks(md, CHANGELOG, ROOT)).toBe(md);
  });

  it('to a file of the repository keep going to GitHub, or to the docs page that holds it', () => {
    expect(rewriteLinks('[roadmap](docs/packs-roadmap.md)', CHANGELOG, ROOT)).toBe('[roadmap](/docs/roadmaps/packs/)');
    expect(rewriteLinks('[licence](LICENSE)', CHANGELOG, ROOT)).toBe(`[licence](${REPO}/blob/main/LICENSE)`);
  });
});
