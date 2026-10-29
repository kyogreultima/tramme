// The files of a family at the pinned Fontsource version: where to fetch them
// (jsDelivr) and where they land in a project. The same version for every
// film, as the kits' fonts are, so a project stays reproducible.

import type { Typeface } from './catalogue.ts';

export const FONTSOURCE_PIN = '5.3.0';
const CDN = 'https://cdn.jsdelivr.net/fontsource/fonts';
/** the scripts Fontsource cuts into slices: no variable file exists for them, only the static weights */
const SLICED = /^(japanese|korean|chinese-)/;

/** a lower-case name for ids and file names: runs of other characters become one dash */
export function slugOf(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
}

export interface FontFile { url: string; path: string; weight: string; style: 'normal' | 'italic' }

/** the weight the family has that is nearest to w (the heavier one when two are as near) */
const nearest = (weights: number[], w: number) => weights.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) || (Math.abs(x - w) === Math.abs(best - w) && x > best) ? x : best));

/** the weights a role needs: a display face in its heaviest sensible weight, a text face in regular and bold */
export function defaultWeights(f: Typeface, role: 'display' | 'text'): number[] {
  if (role === 'display') return [Math.max(...f.weights.filter((w) => w <= 800), Math.min(...f.weights))];
  return [...new Set([nearest(f.weights, 400), nearest(f.weights, 700)])].sort((a, b) => a - b);
}

/**
 * the files to fetch for a family: a variable one is a single file per style
 * holding the whole weight range (`wght`, or `full` for the families that
 * publish every axis), a static one a file per requested weight (the nearest
 * the family has)
 */
export function fontFiles(f: Typeface, want: { weights?: number[]; italic?: boolean; subset?: string }): FontFile[] {
  const subset = want.subset ?? (f.subsets.includes('latin') ? 'latin' : f.subsets[0]);
  const slug = slugOf(f.family);
  const styles: ('normal' | 'italic')[] = want.italic && f.italic ? ['normal', 'italic'] : ['normal'];
  const range = f.axes?.wght;
  if (range && !SLICED.test(subset)) {
    const axes = Object.keys(f.axes!).length > 3 ? 'full' : 'wght';
    return styles.map((style) => ({ url: `${CDN}/${f.id}:vf@${FONTSOURCE_PIN}/${subset}-${axes}-${style}.woff2`, path: `assets/fonts/${slug}-${subset}-vf-${style}.woff2`, weight: `${range[0]} ${range[1]}`, style }));
  }
  const weights = [...new Set((want.weights?.length ? want.weights : defaultWeights(f, 'text')).map((w) => nearest(f.weights, w)))].sort((a, b) => a - b);
  return weights.flatMap((w) => styles.map((style) => ({ url: `${CDN}/${f.id}@${FONTSOURCE_PIN}/${subset}-${w}-${style}.woff2`, path: `assets/fonts/${slug}-${subset}-${w}-${style}.woff2`, weight: String(w), style })));
}
