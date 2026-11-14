// The scopes beside the picture while a grading effect is selected (any of
// the Colour category, or a key): the waveform, the RGB parade or the
// histogram (the one chosen is remembered), and the vectorscope, of the frame
// as drawn, read a moment after it changes.

import { useEffect, useRef, useState } from 'preact/hooks';
import { preview } from '../preview.ts';
import { comp, S, uiTime, viewDoc } from '../state.ts';
import { countsToImage, GRADING_EFFECTS, histogram, histogramToImage, parade, paradeToImage, VECTOR_SIZE, vectorscope, WAVE_ROWS, waveform } from '../scopes.ts';
import { t } from '../i18n/index.ts';
import { phoneLayout } from './controls.tsx';
import { Icon } from './icons.tsx';

const WAVE_W = 256, PARADE_W = 96, HIST_W = 256;
type Kind = 'waveform' | 'parade' | 'histogram';
const KINDS: Kind[] = ['waveform', 'parade', 'histogram'];
const KEY = 'tramme.scope', OPEN = 'tramme.scopes.open';

/** whether the selection carries a grading effect: the scopes then show */
export function grading(): boolean {
  const c = comp.value, id = S.selection.value[0], reg = S.registry.value;
  const isGrading = (type: string) => GRADING_EFFECTS.includes(type) || (reg.hasEffect(type) && reg.effect(type).category === 'Colour');
  return !!id && S.selection.value.length === 1 && (c.layers[id]?.effects ?? []).some((e) => e.enabled !== false && isGrading(e.type));
}

/** the scopes, or on a phone (where they would hide half the picture) a button that opens them; folded or open is remembered */
export function Scopes() {
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(OPEN); return v === null ? !phoneLayout() : v === '1'; } catch { return !phoneLayout(); } });
  const show = (v: boolean) => { setOpen(v); try { localStorage.setItem(OPEN, v ? '1' : '0'); } catch { /* private */ } };
  if (!open) return <button class="scopes-chip" onPointerDown={(e) => e.stopPropagation()} onClick={() => show(true)}><Icon name="sliders" />{t('viewport.scopes')}</button>;
  return <ScopePanel onClose={() => show(false)} />;
}

function ScopePanel({ onClose }: { onClose: () => void }) {
  const wave = useRef<HTMLCanvasElement>(null), vector = useRef<HTMLCanvasElement>(null);
  const [kind, setKind] = useState<Kind>(() => { try { const k = localStorage.getItem(KEY) as Kind; return KINDS.includes(k) ? k : 'waveform'; } catch { return 'waveform'; } });
  const choose = (k: Kind) => { setKind(k); try { localStorage.setItem(KEY, k); } catch { /* private */ } };
  const time = uiTime.value, doc = viewDoc.value;
  useEffect(() => {
    let gone = false, tries = 0;
    // read once the frame settles: the picture drawn again and read at once (the WebGL canvas keeps nothing between tasks);
    // a video frame still decoding is waited for, then read again (a few times at most), so the scopes never stay empty
    const read = () => {
      const src = preview.canvas, r = preview.renderer;
      if (gone || !r || !src.width || !wave.current || !vector.current) return;
      try { r.render(uiTime.peek()); } catch { return; }
      if (r.incomplete && tries++ < 6) r.settle().then(() => read());
      const w = kind === 'parade' ? PARADE_W : WAVE_W, h = Math.max(1, Math.round((src.height / src.width) * w));
      const small = document.createElement('canvas');
      small.width = w; small.height = h;
      const g = small.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(src, 0, 0, w, h);
      preview.invalidate();
      const px = g.getImageData(0, 0, w, h).data;
      const put = (cv: HTMLCanvasElement, img: Uint8ClampedArray<ArrayBuffer>, cw: number, ch: number) => {
        cv.width = cw; cv.height = ch;
        cv.getContext('2d')!.putImageData(new ImageData(img, cw, ch), 0, 0);
      };
      if (kind === 'parade') put(wave.current, paradeToImage(parade(px, w, h), w, WAVE_ROWS), 3 * w, WAVE_ROWS);
      else if (kind === 'histogram') put(wave.current, histogramToImage(histogram(px, w, h), HIST_W, WAVE_ROWS), HIST_W, WAVE_ROWS);
      else put(wave.current, countsToImage(waveform(px, w, h), w, WAVE_ROWS), w, WAVE_ROWS);
      put(vector.current, countsToImage(vectorscope(px, w, h), VECTOR_SIZE, VECTOR_SIZE, [230, 230, 230]), VECTOR_SIZE, VECTOR_SIZE);
    };
    const timer = setTimeout(read, 160);
    return () => { gone = true; clearTimeout(timer); };
  }, [time, doc, kind]);
  const label = { waveform: t('viewport.waveform'), parade: t('viewport.parade'), histogram: t('viewport.histogram') };
  return (
    <div class="scopes" onPointerDown={(e) => e.stopPropagation()}>
      <figure>
        <canvas ref={wave} />
        <figcaption><div class="scope-kinds" role="tablist">
          {KINDS.map((k) => <button key={k} role="tab" aria-selected={kind === k} class={kind === k ? 'on' : ''} onClick={() => choose(k)}>{label[k]}</button>)}
        </div></figcaption>
      </figure>
      <figure class="vector"><canvas ref={vector} /><figcaption>{t('viewport.vectorscope')}</figcaption></figure>
      <button class="scopes-close" title={t('viewport.hideScopes')} aria-label={t('viewport.hideScopes')} onClick={onClose}><Icon name="x" /></button>
    </div>
  );
}
