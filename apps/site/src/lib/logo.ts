// The logo's mark in the app's accent, for what cannot take the page's CSS: the
// favicon (pages/icon.svg.ts) and the home-screen PNGs (pages/icons). The
// colours are read from brand/theme.css, shared with the application.

import theme from '../../../../brand/theme.css?raw';
import mark from '../../../../brand/svg/mark-teal.svg?raw';

/** the brand file's own fill, replaced by the accent */
const FILE_FILL = '#63c6c1';

const token = (name: string): string => {
  const hex = new RegExp(`--tramme-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(theme)?.[1];
  if (!hex) throw new Error(`no ${name} in brand/theme.css`);
  return hex;
};

const light = token('light-accent');
const dark = token('dark-accent');

/** the mark in the studio theme's accent (the PNGs: it shows on a dark ground and on none) */
export const markDark = mark.replaceAll(FILE_FILL, dark);

/** the studio theme's ground: the page's, as the browser's bar shows it */
export const ground = token('dark-bg');

/** the white tile the home-screen icon sits on (the paper theme's surface), and the mark in the paper theme's accent on it */
export const tile = token('light-surface');
export const markOnTile = mark.replaceAll(FILE_FILL, light);

/** the mark in the paper theme's accent, in the studio theme's on a dark tab or window */
export const markAdaptive = mark
  .replaceAll(FILE_FILL, light)
  .replace('</style>', `@media (prefers-color-scheme: dark) { .cls-1 { fill: ${dark}; } } </style>`);
