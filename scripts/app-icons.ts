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
// 1024 px), mobile-source.png (the mark on the white tile) and installer.ico (the
// Windows installer's: the tile rising from an open box). build.ts copies
// the editor's and names them in the manifest, whose launch screen is the same
// white.
//
//   node scripts/app-icons.ts
//   cd apps/desktop
//   pnpm tauri icon src-tauri/icons/icon.png --ios-color "#ffffff"          (the desktop sizes)
//   pnpm tauri icon src-tauri/icons/mobile-source.png -o <a temp folder> --ios-color "#ffffff"
//     then copy its ios/ over src-tauri/icons: the iPhone's icons, on the white tile
//
// The Android icons (src-tauri/icons/android, laid over the generated project by android.yml) are
// written here, not by `tauri icon`: an adaptive icon is a transparent foreground over a background,
// which the launcher crops to its own shape, so the mark has to sit in the zone that always shows.

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
// (`color` overrides the mark's: the phones' mark is the paper accent even where the tile is drawn by the system)
const art = (size: number, tile?: { radius: number }, color = tile ? TILE_FILL : fill) => {
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

// Android. The adaptive icon (Android 8 and later) is drawn on 108 dp, of which the launcher shows the
// centred 72 dp, cut to its shape (circle, squircle…): the foreground is the mark alone on transparency,
// 38 dp tall (8.5 of the 24 units), about half of the shown part, with room all round in any shape;
// the background is the white tile, a colour; the same mark is the monochrome layer Android 13 tints
// for themed icons. Before Android 8 the launcher shows ic_launcher as it is: the white tile to its edges,
// a square and a circle (ic_launcher_round), with the mark at the same share of what shows.
const ANDROID = path.join(ROOT, 'apps/desktop/src-tauri/icons/android');
const DENSITIES: [string, number][] = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]];
const ADAPTIVE_MARK = 8.5;
const LEGACY_MARK = ADAPTIVE_MARK * 108 / 72;
const roundTile = (svg: string) => svg.replace(/<rect width="24" height="24" rx="0"/, '<circle cx="12" cy="12" r="12"');
const png = (svg: string, size: number, file: string) =>
  sharp(Buffer.from(svg), { density: 72 * size / 24 }).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
fs.rmSync(ANDROID, { recursive: true, force: true });
for (const [density, scale] of DENSITIES) {
  const dir = path.join(ANDROID, `mipmap-${density}`);
  fs.mkdirSync(dir, { recursive: true });
  await png(art(ADAPTIVE_MARK, undefined, TILE_FILL), 108 * scale, path.join(dir, 'ic_launcher_foreground.png'));
  await png(art(LEGACY_MARK, { radius: 0 }), 48 * scale, path.join(dir, 'ic_launcher.png'));
  await png(roundTile(art(LEGACY_MARK, { radius: 0 })), 48 * scale, path.join(dir, 'ic_launcher_round.png'));
}
const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
  + '  <background android:drawable="@color/ic_launcher_background"/>\n'
  + '  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
  + '  <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>\n'
  + '</adaptive-icon>\n';
fs.mkdirSync(path.join(ANDROID, 'mipmap-anydpi-v26'), { recursive: true });
fs.writeFileSync(path.join(ANDROID, 'mipmap-anydpi-v26/ic_launcher.xml'), adaptive);
fs.writeFileSync(path.join(ANDROID, 'mipmap-anydpi-v26/ic_launcher_round.xml'), adaptive);
fs.mkdirSync(path.join(ANDROID, 'values'), { recursive: true });
fs.writeFileSync(path.join(ANDROID, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">${TILE}</color>\n</resources>\n`);
console.log(`${path.relative(ROOT, ANDROID)} (adaptive, monochrome, legacy square and round)`);

// The Windows installer's icon (bundle.windows.nsis.installerIcon): the white tile with the mark, rising
// from an open box, and a download arrow on the box. Drawn on a 256-unit box, in the paper theme's colours.
const box = {
  inside: themeColour('light-text-2'),
  flap: themeColour('light-field-active'),
  front: themeColour('light-text-4'),
  rim: themeColour('light-field-hover'),
  badge: themeColour('light-accent'),
  arrow: themeColour('light-on-accent'),
  // the white parts' edge, so that they hold on a white desktop
  edge: themeColour('light-text-4'),
};
const installer = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">'
  // the box's inside, then its two flaps opened outwards
  + `<path d="M50 104 H206 L214 142 H42 Z" fill="${box.inside}"/>`
  + `<path d="M50 104 L10 86 L4 124 L42 142 Z" fill="${box.flap}" stroke="${box.edge}" stroke-opacity="0.6" stroke-width="3" stroke-linejoin="round"/>`
  + `<path d="M206 104 L246 86 L252 124 L214 142 Z" fill="${box.flap}" stroke="${box.edge}" stroke-opacity="0.6" stroke-width="3" stroke-linejoin="round"/>`
  // the tile, its foot hidden in the box
  + `<rect x="76" y="22" width="104" height="128" rx="20" fill="${TILE}" stroke="${box.edge}" stroke-opacity="0.6" stroke-width="3"/>`
  + `<g transform="translate(128 78) scale(${+(68 / height).toFixed(5)}) translate(${-width / 2} ${-height / 2})" fill="${TILE_FILL}">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`
  // the front, its rim, and the arrow on it
  + `<path d="M42 142 H214 L206 238 Q205 246 197 246 H59 Q51 246 50 238 Z" fill="${box.front}"/>`
  + `<path d="M42 142 H214 L213 154 H43 Z" fill="${box.rim}"/>`
  + `<circle cx="128" cy="198" r="36" fill="${box.badge}" stroke="${TILE}" stroke-width="8"/>`
  + `<path d="M128 178 V216 M112 202 L128 218 L144 202" fill="none" stroke="${box.arrow}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`
  + '</svg>';

// an .ico holding PNG images (Windows Vista and later), one per size Explorer asks for
const INSTALLER = path.join(ROOT, 'apps/desktop/src-tauri/icons/installer.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(SIZES.map((size) =>
  sharp(Buffer.from(installer), { density: 72 * size / 256 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()));
const head = Buffer.alloc(6 + 16 * images.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(images.length, 4);
let offset = head.length;
images.forEach((png, i) => {
  const at = 6 + 16 * i;
  head.writeUInt8(SIZES[i] % 256, at);
  head.writeUInt8(SIZES[i] % 256, at + 1);
  head.writeUInt16LE(1, at + 4);
  head.writeUInt16LE(32, at + 6);
  head.writeUInt32LE(png.length, at + 8);
  head.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
fs.writeFileSync(INSTALLER, Buffer.concat([head, ...images]));
console.log(`${path.relative(ROOT, INSTALLER)} (${SIZES.join(', ')})`);
