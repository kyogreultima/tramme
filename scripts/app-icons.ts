// The editor's icon and its icons as an installed app: the logo's mark
// (brand/svg) in the paper theme's accent, on a white tile. Writes
// apps/editor/icon.svg (the favicon), the PNGs Android, Chrome and iOS ask for
// (apps/editor/icons, served at /icons: "any" keeps the rounded tile; the
// maskable one and Apple's fill the whole square, the system cuts its own
// shape, with the mark inside the safe zone) and the desktop app's source
// (apps/desktop/src-tauri/icons/icon.png, 1024 px). build.ts copies them and
// names them in the manifest.
//
//   node scripts/app-icons.ts
//   cd apps/desktop && npx tauri icon src-tauri/icons/icon.png      (the desktop app's own sizes)

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, accent, mark } from './brand.ts';

const OUT = path.join(ROOT, 'apps/editor/icons');
const DESKTOP = path.join(ROOT, 'apps/desktop/src-tauri/icons/icon.png');
const TILE = '#ffffff';

const { paths, width, height } = mark();
const fill = accent('paper');

// the icon is drawn on a 24-unit box; the mark, `size` units tall, in its middle
const art = (size: number, rx: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24"${rx ? ` rx="${rx}"` : ''} fill="${TILE}"/>`
  + `<g transform="translate(12 12) scale(${+(size / height).toFixed(5)}) translate(${-width / 2} ${-height / 2})" fill="${fill}">${paths.map((d) => `<path d="${d}"/>`).join('')}</g></svg>`;

const icon = art(15, 6);
fs.writeFileSync(path.join(ROOT, 'apps/editor/icon.svg'), `${icon}\n`);
console.log('apps/editor/icon.svg');

const ICONS: [string, string, number][] = [
  ['icon-192.png', icon, 192],
  ['icon-512.png', icon, 512],
  // the safe zone is the centred circle of 80 %: the mark keeps well inside it
  ['maskable-512.png', art(12, 0), 512],
  ['apple-touch-icon.png', art(14, 0), 180],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, svg, size] of ICONS) {
  await sharp(Buffer.from(svg), { density: 72 * size / 24 }).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(OUT, name));
  console.log(`${path.relative(ROOT, path.join(OUT, name))} (${size}×${size})`);
}

await sharp(Buffer.from(art(14, 0)), { density: 72 * 1024 / 24 }).resize(1024, 1024).png({ compressionLevel: 9 }).toFile(DESKTOP);
console.log(`${path.relative(ROOT, DESKTOP)} (1024×1024)`);
