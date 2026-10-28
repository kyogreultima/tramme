// The project's media sorted and found: bins (a name each asset may carry),
// tags, and a search over names, files, bins, tags and what is said in a
// clip. Pure: the panel reads what is said from the transcripts it loaded.

import { pointer, type Asset, type Op, type TrammeDoc } from '@tramme/core';

export interface AssetFilter {
  /** a bin's name; the empty name is the media in no bin; undefined is every bin */
  bin?: string;
  tag?: string;
  /** words that must all be found; a word starting with # asks for a tag */
  text?: string;
}

/** a tag as it is kept: lower case, spaces made dashes */
export const normTag = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-');

/** the bins in use, by name */
export const binsOf = (doc: TrammeDoc): string[] => [...new Set(Object.values(doc.assets).map((a) => a.bin).filter((b): b is string => !!b))].sort((a, b) => a.localeCompare(b));

/** the tags in use, with the number of media carrying each, by name */
export function tagsOf(doc: TrammeDoc): [string, number][] {
  const count = new Map<string, number>();
  for (const a of Object.values(doc.assets)) for (const tag of a.tags ?? []) count.set(tag, (count.get(tag) ?? 0) + 1);
  return [...count].sort((a, b) => a[0].localeCompare(b[0]));
}

/** the assets that pass the filter, in the project's order; `spoken` gives what is said in a clip when its transcript is known */
export function filterAssets(doc: TrammeDoc, f: AssetFilter, spoken: (id: string) => string | undefined = () => undefined): [string, Asset][] {
  const words = (f.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return Object.entries(doc.assets).filter(([id, a]) => {
    if (f.bin !== undefined && (a.bin ?? '') !== f.bin) return false;
    if (f.tag !== undefined && !(a.tags ?? []).includes(f.tag)) return false;
    const hay = [id, a.name, a.src, a.bin, ...(a.tags ?? []), spoken(id)].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => (w.startsWith('#') ? (a.tags ?? []).includes(normTag(w.slice(1))) : hay.includes(w)));
  });
}

/** media put in a bin (an empty name takes them out of theirs); nothing for those already there */
export function setBinOps(doc: TrammeDoc, ids: string[], bin: string): Op[] {
  const name = bin.trim();
  return ids.filter((id) => doc.assets[id] && (doc.assets[id].bin ?? '') !== name).map((id): Op => (name
    ? { op: 'add', path: pointer('assets', id, 'bin'), value: name }
    : { op: 'remove', path: pointer('assets', id, 'bin') }));
}

/** tags put on media, once each, after the ones they have */
export function addTagsOps(doc: TrammeDoc, ids: string[], tags: string[]): Op[] {
  const add = [...new Set(tags.map(normTag).filter(Boolean))];
  return ids.filter((id) => doc.assets[id]).flatMap((id): Op[] => {
    const has = doc.assets[id].tags ?? [], next = [...has, ...add.filter((x) => !has.includes(x))];
    return next.length === has.length ? [] : [{ op: 'add', path: pointer('assets', id, 'tags'), value: next }];
  });
}

/** a tag taken off media (the field goes with their last tag) */
export function removeTagOps(doc: TrammeDoc, ids: string[], tag: string): Op[] {
  return ids.filter((id) => doc.assets[id]?.tags?.includes(tag)).map((id): Op => {
    const next = doc.assets[id].tags!.filter((x) => x !== tag);
    return next.length ? { op: 'add', path: pointer('assets', id, 'tags'), value: next } : { op: 'remove', path: pointer('assets', id, 'tags') };
  });
}
