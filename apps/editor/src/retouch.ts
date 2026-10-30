// What the studio's user draws on the picture, and the list of retouches they
// build from it. A pin is a point, a path (a line to follow) or an area (a
// group of layers the user picks by drawing round them); a retouch is a few
// words, spoken or typed, about the pins drawn for it. The pure parts live
// here: simplifying a stroke, proposing the layers an area may mean (which the
// user then confirms), and saying the pins in the words the assistant reads.

import type { Mark } from '@tramme/assistant';

export type Pt = [number, number];
export interface Under { id: string; name: string; type: string }

export type Pin =
  | { id: string; kind: 'point'; at: Pt; under?: Under }
  | { id: string; kind: 'path'; points: Pt[]; under?: Under }
  | { id: string; kind: 'area'; points: Pt[]; layers: Under[] };

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
/** a pin before it has its id */
export type NewPin = WithoutId<Pin>;

/** a retouch waiting in the list: what to do, about which pins, drawn at which moment of which scene */
export interface Retouch {
  id: string;
  text: string;
  pins: Pin[];
  /** the moment of the film it was written at (s) */
  time: number;
  scene?: { name: string; from: number; to: number };
  /** its words were spoken */
  voice?: boolean;
}

// ── strokes ──────────────────────────────────────────────────

/** the distance of p from the segment a-b */
function away(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const k = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + k * dx), p[1] - (a[1] + k * dy));
}

/** Ramer-Douglas-Peucker: the points that matter, ends included */
function rdp(points: Pt[], eps: number): Pt[] {
  if (points.length < 3) return points;
  let far = 0, at = 0;
  for (let i = 1; i < points.length - 1; i++) { const d = away(points[i], points[0], points[points.length - 1]); if (d > far) { far = d; at = i; } }
  if (far <= eps) return [points[0], points[points.length - 1]];
  return [...rdp(points.slice(0, at + 1), eps).slice(0, -1), ...rdp(points.slice(at), eps)];
}

/** a stroke reduced to its shape, at most `max` points, its two ends always kept (fractions of the frame) */
export function simplify(points: Pt[], max = 16, eps = 0.004): Pt[] {
  let out = rdp(points, eps), e = eps;
  while (out.length > max) { e *= 1.5; out = rdp(points, e); }
  return out;
}

const length = (p: Pt[]) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);

/** whether a stroke comes back to where it began: a loop round things, not a line through them */
export function isLoop(points: Pt[]): boolean {
  if (points.length < 4) return false;
  const total = length(points);
  return total > 0 && Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]) < 0.35 * total;
}

// ── the layers an area may mean ──────────────────────────────

export interface Placed { id: string; name: string; type: string; box: { x: number; y: number; w: number; h: number } | null; opacity: number; locked?: boolean }

/** most layers an area proposes: past it, the stroke is too wide and the user draws a narrower one */
export const MOST_LAYERS = 8;

const inside = (p: Pt, poly: Pt[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
  }
  return c;
};

/**
 * The layers a stroke (in composition pixels) may be about, for the user to
 * confirm: with a loop, those mostly inside it (70 % of their box); with a line,
 * those it passes through. Never a background (a layer over nine tenths of the
 * frame), a hidden, a locked or a nested layer, nor one with no box. More than
 * eight and none is proposed: the stroke is too wide.
 */
export function areaCandidates(placed: Placed[], stroke: Pt[], frame: { w: number; h: number }): { layers: Under[]; tooMany: boolean; count: number } {
  const loop = isLoop(stroke);
  const eligible = placed.filter((p) => p.box && p.opacity > 0.05 && !p.locked && !p.id.includes('/') && p.box.w * p.box.h < 0.9 * frame.w * frame.h);
  const hit = eligible.filter((p) => {
    const b = p.box!;
    if (loop) {
      let n = 0;
      for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) if (inside([b.x + ((i + 0.5) / 9) * b.w, b.y + ((j + 0.5) / 9) * b.h], stroke)) n++;
      return n / 81 >= 0.7;
    }
    for (let i = 1; i < stroke.length; i++) {
      const [a, c] = [stroke[i - 1], stroke[i]], steps = Math.max(2, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 4));
      for (let s = 0; s <= steps; s++) {
        const x = a[0] + ((c[0] - a[0]) * s) / steps, y = a[1] + ((c[1] - a[1]) * s) / steps;
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
      }
    }
    return false;
  });
  const tooMany = hit.length > MOST_LAYERS;
  return { layers: tooMany ? [] : hit.map(({ id, name, type }) => ({ id, name, type })), tooMany, count: hit.length };
}

/** whether the user is asked to confirm the layers an area proposes, as the setting says: always, only for more than three, or never */
export const needsConfirm = (setting: 'always' | 'many' | 'never', n: number) => setting === 'always' || (setting === 'many' && n > 3);

// ── pins in words ────────────────────────────────────────────

/** the pins as the assistant's marks, numbered from `first` */
export function marksOf(pins: Pin[], first = 1): Mark[] {
  return pins.map((p, i): Mark => {
    const n = first + i;
    if (p.kind === 'point') return { n, kind: 'point', at: p.at, ...(p.under ? { under: p.under } : {}) };
    if (p.kind === 'path') return { n, kind: 'path', points: p.points, ...(p.under ? { under: p.under } : {}) };
    return { n, kind: 'area', points: p.points, layers: p.layers };
  });
}

/** a few words on what the pins are: "1 point · 1 path · 1 selection of 3 layers" */
export function summaryOf(pins: Pin[]): string {
  const parts: string[] = [];
  const points = pins.filter((p) => p.kind === 'point').length, paths = pins.filter((p) => p.kind === 'path').length;
  if (points) parts.push(`${points} point${points > 1 ? 's' : ''}`);
  if (paths) parts.push(`${paths} path${paths > 1 ? 's' : ''}`);
  for (const a of pins) if (a.kind === 'area') parts.push(a.layers.length ? `1 selection of ${a.layers.length} layer${a.layers.length > 1 ? 's' : ''}` : '1 area');
  return parts.join(' · ');
}

/** where a pin's badge sits on the picture: the point, the start of a path, the middle of an area's stroke */
export function anchorPoint(p: Pin): Pt {
  if (p.kind === 'point') return p.at;
  if (p.kind === 'path') return p.points[0];
  const xs = p.points.map((q) => q[0]), ys = p.points.map((q) => q[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
