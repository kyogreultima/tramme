// The words of a query, read the same way by every search of the editor (the
// typefaces, the references): lower case, accents kept, plurals folded, the
// grammar words that say nothing dropped.

/** words that carry no meaning in any query */
export const FILLER = new Set(['a', 'an', 'the', 'for', 'of', 'with', 'and', 'or', 'in', 'to', 'on', 'my', 'some', 'that', 'is', 'it', 'its', 'but', 'not', 'no', 'we', 'i', 'need', 'want', 'use', 'used', 'from', 'by', 'as', 'at', 'be', 'this', 'something', 'one', 'between', 'about', 'what', 'how', 'when', 'where', 'which', 'who', 'your', 'our', 'you', 'they', 'are', 'was', 'do', 'does', 'can', 'will', 'make', 'made', 'more', 'very', 'quite']);

/** the singulars a word may be the plural of, loosest first: stories to story, boxes to box and boxe, scenes to scene */
export function pluralForms(raw: string): string[] {
  const out: string[] = [];
  if (raw.endsWith('ies') && raw.length > 4) out.push(`${raw.slice(0, -3)}y`);
  if (raw.endsWith('s') && !raw.endsWith('ss')) out.push(raw.slice(0, -1));
  if (raw.endsWith('es') && raw.length > 3) out.push(raw.slice(0, -2));
  return out;
}

/** one singular for a word, chosen by its ending: stories to story, boxes to box, scenes to scene; glass and class stay */
export function foldPlural(w: string): string {
  if (w.length < 4) return w;
  if (/(ss|us|is)$/.test(w)) return w;
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(x|ch|sh|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/** the words of a query: lower case, split on anything that is not a letter or a digit, plurals folded, filler dropped (more filler may be given) */
export function queryWords(query: string, extraFiller?: ReadonlySet<string>): string[] {
  return query.toLowerCase().split(/[^a-z0-9À-ɏ]+/).filter(Boolean)
    .filter((w) => !FILLER.has(w) && !extraFiller?.has(w))
    .map(foldPlural);
}

/** the number of single-letter edits between two short words */
export function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
