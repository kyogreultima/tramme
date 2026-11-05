// The logo's mark in the app's accent (lib/logo.ts) as the PNGs phones and search
// engines ask for: the home screen (apple-touch-icon, 180), the web manifest
// (192, 512). The mark stands alone, on no ground, as a program's icon does.
// Only the home screen's, which the system fills, sits on a white tile
// with room around the mark (the system rounds the corners itself).

import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { markDark, markOnTile, tile } from '../../lib/logo';

const SIZES = [180, 192, 512];
/** the mark's share of the square's side, on a ground and alone */
const ON_GROUND = 0.56;
const ALONE = 0.92;

export const getStaticPaths = (() => SIZES.map((size) => ({ params: { size: String(size) } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const size = Number(params.size);
  const filled = size === 180;
  const svg = filled ? markOnTile : markDark;
  const inner = Math.round(size * (filled ? ON_GROUND : ALONE));
  // drawn at the size it takes, from the vector, not scaled up
  const mark = await sharp(Buffer.from(svg), { density: 72 * (inner / 118.94) * 2 }).resize(inner, inner, { fit: 'inside' }).png().toBuffer();
  const png = await sharp({ create: { width: size, height: size, channels: 4, background: filled ? tile : { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
};
