// Search of the references by words: pure functions over the catalogue.

import { distance, queryWords } from '../words.ts';
import { REF_TAGS, type Reference } from './catalogue.ts';

/** the words a tag answers to: kinetic-type to kinetic and type, 3d to 3d */
const tagWords = (tag: string) => tag.split('-');

/**
 * The entries that answer a query, best first: a tag named in it counts two, a
 * word of the title two, a word of the text one. A query that matches nothing
 * (or is only filler) gets the entries of the tag nearest by name, said by
 * `closest`, never an empty list.
 */
export function searchReferences(refs: Reference[], query: string, o: { kind?: Reference['kind']; tags?: string[]; count?: number } = {}): { found: Reference[]; closest: boolean } {
  const count = Math.max(1, Math.min(o.count ?? 4, 8));
  const pool = refs.filter((r) => (!o.kind || r.kind === o.kind) && (!o.tags?.length || o.tags.every((t) => r.tags.includes(t))));
  const words = queryWords(query);
  const scored = pool.map((r) => {
    const title = new Set(queryWords(r.title)), text = new Set(queryWords([r.text, r.see, r.fix].filter(Boolean).join(' ')));
    let score = 0;
    for (const w of words) {
      if (r.tags.some((t) => tagWords(t).includes(w) || t === w)) score += 2;
      if (title.has(w)) score += 2;
      if (text.has(w)) score += 1;
    }
    return { r, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || (a.r.id < b.r.id ? -1 : 1));
  if (scored.length) return { found: scored.slice(0, count).map((x) => x.r), closest: false };
  // nothing matched: the tag nearest by name to any word of the query, else the first tag with entries
  const used = REF_TAGS.filter((t) => pool.some((r) => r.tags.includes(t)));
  const near = [...used].sort((a, b) => Math.min(...(words.length ? words : ['']).map((w) => distance(w, a))) - Math.min(...(words.length ? words : ['']).map((w) => distance(w, b))))[0];
  const found = pool.filter((r) => near && r.tags.includes(near)).slice(0, count);
  return { found: found.length ? found : pool.slice(0, count), closest: true };
}
