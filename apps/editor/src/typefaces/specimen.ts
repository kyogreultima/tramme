// The specimen sheet: the families found, each set in its own letters by the
// same text path the engine renders with (a 2D canvas and the font files that
// will be copied into the project), so the model chooses by looking, not by
// the names. The layout is a pure function; only the drawing touches the browser.

import { t } from '../i18n/index.ts';
import type { Typeface } from './catalogue.ts';
import { defaultWeights, fontFiles } from './files.ts';
import { scriptsOf } from './search.ts';

export interface SpecimenLine { text: string; font: string; size: number; y: number }
export interface SpecimenCell { id: string; label: string; x: number; y: number; w: number; h: number; lines: SpecimenLine[] }
export interface SpecimenPlan { w: number; h: number; cells: SpecimenCell[] }

const PAD = 24, GAP = 16, INSET = 20, CELL_H = 250, MAX_CELLS = 6;
const LARGE = 64, READING = 22, FIGURES = 26, LABEL = 14;
const SAMPLE = 'Aa Gg Rr 24', READING_SAMPLE = 'Quick brown fox jumps over the lazy dog', FIGURES_SAMPLE = '0123456789 · 40 € · 12,50 %';
/** a letter is about this wide, in em, on average: enough to cut a line before drawing it */
const EM = 0.55;

/** the text cut with an ellipsis when it would run past `width` at that size */
const clip = (text: string, size: number, width: number) => {
  const fits = Math.max(1, Math.floor(width / (size * EM)));
  const letters = [...text];
  return letters.length <= fits ? text : `${letters.slice(0, Math.max(1, fits - 1)).join('').trimEnd()}…`;
};

const face = (f: Typeface, weight: number, size: number) => `${weight} ${size}px "${f.family}", sans-serif`;

export function specimenPlan(fonts: Typeface[], opts: { text?: string; width?: number }): SpecimenPlan {
  const shown = fonts.slice(0, MAX_CELLS);
  const w = opts.width ?? 1200;
  const cellW = Math.floor((w - 2 * PAD - GAP) / 2);
  const inner = cellW - 2 * INSET;
  const text = opts.text?.trim();
  const rows = Math.ceil(shown.length / 2);
  const cells = shown.map((f, i): SpecimenCell => {
    const display = defaultWeights(f, 'display')[0], regular = defaultWeights(f, 'text')[0];
    return {
      id: f.id, label: f.family,
      x: PAD + (i % 2) * (cellW + GAP), y: PAD + Math.floor(i / 2) * (CELL_H + GAP), w: cellW, h: CELL_H,
      lines: [
        { text: f.family, font: `500 ${LABEL}px sans-serif`, size: LABEL, y: 16 },
        { text: clip(text ?? SAMPLE, LARGE, inner), font: face(f, display, LARGE), size: LARGE, y: 44 },
        { text: clip(text ?? READING_SAMPLE, READING, inner), font: face(f, regular, READING), size: READING, y: 140 },
        { text: FIGURES_SAMPLE, font: face(f, regular, FIGURES), size: FIGURES, y: 184 },
      ],
    };
  });
  return { w, h: rows ? 2 * PAD + rows * CELL_H + (rows - 1) * GAP : 0, cells };
}

const WAIT = 5000;

/** the family's faces for the sheet (the heavy one and the regular one), registered with the page; rejects when one does not arrive */
async function load(f: Typeface, subset: string): Promise<void> {
  const weights = [...new Set([...defaultWeights(f, 'display'), ...defaultWeights(f, 'text')])];
  const faces = fontFiles(f, { weights, subset }).map((file) => new FontFace(f.family, `url(${file.url})`, { weight: file.weight, style: file.style }));
  await Promise.all(faces.map((x) => Promise.race([x.load(), new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), WAIT))])));
  for (const x of faces) document.fonts.add(x);
}

/** the sheet as a JPEG data URL, and the families whose files could not be loaded (their cell says so) */
export async function specimenSheet(fonts: Typeface[], opts: { text?: string }): Promise<{ url: string; failed: string[] }> {
  const plan = specimenPlan(fonts, opts);
  const subset = scriptsOf(opts.text ?? '').find((s) => s !== 'latin') ?? 'latin';
  const missing = new Set<string>();
  await Promise.all(plan.cells.map((cell) => load(fonts.find((f) => f.id === cell.id)!, subset).catch(() => { missing.add(cell.id); })));
  // loaded on first use: the sheet is the only thing here that needs the browser's canvas
  const { canvas } = await import('../perception.ts');
  const { c, g } = canvas(plan.w, Math.max(plan.h, 1));
  g.fillStyle = '#0b0f12'; g.fillRect(0, 0, c.width, c.height);
  g.textBaseline = 'top';
  for (const cell of plan.cells) {
    g.fillStyle = '#161c21'; g.fillRect(cell.x, cell.y, cell.w, cell.h);
    const failed = missing.has(cell.id);
    cell.lines.forEach((line, i) => {
      if (failed && i > 0) return;
      g.font = line.font;
      g.fillStyle = i === 0 ? '#9aa5ad' : '#ffffff';
      g.fillText(line.text, cell.x + INSET, cell.y + line.y, cell.w - 2 * INSET);
    });
    if (failed) { g.font = `500 ${READING}px sans-serif`; g.fillStyle = '#f5a3a3'; g.fillText(t('typefaces.couldNotLoad'), cell.x + INSET, cell.y + 56); }
  }
  return { url: c.toDataURL('image/jpeg', 0.9), failed: fonts.filter((f) => missing.has(f.id)).map((f) => f.family) };
}
