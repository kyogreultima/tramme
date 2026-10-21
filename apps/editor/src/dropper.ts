// A colour picked in the viewport: a colour field asks, the next click on the
// picture answers with the colour of that pixel (Escape: nothing). While it
// waits, the effect the colour belongs to can be hidden (a key picks the
// screen as filmed, not what is left of it once keyed).

import { signal } from '@preact/signals';
import type { Op } from '@tramme/core';
import { cancelDraft, draft } from './state.ts';

/** the colour field waiting for a pick, if any */
export const picking = signal<((hex: string | null) => void) | null>(null);

/** the colour of the next click on the picture; `hide`: operations previewed while picking (an effect turned off) */
export function pickColor(hide: Op[] = []): Promise<string | null> {
  picking.peek()?.(null);
  if (hide.length) draft(hide);
  return new Promise((resolve) => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') picking.peek()?.(null); };
    addEventListener('keydown', escape);
    picking.value = (hex) => {
      picking.value = null;
      removeEventListener('keydown', escape);
      if (hide.length) cancelDraft();
      resolve(hex);
    };
  });
}

/** #RRGGBB of the pixel of a canvas at a point of the page */
export function pixelAt(canvas: HTMLCanvasElement, clientX: number, clientY: number): string | null {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const x = Math.floor(((clientX - r.left) / r.width) * canvas.width), y = Math.floor(((clientY - r.top) / r.height) * canvas.height);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  const one = document.createElement('canvas');
  one.width = one.height = 1;
  const g = one.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(canvas, x, y, 1, 1, 0, 0, 1, 1);
  const [R, G, B] = g.getImageData(0, 0, 1, 1).data;
  return `#${[R, G, B].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
