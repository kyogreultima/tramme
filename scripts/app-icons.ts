// The editor's icon and its icons as an installed app: the logo's mark
// (brand/svg) alone, in the studio theme's accent, on no ground, as a program's
// icon is (VS Code's, say). Writes apps/editor/icon.svg (the favicon), the PNGs
// Android, Chrome and iOS ask for (apps/editor/icons, served at /icons) and the
// desktop app's source (apps/desktop/src-tauri/icons/icon.png, 1024 px). Two of
// them cannot stay bare: the systems fill the whole square of a maskable icon
// and of Apple's, and paint behind a transparent one in a colour of their own,
// so these two sit on the studio's own dark ground (never white), the mark
// inside the safe zone. build.ts copies them and names them in the manifest.
//
//   node scripts/app-icons.ts
//   cd apps/desktop && npx tauri icon src-tauri/icons/icon.png      (the desktop app's own sizes)

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, accent, mark, ground } from './brand.ts';

const OUT = path.join(ROOT, 'apps/editor/icons');
const DESKTOP = path.join(ROOT, 'apps/desktop/src-tauri/icons/icon.png');

const { paths, width, height } = mark();
// the studio's accent: it reads on a dark taskbar and on a light one
const fill = accent('studio');

// the icon is drawn on a 24-unit box; the mark, `size` units tall, in its middle, on `bg` if there is one
const art = (size: number, bg?: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${bg ? `<rect width="24" height="24" fill="${bg}"/>` : ''}`
  + `<g transform="translate(12 12) scale(${+(size / height).toFixed(5)}) translate(${-width / 2} ${-height / 2})" fill="${fill}">${paths.map((d) => `<path d="${d}"/>`).join('')}</g></svg>`;

const icon = art(22);
fs.writeFileSync(path.join(ROOT, 'apps/editor/icon.svg'), `${icon}\n`);
console.log('apps/editor/icon.svg');

const ICONS: [string, string, number][] = [
  ['icon-192.png', icon, 192],
  ['icon-512.png', icon, 512],
  // the safe zone is the centred circle of 80 %: the mark keeps well inside it
  ['maskable-512.png', art(12, ground()), 512],
  ['apple-touch-icon.png', art(14, ground()), 180],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, svg, size] of ICONS) {
  await sharp(Buffer.from(svg), { density: 72 * size / 24 }).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(OUT, name));
  console.log(`${path.relative(ROOT, path.join(OUT, name))} (${size}×${size})`);
}

await sharp(Buffer.from(art(22)), { density: 72 * 1024 / 24 }).resize(1024, 1024).png({ compressionLevel: 9 }).toFile(DESKTOP);
console.log(`${path.relative(ROOT, DESKTOP)} (1024×1024)`);
