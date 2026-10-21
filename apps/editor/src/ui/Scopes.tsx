// The scopes beside the picture while a grading effect is selected (a LUT,
// curves, wheels, a colour correction, a key): the waveform and the
// vectorscope of the frame as drawn, read a moment after it changes.

import { useEffect, useRef } from 'preact/hooks';
import { preview } from '../preview.ts';
import { comp, S, uiTime, viewDoc } from '../state.ts';
import { countsToImage, GRADING_EFFECTS, VECTOR_SIZE, vectorscope, WAVE_ROWS, waveform } from '../scopes.ts';
import { t } from '../i18n/index.ts';

const WAVE_W = 256;

/** whether the selection carries a grading effect: the scopes then show */
export function grading(): boolean {
  const c = comp.value, id = S.selection.value[0];
  return !!id && S.selection.value.length === 1 && (c.layers[id]?.effects ?? []).some((e) => e.enabled !== false && GRADING_EFFECTS.includes(e.type));
}

export function Scopes() {
  const wave = useRef<HTMLCanvasElement>(null), vector = useRef<HTMLCanvasElement>(null);
  const time = uiTime.value, doc = viewDoc.value;
  useEffect(() => {
    // read once the frame settles: the picture drawn again and read at once (the WebGL canvas keeps nothing between tasks)
    const timer = setTimeout(() => {
      const src = preview.canvas, r = preview.renderer;
      if (!r || !src.width || !wave.current || !vector.current) return;
      try { r.render(uiTime.peek()); } catch { return; }
      const w = WAVE_W, h = Math.max(1, Math.round((src.height / src.width) * WAVE_W));
      const small = document.createElement('canvas');
      small.width = w; small.height = h;
      const g = small.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(src, 0, 0, w, h);
      preview.invalidate();
      const px = g.getImageData(0, 0, w, h).data;
      const draw = (cv: HTMLCanvasElement, counts: Uint32Array, cw: number, ch: number, rgb?: [number, number, number]) => {
        cv.width = cw; cv.height = ch;
        cv.getContext('2d')!.putImageData(new ImageData(countsToImage(counts, cw, ch, rgb), cw, ch), 0, 0);
      };
      draw(wave.current, waveform(px, w, h), w, WAVE_ROWS);
      draw(vector.current, vectorscope(px, w, h), VECTOR_SIZE, VECTOR_SIZE, [230, 230, 230]);
    }, 160);
    return () => clearTimeout(timer);
  }, [time, doc]);
  return (
    <div class="scopes" onPointerDown={(e) => e.stopPropagation()}>
      <figure><canvas ref={wave} /><figcaption>{t('viewport.waveform')}</figcaption></figure>
      <figure class="vector"><canvas ref={vector} /><figcaption>{t('viewport.vectorscope')}</figcaption></figure>
    </div>
  );
}
