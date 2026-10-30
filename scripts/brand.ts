// The logo (brand/svg) in the app's colours, for the scripts that draw it
// (app-icons.ts, og-image.ts): the files carry their own teal, replaced by the
// accent of the editor's themes (apps/editor/src/theme/tokens.css), the one
// place those colours are written.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const brand = (file: string) => fs.readFileSync(path.join(ROOT, 'brand/svg', file), 'utf8');
const tokens = fs.readFileSync(path.join(ROOT, 'apps/editor/src/theme/tokens.css'), 'utf8');

/** the teal the brand files are drawn in */
const FILE_FILL = '#63c6c1';

/** the accent of one of the editor's themes ('studio' is dark, 'paper' light) */
export function accent(theme: 'studio' | 'paper'): string {
  const hex = new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{[^}]*?--accent:\\s*(#[0-9a-f]{6})`, 'i').exec(tokens)?.[1];
  if (!hex) throw new Error(`no --accent for the ${theme} theme in apps/editor/src/theme/tokens.css`);
  return hex;
}

/** the mark alone: its paths, and the box they are drawn in */
export function mark(): { paths: string[]; width: number; height: number } {
  const svg = brand('mark-teal.svg');
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
  if (!box || !paths.length) throw new Error('brand/svg/mark-teal.svg: its viewBox and its paths were not found');
  return { paths, width: Number(box[1]), height: Number(box[2]) };
}

/** the mark and the name, white letters, for a dark ground, the mark in `fill` */
export const logoOnDark = (fill: string): string => brand('logo-on-dark.svg').replaceAll(FILE_FILL, fill);
