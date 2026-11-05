// The editor's icon and its icons as an installed app. Where a system draws no
// ground, the icon is the logo's mark (brand/svg) alone, in the studio theme's
// accent, as a program's icon is: the favicon, the browser-installed app's 'any'
// icons, and the desktop app (Windows, macOS, Linux). Where the system needs a
// tile, it is white, never dark: the white surface of the paper theme
// (brand/theme.css) with the mark in the paper theme's accent on it. That is
// the phones: the maskable icon, Apple's, and the iOS and Android icons of the
// mobile app. Writes apps/editor/icon.svg (the favicon), the PNGs Android,
// Chrome and iOS ask for (apps/editor/icons, served at /icons), and the desktop
// app's two sources in apps/desktop/src-tauri/icons: icon.png (the mark alone,
// 1024 px) and mobile-source.png (the mark on the white tile). build.ts copies
// the editor's and names them in the manifest, whose launch screen is the same
// white.
//
//   node scripts/app-icons.ts
//   cd apps/desktop
//   npx tauri icon src-tauri/icons/icon.png --ios-color "#ffffff"          (the desktop sizes)
//   npx tauri icon src-tauri/icons/mobile-source.png -o <a temp folder> --ios-color "#ffffff"
//     then copy its ios/ and android/ over src-tauri/icons: the phones' icons, on the white tile

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, accent, mark, themeColour } from './brand.ts';

const OUT = path.join(ROOT, 'apps/editor/icons');
const DESKTOP = path.join(ROOT, 'apps/desktop/src-tauri/icons/icon.png');
const MOBILE = path.join(ROOT, 'apps/desktop/src-tauri/icons/mobile-source.png');

const { paths, width, height } = mark();
// the studio's accent: it reads on a dark taskbar and on a light one
const fill = accent('studio');
// the white tile, and the mark that sits on it
const TILE = themeColour('light-surface');
const TILE_FILL = themeColour('light-accent');

// the icon is drawn on a 24-unit box; the mark, `size` units tall, in its middle, on a tile if there is one
// (`radius` rounds the tile: 0 for the squares the systems round themselves)
const art = (size: number, tile?: { radius: number }) => {
  const color = tile ? TILE_FILL : fill;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${tile ? `<rect width="24" height="24" rx="${tile.radius}" fill="${TILE}"/>` : ''}`
    + `<g transform="translate(12 12) scale(${+(size / height).toFixed(5)}) translate(${-width / 2} ${-height / 2})" fill="${color}">${paths.map((d) => `<path d="${d}"/>`).join('')}</g></svg>`;
};

const icon = art(22);
fs.writeFileSync(path.join(ROOT, 'apps/editor/icon.svg'), `${icon}\n`);
console.log('apps/editor/icon.svg');

const ICONS: [string, string, number][] = [
  ['icon-192.png', icon, 192],
  ['icon-512.png', icon, 512],
  // the safe zone is the centred circle of 80 %: the mark keeps well inside it
  ['maskable-512.png', art(12, { radius: 0 }), 512],
  ['apple-touch-icon.png', art(14, { radius: 0 }), 180],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, svg, size] of ICONS) {
  await sharp(Buffer.from(svg), { density: 72 * size / 24 }).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(OUT, name));
  console.log(`${path.relative(ROOT, path.join(OUT, name))} (${size}×${size})`);
}

// the desktop app's source: the mark alone, as the other programs' icons are
await sharp(Buffer.from(art(22)), { density: 72 * 1024 / 24 }).resize(1024, 1024).png({ compressionLevel: 9 }).toFile(DESKTOP);
console.log(`${path.relative(ROOT, DESKTOP)} (1024×1024)`);

// the phones' source: the mark on the white tile, which the system rounds itself
await sharp(Buffer.from(art(14, { radius: 0 })), { density: 72 * 1024 / 24 }).resize(1024, 1024).png({ compressionLevel: 9 }).toFile(MOBILE);
console.log(`${path.relative(ROOT, MOBILE)} (1024×1024)`);
