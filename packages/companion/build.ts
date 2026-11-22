// The published companion, `npx @qualris/tramme` (the command `tramme` once installed): one bundled file (Tramme's own packages inside it) and the
// dependencies npm installs beside it, in dist/, ready for `npm publish packages/companion/dist`.
//   node packages/companion/build.ts

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { ENVIRONMENTS } from '../../brand/environments.ts';
import { COMPANION_PACKAGE } from '@tramme/assistant';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'dist');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const own = read(path.join(HERE, 'package.json'));
const root = read(path.join(ROOT, 'package.json'));

/** what npm installs: the companion's dependencies, Tramme's own packages aside (they are bundled) */
const dependencies = Object.fromEntries(Object.entries(own.dependencies as Record<string, string>).filter(([, v]) => !v.startsWith('workspace:')));

fs.rmSync(OUT, { recursive: true, force: true });
await esbuild.build({
  entryPoints: [path.join(HERE, 'src/bin.ts')],
  outfile: path.join(OUT, 'bin/tramme.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  // transformers.js is installed on first use (speech.ts)
  external: [...Object.keys(dependencies), '@huggingface/transformers'],
  legalComments: 'none', logLevel: 'warning',
});

const site = ENVIRONMENTS.production.site;
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({
  name: COMPANION_PACKAGE,
  version: own.version,
  description: "Tramme's local companion: the editor's assistant with the agents of this computer (Claude Code, Codex, Antigravity), each on its own login",
  keywords: ['tramme', 'motion design', 'video', 'assistant', 'claude', 'codex', 'antigravity'],
  homepage: site,
  // npm checks the package's provenance against it: published from a run of another repository, it is refused
  repository: { ...root.repository, directory: 'packages/companion' },
  license: own.license,
  author: root.author,
  type: 'module',
  bin: { tramme: 'bin/tramme.mjs' },
  files: ['bin', 'README.md', 'LICENSE'],
  engines: { node: '>=20' },
  // a scoped package is private by default on npm
  publishConfig: { access: 'public' },
  dependencies,
}, null, 2) + '\n');
fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(OUT, 'LICENSE'));
fs.writeFileSync(path.join(OUT, 'README.md'), fs.readFileSync(path.join(HERE, 'README.md'), 'utf8').replaceAll('{{site}}', site));
console.log(`${COMPANION_PACKAGE} ${own.version} built in ${path.relative(ROOT, OUT)} (${(fs.statSync(path.join(OUT, 'bin/tramme.mjs')).size / 1024).toFixed(0)} KB)`);
