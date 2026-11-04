// The scene behind the sign-in card: the things a film is made from (a photo, a
// sound, a typeface, a document, a clip, a logo) come in along wires from the
// edges of the screen, the wires meet behind the card, and finished films go
// out along other wires. This is only its arithmetic (the wires, who travels
// where, how each thing looks along its way); AuthScene.tsx draws it.

export type Layout = 'wide' | 'tall';

/** a phone held upright gets the scene the other way round: in from the top, out at the bottom */
export const layoutOf = (width: number, height: number): Layout => (height > width * 1.1 ? 'tall' : 'wide');

const r = (n: number) => Math.round(n * 10) / 10;

/**
 * The wires, as SVG paths, for a screen of this size whose card is centred on
 * (cx, cy): the inputs end there, the outputs start there. They begin and end
 * a little outside the screen, so nothing appears from nowhere.
 */
export function wiresFor(width: number, height: number, cx: number, cy: number): { layout: Layout; inputs: string[]; outputs: string[] } {
  const layout = layoutOf(width, height);
  const W = width, H = height, out = 80;
  if (layout === 'wide') {
    const inputs = [0.08, 0.22, 0.36, 0.52, 0.66, 0.8, 0.93].map((f) => {
      const y = H * f;
      return `M ${r(-out)} ${r(y)} C ${r(W * 0.3)} ${r(y)}, ${r(cx - W * 0.18)} ${r(cy)}, ${r(cx)} ${r(cy)}`;
    });
    const outputs = [0.16, 0.4, 0.62, 0.86].map((f) => {
      const y = H * f;
      return `M ${r(cx)} ${r(cy)} C ${r(cx + W * 0.18)} ${r(cy)}, ${r(W * 0.7)} ${r(y)}, ${r(W + out)} ${r(y)}`;
    });
    return { layout, inputs, outputs };
  }
  const inputs = [0.1, 0.26, 0.42, 0.58, 0.74, 0.9].map((f) => {
    const x = W * f;
    return `M ${r(x)} ${r(-out)} C ${r(x)} ${r(H * 0.22)}, ${r(cx)} ${r(cy - H * 0.16)}, ${r(cx)} ${r(cy)}`;
  });
  const outputs = [0.15, 0.38, 0.62, 0.85].map((f) => {
    const x = W * f;
    return `M ${r(cx)} ${r(cy)} C ${r(cx)} ${r(cy + H * 0.16)}, ${r(x)} ${r(H * 0.78)}, ${r(x)} ${r(H + out)}`;
  });
  return { layout, inputs, outputs };
}

/** what goes in: the material of a film */
export const KINDS = ['photo', 'sound', 'type', 'doc', 'clip', 'logo'] as const;
export type Kind = (typeof KINDS)[number];

/** what comes out: a film in one of three formats */
export const FORMATS = ['16:9', '9:16', '1:1'] as const;
export type Format = (typeof FORMATS)[number];

/** what the films that come out show: one small drawing each, in the scene's own manner */
export const ILLUSTRATIONS = ['sun', 'bars', 'type', 'rings', 'grid', 'wave'] as const;
export type Illustration = (typeof ILLUSTRATIONS)[number];

export interface Item {
  side: 'in' | 'out';
  /** the wire it travels */
  wire: number;
  /** in: what it is; out: its format */
  kind: Kind | Format;
  /** seconds for one crossing */
  seconds: number;
  /** where on the wire it is at time zero, 0 to 1 */
  phase: number;
  /** out: which drawing it shows */
  film: Illustration;
}

const frac = (x: number) => x - Math.floor(x);

/**
 * Who travels: two things on each input wire, one or two films on each output
 * wire. Phases and durations are set so that nothing moves in step with its
 * neighbour (a golden-ratio step, a duration that differs from wire to wire).
 */
export function itemsFor(inputs: number, outputs: number): Item[] {
  const items: Item[] = [];
  for (let w = 0; w < inputs; w++) {
    for (let k = 0; k < 2; k++) {
      items.push({ side: 'in', wire: w, kind: KINDS[(w * 2 + k) % KINDS.length], seconds: 14 + ((w * 3 + k * 2) % 5), phase: frac(w * 0.382 + k * 0.5 + 0.07), film: ILLUSTRATIONS[0] });
    }
  }
  let films = 0;
  for (let w = 0; w < outputs; w++) {
    const times = w % 2 === 0 ? 2 : 1;
    for (let k = 0; k < times; k++) {
      // each film its own drawing, in turn, so that two films side by side are not alike
      items.push({ side: 'out', wire: w, kind: FORMATS[(w + k) % FORMATS.length], seconds: 18 + ((w * 2 + k) % 4) * 2, phase: frac(w * 0.27 + k * 0.5 + 0.13), film: ILLUSTRATIONS[films++ % ILLUSTRATIONS.length] });
    }
  }
  return items;
}

/** how far along its wire an item is at this time (milliseconds), 0 up to 1, starting over once across */
export const progressOf = (item: Pick<Item, 'seconds' | 'phase'>, ms: number): number => frac(item.phase + ms / 1000 / item.seconds);

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (from: number, to: number, x: number) => { const t = clamp((x - from) / (to - from)); return t * t * (3 - 2 * t); };

/**
 * How a thing looks at a point of its wire. What goes in arrives whole and
 * shrinks into the knot behind the card; a film comes out of that knot small,
 * grows to its size, and fades at the edge of the screen.
 */
export function lookOf(side: 'in' | 'out', t: number): { scale: number; opacity: number } {
  if (side === 'in') return { scale: 1 - 0.3 * smooth(0.7, 0.97, t), opacity: smooth(0, 0.05, t) * (1 - smooth(0.82, 0.97, t)) };
  return { scale: 0.5 + 0.5 * smooth(0, 0.35, t), opacity: smooth(0, 0.1, t) * (1 - smooth(0.86, 0.98, t)) };
}

/** the point at progress t (0 to 1) of a wire sampled in evenly spaced points */
export function at(points: readonly (readonly [number, number])[], t: number): [number, number] {
  const x = clamp(t) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(x)), f = x - i;
  const a = points[i], b = points[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
