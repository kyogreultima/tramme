// The watermark's picture: the Tramme mark, all white, in the bottom right
// corner of every frame; at regular intervals the whole logo opens from it
// (the mark slides left, the word appears), holds, and closes back into it.
// Drawn for each frame's time and laid over it by the renderer
// (Renderer.stamp). Shared by the editor's exports and the command line's
// renders; whether a film carries it is watermark.ts's to say.

import logo from '../../../brand/svg/logo-on-dark.svg';

/** the logo's viewBox, and the mark's width at its left */
const VIEW_W = 507.53, VIEW_H = 127.18, MARK_W = 118.94;
/** the whole logo in white: the mark loses its colour */
const WHITE_LOGO = logo.replace(/#63c6c1/gi, '#fff');

/** when the logo opens (s): first at `first`, then every `every`; opening, held open and closing for these spans */
export const WATERMARK = { first: 1, every: 12, open: 0.6, hold: 2.6, close: 0.6 };

/** how open the logo is at time t: 0 the mark alone, 1 the whole logo, eased in between */
export function watermarkOpening(t: number): number {
  const { first, every, open, hold, close } = WATERMARK;
  if (t < first) return 0;
  const k = (t - first) % every;
  const x = k < open ? k / open : k < open + hold ? 1 : k < open + hold + close ? 1 - (k - open - hold) / close : 0;
  return x * x * (3 - 2 * x);
}

/** the logo's visible box in a frame of w × h, `opening` open: anchored bottom right, 4.5 % of the shorter side high, 3.5 % of it from the edges */
export function watermarkBox(w: number, h: number, opening = 0): { x: number; y: number; w: number; h: number; mark: number; full: number } {
  const u = Math.min(w, h), height = Math.round(u * 0.045), m = Math.round(u * 0.035);
  const full = (height * VIEW_W) / VIEW_H, mark = (height * MARK_W) / VIEW_H, width = mark + (full - mark) * opening;
  return { x: w - m - width, y: h - m - height, w: width, h: height, mark, full };
}

let picture: Promise<HTMLImageElement> | null = null;
const logoImage = () => (picture ??= (async () => {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(WHITE_LOGO)}`;
  await img.decode();
  return img;
})());

/**
 * The watermark of a frame of w × h, by time: a transparent picture holding
 * the logo as open as it is then, a soft shadow under it so it reads on
 * light pictures too. One canvas, drawn again only when the opening changes.
 */
export async function watermarkStamp(w: number, h: number): Promise<(t: number) => HTMLCanvasElement> {
  const img = await logoImage(), c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d')!;
  let drawn = -1;
  return (t) => {
    const p = watermarkOpening(t);
    if (p === drawn) return c;
    drawn = p;
    const b = watermarkBox(w, h, p);
    g.clearRect(0, 0, w, h);
    g.shadowColor = 'rgba(0, 0, 0, 0.45)';
    g.shadowBlur = Math.max(2, b.h * 0.25);
    // the mark, then the word as far as it has opened, fading in with it
    for (const [from, to, alpha] of [[0, b.mark, 0.85], [b.mark, b.w, 0.85 * p]] as const) {
      if (to <= from || alpha <= 0) continue;
      g.save();
      g.beginPath();
      g.rect(b.x + from, b.y - b.h, to - from, b.h * 3);
      g.clip();
      g.globalAlpha = alpha;
      g.drawImage(img, b.x, b.y, b.full, b.h);
      g.restore();
    }
    return c;
  };
}
