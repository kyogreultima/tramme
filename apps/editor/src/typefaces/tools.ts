// Typefaces as tools of the editor's vocabulary: `typefaces` looks for open
// families by character and shows them on a specimen sheet; `typeface-use`
// brings the chosen ones into the project as font assets, their files at a
// pinned version beside a record of where they come from. The assistant runs
// them (use_tool), the user too (/ menu); the document changes only through
// the operations they return.

import type { Op, ToolType } from '@tramme/core';
import { pointer } from '@tramme/core';
import { t } from '../i18n/index.ts';
import { loadCatalogue, type Typeface } from './catalogue.ts';
import { FONTSOURCE_PIN, defaultWeights, fontFiles, slugOf, type FontFile } from './files.ts';
import { findFamily, scriptsOf, searchTypefaces } from './search.ts';
import { specimenSheet } from './specimen.ts';

const range = (weights: number[]) => (weights.length > 1 ? `${weights[0]}-${weights[weights.length - 1]}` : String(weights[0]));

/** one line of a list: what the assistant needs to choose and to bring the family in */
function describe(f: Typeface): string {
  const axes = f.axes ? ` (variable: ${Object.entries(f.axes).slice(0, 4).map(([n, [lo, hi]]) => `${n} ${lo}-${hi}`).join(', ')})` : '';
  return [
    `- ${f.id} · ${f.family} · ${f.category} · weights ${range(f.weights)}${axes}${f.italic ? ' + italic' : ''}`,
    `tags ${f.tags.filter((x) => x !== 'variable' && x !== 'italic').join(', ') || 'none'}`,
    ...(f.for ? [`good for ${f.for.join(', ')}`] : []),
    ...(f.pairs ? [`pairs with ${f.pairs.join(', ')}`] : []),
    `scripts ${f.subsets.filter((s) => !/-ext$/.test(s)).slice(0, 6).join(', ')}`,
    f.license,
    ...(f.note ? [f.note] : []),
  ].join(' · ');
}

const typefaces: ToolType<{ query: string; text?: string; category?: string; count?: number }> = {
  name: 'typefaces', title: 'Typefaces', description: 'looks for open typefaces by character ("condensed grotesque, heavy, for titles"), lists the families found and shows them on a specimen sheet set in their own letters',
  input: {
    type: 'object',
    properties: {
      query: { type: 'string', title: 'Character', description: 'two or three words: the shape (condensed, serif, slab, mono, rounded, handwritten), the weight (heavy, light), the feel (elegant, playful, techno, editorial, friendly, neutral), the use (titles, body, ui, quote, numbers)' },
      text: { type: 'string', title: 'Text', description: 'the words that will be set in it, so only families whose letters cover them come back (accents, Cyrillic, Greek, Arabic, Hebrew, Japanese…)' },
      category: { type: 'string', title: 'Kind', description: 'keep to one kind: sans-serif, serif, display, monospace or handwriting' },
      count: { type: 'integer', title: 'How many', description: 'families to show, 1 to 6 (4 by default)', minimum: 1, maximum: 6 },
    },
    required: ['query'],
  },
  ai: {
    when: 'when a film has no typeface yet, or the user asks for a style of lettering, before the first title is built; look at the sheet, then bring the one or two families chosen in with typeface-use',
    avoid: 'choosing a family by its name alone; leaving the system font; more than two families in one film',
  },
  async run(a) {
    const catalogue = await loadCatalogue();
    const count = Math.max(1, Math.min(Math.round(a.count ?? 4), 6));
    const found = searchTypefaces(catalogue, a.query, { text: a.text, category: a.category as Typeface['category'] | undefined, count });
    if (!found.found.length) {
      const need = scriptsOf(a.text ?? '');
      return { text: `No family in the catalogue covers every script of that text${need.length ? ` (it needs ${need.join(', ')})` : ''}${a.category ? ` in the kind ${a.category}` : ''}. Ask again with one script, or without the kind.` };
    }
    const lines = [`Families for "${a.query}"${a.text ? ` that cover "${a.text}"` : ''}:`];
    if (found.unknown.length) lines.push(`I did not know the words ${found.unknown.join(', ')} (shape: condensed, wide, serif, slab, mono, rounded, handwritten; weight: heavy, light; feel: elegant, playful, techno, editorial, friendly, neutral; use: titles, body, ui, quote, numbers).`);
    if (found.closest) lines.push('Nothing matches exactly: these are the closest.');
    lines.push(...found.found.map((x) => describe(x.font)));
    const fonts = found.found.map((x) => x.font);
    try {
      const sheet = await specimenSheet(fonts, { text: a.text });
      if (sheet.failed.length) lines.push(`could not load: ${sheet.failed.join(', ')}`);
      lines.push('Look at the sheet, choose one or two (a display face for titles, a text face for the rest), then bring them in with typeface-use.');
      return { text: lines.join('\n'), images: [{ url: sheet.url, caption: t('typefaces.sheet') }] };
    } catch (e) {
      lines.push(`The specimen sheet could not be drawn (${(e as Error).message}): choose from the list.`);
      return { text: lines.join('\n') };
    }
  },
};

/** the asset id of a file: the family, its script when not Latin, its weight when static and not regular, italic */
function assetIdOf(f: Typeface, file: FontFile, subset: string): string {
  const variable = file.weight.includes(' ');
  return ['font', slugOf(f.family), subset === 'latin' ? '' : subset, variable || file.weight === '400' ? '' : file.weight, file.style === 'italic' ? 'italic' : ''].filter(Boolean).join('-');
}

interface FontRecord { family: string; id: string; license: string; source: 'fontsource'; version: string; files: { path: string; weight: string; style: string; subset: string }[]; roles: string[] }

const typefaceUse: ToolType<{ family: string; role: 'display' | 'text'; weights?: number[]; italic?: boolean; script?: string }> = {
  name: 'typeface-use', title: 'Use a typeface', description: 'brings a typeface into the project: its files are fetched at a pinned version and kept under assets/fonts with a record of where they come from, and added as font assets that layers take as their font',
  input: {
    type: 'object',
    properties: {
      family: { type: 'string', title: 'Family', description: 'the id or the name given by the typefaces tool (inter, "Bebas Neue")' },
      role: { type: 'string', title: 'Role', enum: ['display', 'text'], description: 'display: the face of titles, in its heaviest sensible weight; text: the face of everything else, in regular and bold' },
      weights: { type: 'array', items: { type: 'integer' }, title: 'Weights', description: 'static families only: the weights to bring in (the role\'s usual ones by default); a variable family always comes whole' },
      italic: { type: 'boolean', title: 'Italic', description: 'also bring the italic, when the family has one' },
      script: { type: 'string', title: 'Script', description: 'the subset of letters when the text is not Latin: cyrillic, greek, arabic, hebrew, devanagari, thai, japanese, korean, chinese-simplified, latin-ext, vietnamese' },
    },
    required: ['family', 'role'],
  },
  ai: {
    when: 'after looking at the specimen sheet, for the one or two families chosen: a display face for the titles and a text face for the rest, never more than two',
    avoid: 'bringing a family in without having looked at it; a third family',
  },
  async run(a, ctx) {
    const catalogue = await loadCatalogue();
    const found = findFamily(catalogue, a.family);
    if (!found.font) return { text: `No family called "${a.family}" in the catalogue. The closest ids: ${found.closest.join(', ')}. Use the id the typefaces tool gave.` };
    const font = found.font;
    const subset = a.script ?? (font.subsets.includes('latin') ? 'latin' : font.subsets[0]);
    if (!font.subsets.includes(subset)) return { text: `${font.family} has no ${subset} letters (it has ${font.subsets.join(', ')}). Search again with the text so only families that cover it come back.` };

    const files = fontFiles(font, { weights: a.weights ?? defaultWeights(font, a.role), italic: a.italic, subset }).map((file) => ({ file, id: assetIdOf(font, file, subset) }));
    const fresh = files.filter((x) => !ctx.doc.assets[x.id]);
    if (!fresh.length) return { text: `${font.family} is already in the project as ${files.map((x) => x.id).join(', ')}; nothing was fetched.` };

    // every file is downloaded before any is written: a family is either all there or not at all
    let blobs: Blob[];
    try {
      blobs = await Promise.all(fresh.map(async ({ file }) => {
        const r = await fetch(file.url, { signal: ctx.signal });
        if (!r.ok) throw new Error(`${file.path.split('/').pop()}: HTTP ${r.status}`);
        return r.blob();
      }));
    } catch (e) {
      return { text: `${font.family} could not be brought in (${(e as Error).message}). Nothing was changed; try again, or choose another family.` };
    }

    const ops: Op[] = [];
    const written: string[] = [];
    for (const [i, { file, id }] of fresh.entries()) {
      const src = await ctx.writeFile(file.path, blobs[i]);
      written.push(src);
      ops.push({ op: 'add', path: pointer('assets', id), value: { type: 'font', src, family: font.family, name: `${font.family} (${a.role})`, weight: file.weight, ...(file.style === 'italic' ? { style: 'italic' } : {}) } });
    }
    const recordPath = `assets/fonts/${slugOf(font.family)}.json`;
    const before: FontRecord | null = await ctx.readText(recordPath).then((s) => (s ? JSON.parse(s) : null), () => null);
    const record: FontRecord = {
      family: font.family, id: font.id, license: font.license, source: 'fontsource', version: FONTSOURCE_PIN,
      files: [...(before?.files ?? []).filter((x) => !fresh.some(({ file }) => file.path === x.path)), ...fresh.map(({ file }) => ({ path: file.path, weight: file.weight, style: file.style, subset }))],
      roles: [...new Set([...(before?.roles ?? []), a.role])],
    };
    await ctx.writeFile(recordPath, JSON.stringify(record, null, 2));

    const ids = fresh.map((x) => x.id);
    return {
      ops, label: `Typeface ${font.family}`,
      text: `${font.family} brought in as the ${a.role} face: ${ids.map((id, i) => `${id} (weight ${fresh[i].file.weight}${fresh[i].file.style === 'italic' ? ', italic' : ''})`).join(', ')}. Files ${written.join(', ')}; licence ${font.license}, recorded in ${recordPath}.${font.note ? ` Note: ${font.note}.` : ''} Set a layer's font property to the asset id (a display face for titles, a text face for the rest); a text layer in a weight whose asset is another id needs that id as its font.`,
    };
  },
};

export const TYPEFACE_TOOLS: ToolType[] = [typefaces, typefaceUse];
