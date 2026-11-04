// What happens behind the sign-in card: the material of a film (a photo, a
// sound, a typeface, a document, a clip, a logo) comes in along wires from the
// edges of the screen, the wires meet behind the card, and finished films go
// out along other wires, in the three formats, each showing a small drawing.
//
// The films are drawn here, in the scene's own manner (a neutral ink and the
// accent), and show no template or example of the editor: the scene looks the
// same whatever the editor ships. SVG moved by a small loop (scene.ts has the
// arithmetic); no engine loads for it. Colours are the theme's; with "reduce
// motion" nothing moves: the same scene stands still.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { at, itemsFor, lookOf, progressOf, wiresFor, type Format, type Illustration, type Item, type Kind } from './scene.ts';
import { MARK_BOX, MARK_PATHS } from './Logo.tsx';

interface Geometry { width: number; height: number; cx: number; cy: number }
type Sampled = [number, number][];

/** the size of a film's frame at scale 1: about that of what goes in (52 px), a little more */
const FRAME: Record<Format, [number, number]> = { '16:9': [88, 50], '9:16': [50, 88], '1:1': [64, 64] };

/** what goes in, drawn in a 52 px card centred on 0,0 */
function Thing({ kind }: { kind: Kind }) {
  const [, , mw, mh] = MARK_BOX.split(' ').map(Number);
  return (
    <>
      <rect class="thing-card" x={-26} y={-26} width={52} height={52} rx={10} />
      {kind === 'photo' && <><circle cx={-9} cy={-8} r={4} /><path d="M-18 14 L-6 1 L2 10 L9 3 L18 14" /></>}
      {kind === 'sound' && <path d="M-14 -4 V4 M-7 -9 V9 M0 -14 V14 M7 -7 V7 M14 -3 V3" stroke-width={3} />}
      {kind === 'type' && <text y={8} text-anchor="middle" font-size={23} font-weight={500}>Aa</text>}
      {kind === 'doc' && <><path d="M-12 -17 H5 L14 -8 V17 H-12 Z M5 -17 V-8 H14" /><path d="M-6 1 H8 M-6 7 H8 M-6 13 H2" /></>}
      {kind === 'clip' && <><rect x={-17} y={-12} width={34} height={24} rx={3} /><path d="M-6 -12 V12 M6 -12 V12" /></>}
      {kind === 'logo' && <g class="thing-mark" transform={`translate(-14 ${-14 * (mh / mw)}) scale(${28 / mw})`} dangerouslySetInnerHTML={{ __html: MARK_PATHS }} />}
    </>
  );
}

/** the drawing of a film, laid out on the frame it is in (w by h, centred on 0,0): a neutral ink, and the accent once or twice */
function Drawing({ id, w, h }: { id: Illustration; w: number; h: number }) {
  const m = Math.min(w, h);
  switch (id) {
    case 'sun':
      return (
        <>
          <circle class="hot" cx={0} cy={-h * 0.12} r={m * 0.2} />
          <path class="ink-line" d={`M ${-w * 0.36} ${h * 0.2} H ${w * 0.36} M ${-w * 0.25} ${h * 0.31} H ${w * 0.25} M ${-w * 0.13} ${h * 0.41} H ${w * 0.13}`} />
        </>
      );
    case 'bars': {
      const span = w * 0.62, step = span / 4, bw = step * 0.56, base = h * 0.3;
      return (
        <>
          {[0.22, 0.38, 0.3, 0.5, 0.66].map((v, i) => <rect key={i} class={i === 4 ? 'hot' : 'ink'} x={-span / 2 + i * step - bw / 2} y={base - v * h} width={bw} height={v * h} rx={1.2} />)}
          <path class="ink-line" d={`M ${-w * 0.38} ${base} H ${w * 0.38}`} />
        </>
      );
    }
    case 'type':
      return (
        <>
          <rect class="hot" x={-w * 0.34} y={-h * 0.3} width={w * 0.5} height={h * 0.1} rx={1.5} />
          <rect class="ink" x={-w * 0.34} y={-h * 0.08} width={w * 0.66} height={h * 0.05} rx={1} />
          <rect class="ink" x={-w * 0.34} y={h * 0.05} width={w * 0.54} height={h * 0.05} rx={1} />
          <rect class="ink" x={-w * 0.34} y={h * 0.18} width={w * 0.38} height={h * 0.05} rx={1} />
        </>
      );
    case 'rings':
      return (
        <>
          {[0.14, 0.26, 0.38].map((r) => <circle key={r} class="ink-line" cx={0} cy={0} r={m * r} />)}
          <circle class="hot" cx={0} cy={0} r={m * 0.06} />
        </>
      );
    case 'grid': {
      const s = m * 0.17, gap = s * 0.4, pitch = s + gap;
      return (
        <>
          {[-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => (
            <rect key={`${row}${col}`} class={row === 0 && col === 0 ? 'hot' : 'ink'} x={col * pitch - s / 2} y={row * pitch - s / 2} width={s} height={s} rx={1.4} />
          )))}
        </>
      );
    }
    case 'wave': {
      const n = 24, xs = Array.from({ length: n }, (_, i) => -w * 0.38 + (w * 0.76 * i) / (n - 1));
      return (
        <>
          <path class="hot-line" d={xs.map((x, i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${(Math.sin((i / (n - 1)) * Math.PI * 2.4) * h * 0.2 - h * 0.02).toFixed(1)}`).join(' ')} />
          <path class="ink-line" d={`M ${-w * 0.3} ${h * 0.34} h 0.1 M 0 ${h * 0.34} h 0.1 M ${w * 0.3} ${h * 0.34} h 0.1`} stroke-width={3} />
        </>
      );
    }
  }
}

/** a finished film: its frame, and its drawing */
function Film({ format, drawing }: { format: Format; drawing: Illustration }) {
  const [w, h] = FRAME[format];
  return (
    <>
      <rect class="film-frame" x={-w / 2} y={-h / 2} width={w} height={h} rx={7} />
      <Drawing id={drawing} w={w} h={h} />
      <rect class="film-edge" x={-w / 2} y={-h / 2} width={w} height={h} rx={7} />
    </>
  );
}

export function AuthScene() {
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const things = useRef<(SVGGElement | null)[]>([]);
  const wires = useRef<{ in: (SVGPathElement | null)[]; out: (SVGPathElement | null)[] }>({ in: [], out: [] });
  const sampled = useRef<{ in: Sampled[]; out: Sampled[] }>({ in: [], out: [] });

  // where the card is, and the size of the screen: the wires meet behind the card, wherever it stands
  useEffect(() => {
    const measure = () => {
      const card = document.querySelector('.auth-card')?.getBoundingClientRect();
      const width = innerWidth, height = innerHeight;
      const next = { width, height, cx: card ? card.left + card.width / 2 : width / 2, cy: card ? card.top + card.height / 2 : height / 2 };
      setGeometry((was) => (was && was.width === next.width && was.height === next.height && Math.abs(was.cx - next.cx) < 1 && Math.abs(was.cy - next.cy) < 1 ? was : next));
    };
    measure();
    addEventListener('resize', measure);
    const card = document.querySelector('.auth-card');
    const watch = card && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (card) watch?.observe(card);
    return () => { removeEventListener('resize', measure); watch?.disconnect(); };
  }, []);

  const shape = useMemo(() => (geometry ? wiresFor(geometry.width, geometry.height, geometry.cx, geometry.cy) : null), [geometry]);
  const items = useMemo<Item[]>(() => (shape ? itemsFor(shape.inputs.length, shape.outputs.length) : []), [shape?.inputs.length, shape?.outputs.length]);
  /** things grow a little with the screen: smaller on a phone, a touch larger on a wide display */
  const size = geometry ? Math.max(0.62, Math.min(1.15, Math.min(geometry.width, geometry.height) / 800)) : 1;

  // the wires measured, once drawn: a point every few pixels, for the things to follow
  useLayoutEffect(() => {
    if (!shape) return;
    for (const side of ['in', 'out'] as const) {
      sampled.current[side] = wires.current[side].map((path) => {
        if (!path) return [];
        const length = path.getTotalLength(), n = 220, points: Sampled = [];
        for (let i = 0; i < n; i++) { const p = path.getPointAtLength((length * i) / (n - 1)); points.push([p.x, p.y]); }
        return points;
      });
    }
  }, [shape]);

  useEffect(() => {
    if (!shape) return;
    const draw = (ms: number) => {
      items.forEach((item, i) => {
        const el = things.current[i], points = sampled.current[item.side][item.wire];
        if (!el || !points?.length) return;
        const t = progressOf(item, ms), [x, y] = at(points, t), { scale, opacity } = lookOf(item.side, t);
        el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(scale * size).toFixed(3)})`);
        el.setAttribute('opacity', opacity.toFixed(3));
      });
    };
    // a moment into the loop, so that the first picture already has things on every wire
    const from = 7000;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { draw(from); return; }
    const start = performance.now();
    let frame = requestAnimationFrame(function loop(now) { draw(from + now - start); frame = requestAnimationFrame(loop); });
    return () => cancelAnimationFrame(frame);
  }, [shape, items, size]);

  if (!geometry || !shape) return <svg class="auth-scene" aria-hidden="true" />;

  return (
    <svg class="auth-scene" aria-hidden="true" width={geometry.width} height={geometry.height} viewBox={`0 0 ${geometry.width} ${geometry.height}`}>
      {(['in', 'out'] as const).map((side) => (
        <g key={side} class={`wires ${side}`}>
          {(side === 'in' ? shape.inputs : shape.outputs).map((d, i) => (
            <g key={i}>
              <path class="wire" d={d} ref={(el) => { wires.current[side][i] = el; }} />
              {/* a signal now and then, going the way of the wire */}
              <path class="signal" d={d} style={{ animationDelay: `${-((i * 1.7 + (side === 'out' ? 2.3 : 0)) % 5.5).toFixed(2)}s`, animationDuration: `${5.5 + ((i * 7) % 4) * 0.6}s` }} />
            </g>
          ))}
        </g>
      ))}
      <g class="things">
        {items.map((item, i) => (
          <g key={`${item.side}${item.wire}${i}`} class={item.side === 'in' ? 'thing' : 'film'} opacity={0} ref={(el) => { things.current[i] = el; }}>
            {item.side === 'in' ? <Thing kind={item.kind as Kind} /> : <Film format={item.kind as Format} drawing={item.film} />}
          </g>
        ))}
      </g>
    </svg>
  );
}
