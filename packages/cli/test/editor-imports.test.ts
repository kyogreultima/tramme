// The render page (src/page.ts) bundles files of the editor (apps/editor/src). The
// renderer's container installs the command line only (apps/renderer/Dockerfile,
// --filter "@tramme/cli..."): the editor's own node_modules are not there, so a
// package the editor's files import resolves from the repository's root. Each
// one must then be among the root's dependencies, or the export in the cloud
// fails to build its page ("Could not resolve @tramme/...").

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

describe('the render page in the renderer container', () => {
  it('finds every workspace package the editor files import at the root', async () => {
    const r = await build({
      entryPoints: [path.join(HERE, '../src/page.ts')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser',
      outdir: path.join(HERE, '.out-imports'), logLevel: 'silent', jsx: 'automatic', jsxImportSource: 'preact',
      loader: { '.ttf': 'file', '.woff2': 'file', '.svg': 'text' },
    });
    const imported = new Set<string>();
    for (const [file, input] of Object.entries(r.metafile.inputs)) {
      if (!file.replaceAll('\\', '/').includes('apps/editor/src/')) continue;
      for (const i of input.imports) {
        const m = /^@tramme\/[^/]+/.exec(i.original ?? '');
        if (m) imported.add(m[0]);
      }
    }
    const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const declared = new Set(Object.keys({ ...root.dependencies, ...root.devDependencies }));
    expect(imported.size).toBeGreaterThan(0);
    expect([...imported].filter((p) => !declared.has(p))).toEqual([]);
  });
});
