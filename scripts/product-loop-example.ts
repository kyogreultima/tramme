// Package the editable source study into a portable .tramme archive.
// node scripts/product-loop-example.ts [output.tramme]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProject, DOCUMENT, MANIFEST, newProject, packProject } from '@tramme/project';
import { builtinRegistry } from '@tramme/nodes';
import { validate } from '@tramme/core';
import type { TrammeDoc } from '@tramme/core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'examples/product-loop');
const doc: TrammeDoc = JSON.parse(fs.readFileSync(path.join(source, DOCUMENT), 'utf8'));
doc.assets['motion-loops'].src = 'plugins/motion-loops.js';
doc.assets['film-plan'] = { type: 'json', src: 'assets/film-plan.json' };
const { manifest } = newProject({ name: doc.meta?.title ?? 'ARC', width: 960, height: 540, fps: 30, duration: 6 });
const files = new Map<string, Uint8Array>([
  [MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2))],
  [DOCUMENT, Buffer.from(JSON.stringify(doc, null, 2))],
  ['assets/film-plan.json', fs.readFileSync(path.join(source, 'assets/film-plan.json'))],
  ['plugins/motion-loops.js', fs.readFileSync(path.join(root, 'plugins/motion-loops.js'))],
]);
const issues = checkProject(files).issues;
const loops = await import('../plugins/motion-loops.js');
const invalid = validate(doc, builtinRegistry().clone().use(loops as never, 'motion-loops.js'));
if (issues.length || invalid.length) throw new Error(JSON.stringify([...issues, ...invalid]));
const out = path.resolve(process.argv[2] ?? path.join(root, 'out/product-loop/arc.tramme'));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, packProject(files));
console.log(`Wrote ${path.relative(root, out)} (self-contained editable project).`);
