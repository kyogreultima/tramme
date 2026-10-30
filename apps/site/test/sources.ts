// What the site's tests read of its sources: a page's text and that of every
// component it is made of, to know which ids and links it really has.

import fs from 'node:fs';
import path from 'node:path';

export const SRC = path.join(import.meta.dirname, '../src');
export const read = (file: string) => fs.readFileSync(path.join(SRC, file), 'utf8');

/** a page's source and that of every component it is made of, however deep */
export function sourcesOf(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const source = read(file);
  const next = [...source.matchAll(/from '(\.\.?\/(?:components\/)?[\w-]+\.astro)'/g)]
    .map((m) => path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
  return [source, ...next.flatMap((f) => sourcesOf(f, seen))];
}

/** the ids a page has */
export const idsOf = (file: string) => new Set([...sourcesOf(file).join('\n').matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));

/** the source file of a page of the site, from its address ('/features/' → pages/features.astro) */
export const pageFile = (address: string) => `pages/${address === '/' ? 'index' : address.replace(/\//g, '')}.astro`;
