// Converts the Lucide icon set (npm pack lucide-static) into the icons pack's
// data file: plugins/icons/lucide.json, one entry per icon with its tags and
// its contours as path d strings on the 24-unit grid. Run from a directory
// holding an extracted lucide-static package:
//
//   npm pack lucide-static            # then extract the tarball beside this repo
//   node scripts/packs/icons.ts <dir-of-package> plugins/icons/lucide.json
//
// The contours come from the same SVG reader the svg-paths tool uses, so what
// the data holds is exactly what a project layer would draw.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { readSvg } from '../../packages/interop/src/svg.ts';
import type { PathValue } from '../../packages/core/src/registry.ts';

const [from = '', out = ''] = process.argv.slice(2);
if (!from || !out) {
  console.error('usage: node scripts/packs/icons.ts <lucide-package-dir> <out.json>');
  process.exit(1);
}

// the version: info.json when the tarball holds one, else the licence header's "v1.2.3"
const version = (() => {
  try { return String(JSON.parse(readFileSync(join(from, 'info.json'), 'utf8')).version ?? ''); } catch { }
  const head = readFileSync(join(from, 'icons', readdirSync(join(from, 'icons')).find((f) => f.endsWith('.svg')) ?? ''), 'utf8');
  return head.match(/v(\d+\.\d+\.\d+)/)?.[1] ?? '0.0.0';
})();
const tags: Record<string, string[]> = JSON.parse(readFileSync(join(from, 'tags.json'), 'utf8'));
/** a contour as compact path value: rounded, its flat tangents dropped */
function compact(p: PathValue): PathValue {
  const r2 = (q: number[]) => q.map((x) => Math.round(x * 100) / 100);
  // one tangent per vertex, padded with zeros; dropped entirely when all of them are flat
  const dense = (list: number[][] | undefined) => {
    const full = (p.v ?? []).map((_, k) => (list?.[k] ?? [0, 0]));
    return full.some((t) => t[0] || t[1]) ? full.map(r2) : undefined;
  };
  return { v: p.v.map(r2), i: dense(p.i), o: dense(p.o), closed: p.closed };
}

const icons: Record<string, { tags: string[]; d: PathValue[] }> = {};
let empty = 0;

for (const file of readdirSync(join(from, 'icons')).sort()) {
  if (!file.endsWith('.svg')) continue;
  const name = basename(file, '.svg');
  const svg = readFileSync(join(from, 'icons', file), 'utf8');
  const { shapes } = readSvg(svg);
  const d = shapes.map((sh) => compact(sh.path)).filter((p) => p.v.length > 1);
  if (!d.length) { empty++; continue; }
  icons[name] = { tags: tags[name] ?? [], d };
}

const json = {
  source: 'lucide',
  version,
  licence: 'ISC',
  grid: 24,
  stroke: 2,
  count: Object.keys(icons).length,
  icons,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(json));
console.log(`lucide ${json.version}: ${json.count} icons (${empty} empty left out), ${tags && Object.keys(tags).length} tagged -> ${out}`);
