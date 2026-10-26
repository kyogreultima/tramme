// The math pack's glyph table, converted from the fontTools dump
// (scripts/packs/math_glyphs.py writes it) through the SVG reader: each
// glyph's outline as PathValues on the font's units, y flipped to draw down,
// with its advance and bounds. Writes plugins/math/glyphs.json.
//
//   node scripts/packs/math.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePathData } from '../../packages/interop/src/svg.ts';

const raw = JSON.parse(readFileSync(join(import.meta.dirname, 'math-glyphs-raw.json'), 'utf8'));
const out: { upem: number; glyphs: Record<string, { adv: number; bounds: [number, number, number, number]; v: unknown[] }> } = { upem: raw.upem, glyphs: {} };
for (const [ch, g] of Object.entries(raw.glyphs as Record<string, { adv: number; d: string; bounds: number[] }>)) {
  out.glyphs[ch] = { adv: g.adv, bounds: g.bounds as [number, number, number, number], v: parsePathData(g.d) };
}
writeFileSync(join(import.meta.dirname, '../../plugins/math/glyphs.json'), JSON.stringify(out));
console.log(`math glyphs: ${Object.keys(out.glyphs).length} -> plugins/math/glyphs.json`);
