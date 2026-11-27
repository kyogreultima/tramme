// The frame of a box's « / » and « @ » menus: on the side of the box where it
// fits, never past the window, the row the keys are on always in view.

import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export type MenuSide = 'above' | 'below';

const TALLEST = 340, EDGE = 14, LEAST = 120;

/** where a menu goes beside a box (its top and bottom in a window `height` tall): the side it prefers, unless the other has more room and it lacks some */
export function menuPlace(top: number, bottom: number, height: number, prefer: MenuSide): { side: MenuSide; max: number } {
  const room = { above: top - EDGE, below: height - bottom - EDGE }, want = Math.min(TALLEST, height * 0.55);
  const other: MenuSide = prefer === 'above' ? 'below' : 'above';
  const side = room[prefer] >= want || room[prefer] >= room[other] ? prefer : other;
  return { side, max: Math.round(Math.max(LEAST, Math.min(want, room[side]))) };
}

export function BoxMenu({ hi, prefer, class: cls = '', children }: { hi: number; prefer: MenuSide; class?: string; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ side: MenuSide; max: number }>({ side: prefer, max: TALLEST });
  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (!box) return;
    const fit = () => {
      const r = box.getBoundingClientRect();
      const next = menuPlace(r.top, r.bottom, window.visualViewport?.height ?? innerHeight, prefer);
      setPlace((was) => (was.side === next.side && was.max === next.max ? was : next));
    };
    fit();
    addEventListener('resize', fit);
    addEventListener('scroll', fit, true);
    return () => { removeEventListener('resize', fit); removeEventListener('scroll', fit, true); };
  }, [prefer]);
  useLayoutEffect(() => { ref.current?.querySelector('.command-row.on')?.scrollIntoView({ block: 'nearest' }); }, [hi, place]);
  return <div ref={ref} class={`command-menu ${place.side} ${cls}`.trim()} style={{ maxHeight: `${place.max}px` }}>{children}</div>;
}
