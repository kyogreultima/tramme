// The logo's mark in the app's accent, for what cannot take the page's CSS: the
// favicon (pages/icon.svg.ts) and the home-screen PNGs (pages/icons). The
// colours are read from the theme (styles/theme.css), the one place they are
// written: the paper theme's accent, and the studio theme's for dark tabs and
// the PNGs.

import theme from '../styles/theme.css?raw';
import mark from '../../../../brand/svg/mark-teal.svg?raw';

/** the brand file's own fill, replaced by the accent */
const FILE_FILL = '#63c6c1';

const token = (selector: string, name: string): string => {
  const hex = new RegExp(`${selector}\\s*\\{[^}]*?${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(theme)?.[1];
  if (!hex) throw new Error(`no ${name} in ${selector} of styles/theme.css`);
  return hex;
};

const DARK = ":root\\[data-theme='dark'\\]";
const light = token(':root', '--accent');
const dark = token(DARK, '--accent');

/** the mark in the studio theme's accent (the PNGs: it shows on a dark ground and on none) */
export const markDark = mark.replaceAll(FILE_FILL, dark);

/** the studio theme's ground, the one the home-screen icon sits on */
export const ground = token(DARK, '--bg');

/** the mark in the paper theme's accent, in the studio theme's on a dark tab or window */
export const markAdaptive = mark
  .replaceAll(FILE_FILL, light)
  .replace('</style>', `@media (prefers-color-scheme: dark) { .cls-1 { fill: ${dark}; } } </style>`);
