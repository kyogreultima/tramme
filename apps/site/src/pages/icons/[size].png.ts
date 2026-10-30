// The logo's mark in the app's accent (lib/logo.ts) as the PNGs phones and search
// engines ask for: the home screen (apple-touch-icon, 180), the web manifest
// (192, 512). The mark is centred on a full square of white, with room around
// it (the systems round the corners themselves).

import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { markLight as svg } from '../../lib/logo';

const SIZES = [180, 192, 512];
/** the mark's share of the square's side */
const MARK = 0.56;

export const getStaticPaths = (() => SIZES.map((size) => ({ params: { size: String(size) } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const size = Number(params.size);
  const inner = Math.round(size * MARK);
  // drawn at the size it takes, from the vector, not scaled up
  const mark = await sharp(Buffer.from(svg), { density: 72 * (inner / 118.94) * 2 }).resize(inner, inner, { fit: 'inside' }).png().toBuffer();
  const png = await sharp({ create: { width: size, height: size, channels: 3, background: '#ffffff' } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
};
