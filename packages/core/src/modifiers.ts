// Modifiers: reusable transformations stacked on a property's value
// ("$mod": [{ "type": "wiggle", "freq": 2, "amp": 10 }]). Each one is a pure
// function of time: it may read the value under it at other instants
// (base(t)), the property's keyframes, and the layer's rank among its
// siblings. They act on numbers and vectors; other values pass through.

import { hash, noise3 } from './math.ts';
import type { PropSchema } from './registry.ts';
import type { AudioReader } from './analysis.ts';
import type { AiNotes } from './tools.ts';
import type { Keyframe, Vec2 } from './types.ts';

export interface Modifier { type: string; [param: string]: unknown }

export interface ModifierContext {
  t: number;
  fps: number;
  /** the value under this modifier at another time (earlier modifiers included) */
  base(t: number): unknown;
  /** the property's keyframes, when it has some */
  keys: Keyframe[] | null;
  /** keyframe values resolved to numbers or vectors, aligned with keys */
  keyValues: unknown[] | null;
  /** rank of the layer among its siblings, bottom first, and their number */
  index: number;
  count: number;
  /** a stable number for this property (distinct noise per property) */
  seed: number;
  /** the music or sound at this instant (see the expressions' audio()) */
  audio?(source: string): AudioReader;
  /**
   * The position (transform.position) of a layer at another time: the layer
   * owning this property when the id is empty — its rest position, without its
   * modifiers, so it can never feed itself — or any other layer with
   * everything that drives it. Null when the layer has no usable position.
   */
  position?(id: string, t?: number): Vec2 | null;
  /** the composition's width and height (a time field's angle and distance cross it) */
  size?: Vec2;
}

export interface ModifierType {
  type: string;
  title: string;
  description: string;
  /** notes for the assistant */
  ai?: AiNotes;
  params: PropSchema;
  apply(value: unknown, params: Record<string, any>, ctx: ModifierContext): unknown;
}

// ── helpers ──────────────────────────────────────────────────
const isNum = (v: unknown): v is number => typeof v === 'number';
const isVec = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNum);
/** apply f to each component of a number or a vector */
function each(v: unknown, f: (x: number, i: number) => number): unknown {
  if (isNum(v)) return f(v, 0);
  if (isVec(v)) return v.map(f);
  return v;
}
const add = (a: unknown, b: unknown): unknown => (isNum(a) && isNum(b) ? a + b : isVec(a) && isVec(b) ? a.map((x, i) => x + b[i]) : a);
const sub = (a: unknown, b: unknown): unknown => (isNum(a) && isNum(b) ? a - b : isVec(a) && isVec(b) ? a.map((x, i) => x - b[i]) : a);
const scale = (a: unknown, k: number): unknown => each(a, (x) => x * k);

/** fractal noise in about -1..1 */
function fbm(x: number, y: number, z: number, octaves: number): number {
  let s = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < Math.max(1, Math.min(6, octaves)); o++) { s += amp * noise3(x * f, y * f, z); norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}

/** step response of a damped spring: 0 at tau = 0, settles at 1 */
export function springStep(tau: number, freq: number, damping: number): number {
  if (tau <= 0) return 0;
  const w = 2 * Math.PI * freq, z = Math.min(1, Math.max(0.02, damping));
  if (z >= 0.999) return 1 - Math.exp(-w * tau) * (1 + w * tau);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * tau));
}

// ── built-in modifiers ───────────────────────────────────────
export const wiggle: ModifierType = {
  type: 'wiggle', title: 'Wiggle', description: 'adds a smooth random motion',
  params: {
    freq: { type: 'number', default: 2, min: 0, step: 0.1, unit: 'x', label: 'Frequency (Hz)' },
    amp: { type: 'number', default: 10, step: 0.5, label: 'Amplitude' },
    octaves: { type: 'number', default: 1, min: 1, max: 6, step: 1, label: 'Octaves' },
    seed: { type: 'number', default: 0, step: 1, label: 'Seed' },
  },
  apply: (v, p, c) => each(v, (x, i) => x + p.amp * fbm(c.t * p.freq, i * 7.31 + p.seed * 3.17, c.seed, p.octaves)),
};

export const loop: ModifierType = {
  type: 'loop', title: 'Loop', description: "repeats the keyframe animation beyond the last one",
  params: {
    mode: { type: 'enum', default: 'cycle', options: ['cycle', 'pingpong', 'offset'], label: 'Mode' },
    start: { type: 'number', default: -1, step: 0.01, unit: 's', label: 'Start', description: '-1: first keyframe' },
    end: { type: 'number', default: -1, step: 0.01, unit: 's', label: 'End', description: '-1: last keyframe' },
  },
  apply(v, p, c) {
    const a = p.start >= 0 ? p.start : c.keys?.[0]?.t ?? 0;
    const b = p.end >= 0 ? p.end : c.keys?.at(-1)?.t ?? 0;
    const d = b - a;
    if (d <= 1e-6 || c.t <= b) return v;
    const n = Math.floor((c.t - a) / d), f = (c.t - a) - n * d;
    if (p.mode === 'pingpong') return c.base(n % 2 ? b - f : a + f);
    if (p.mode === 'offset') return add(c.base(a + f), scale(sub(c.base(b), c.base(a)), n));
    return c.base(a + f);
  },
};

export const spring: ModifierType = {
  type: 'spring', title: 'Spring', description: 'each keyframe change becomes a spring\'s response',
  params: {
    freq: { type: 'number', default: 2.5, min: 0.1, step: 0.1, label: 'Frequency (Hz)' },
    damping: { type: 'number', default: 0.45, min: 0.02, max: 1, step: 0.01, label: 'Damping' },
  },
  apply(v, p, c) {
    const ks = c.keys, vs = c.keyValues;
    if (!ks || !vs || ks.length < 2) return v;
    // superposition: each segment's change starts at its first key, as a spring step
    let out = vs[0];
    for (let i = 0; i < ks.length - 1; i++) {
      const delta = sub(vs[i + 1], vs[i]);
      out = add(out, scale(delta, ks[i].ease === 'hold' ? (c.t >= ks[i + 1].t ? 1 : 0) : springStep(c.t - ks[i].t, p.freq, p.damping)));
    }
    return out;
  },
};

/**
 * A time field's settings: how far behind each element runs. `rank`: by its
 * rank, `amount` seconds per element; `angle`: by where it lies along the
 * direction `angle` (degrees, 0: left to right), `amount` seconds to cross
 * the whole field; `distance`: by its distance to `center` (or to the layer
 * `source`), `amount` seconds out to the farthest corner; `noise`: by
 * gradient noise over its position (`scale` px a feature, 0: a fixed random
 * delay per element; `speed` drifts the field), between 0 and `amount`.
 */
export interface TimeField {
  mode: 'rank' | 'angle' | 'distance' | 'noise';
  amount: number;
  from?: 'first' | 'last';
  angle?: number;
  center?: Vec2;
  scale?: number;
  speed?: number;
  seed?: number;
  octaves?: number;
}

/**
 * How many seconds an element runs behind (d · amount, d in 0..1 except by
 * rank): at `pos`, of rank `index` among `count`, at time t; the field
 * spans the points `extent` (the frame's corners, or every instance), which
 * scale the angle and the distance. Continuous in the position, the time,
 * the amount and the seed: a seed or an amount animated slides, never jumps.
 */
export function timeDelay(f: TimeField, pos: Vec2, index: number, count: number, extent: Vec2[], t: number, center?: Vec2): number {
  return fieldOf(f, extent, center)(pos[0], pos[1], index, count, t);
}

/**
 * The same delay as a function of the element, its field read once (the
 * span of the extent along the angle, the farthest point from the centre):
 * a field over N elements costs N, not N².
 */
export function fieldOf(f: TimeField, extent: Vec2[], center?: Vec2): (x: number, y: number, index: number, count: number, t: number) => number {
  switch (f.mode) {
    case 'rank': return (_x, _y, index, count) => f.amount * (f.from === 'last' ? count - 1 - index : index);
    case 'angle': {
      const a = ((f.angle ?? 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      let lo = Infinity, hi = -Infinity;
      for (const p of extent) { const d = p[0] * ca + p[1] * sa; if (d < lo) lo = d; if (d > hi) hi = d; }
      return hi > lo ? (x, y) => (f.amount * (x * ca + y * sa - lo)) / (hi - lo) : () => 0;
    }
    case 'distance': {
      const c = center ?? f.center ?? [0, 0];
      let far = 1e-9;
      for (const p of extent) far = Math.max(far, Math.hypot(p[0] - c[0], p[1] - c[1]));
      return (x, y) => f.amount * Math.min(1, Math.hypot(x - c[0], y - c[1]) / far);
    }
    case 'noise': {
      const seed = f.seed ?? 0, scale = f.scale ?? 300;
      if (scale <= 0) {
        // a fixed random delay per element; a seed between two whole ones blends theirs
        const s0 = Math.floor(seed), k = seed - s0, r = (index: number, s: number) => hash(index * 977 + s * 7919 + 13);
        return (_x, _y, index) => f.amount * (r(index, s0) * (1 - k) + r(index, s0 + 1) * k);
      }
      return (x, y, _i, _n, t) => {
        const n = fbm(x / scale, y / scale + seed * 1.37, t * (f.speed ?? 0) + seed * 0.71, f.octaves ?? 2);
        return f.amount * Math.min(1, Math.max(0, (n + 1) / 2));
      };
    }
  }
}

/** a local time inside a span [a, b]: repeated when `loop`, else held at its ends */
export function boundTime(t: number, a: number, b: number, loop: boolean): number {
  if (!(b > a)) return t;
  if (loop) return a + ((((t - a) % (b - a)) + (b - a)) % (b - a));
  return Math.min(b, Math.max(a, t));
}

export const timeField: ModifierType = {
  type: 'timeField', title: 'Time field', description: 'reads the animation later for some elements than for others: by rank, along a direction, by distance to a point or a layer, or by noise (a wave, a ripple, a liquid time)',
  params: {
    mode: { type: 'enum', default: 'rank', options: ['rank', 'angle', 'distance', 'noise'], label: 'By' },
    amount: { type: 'number', default: 0.5, step: 0.01, unit: 's', label: 'Delay', description: 'rank: per element; otherwise across the whole field' },
    from: { type: 'enum', default: 'first', options: ['first', 'last'], label: 'Starting from' },
    angle: { type: 'number', default: 0, step: 1, unit: 'deg', label: 'Direction' },
    center: { type: 'vec2', default: null, nullable: true, unit: 'px', label: 'Centre', description: 'distance: from this point (the composition\'s centre by default)' },
    source: { type: 'layer', default: null, nullable: true, label: 'From layer', description: 'distance: from this layer\'s position instead' },
    scale: { type: 'number', default: 300, min: 0, step: 10, unit: 'px', label: 'Noise size', description: '0: a fixed random delay per element' },
    speed: { type: 'number', default: 0, step: 0.05, label: 'Drift' },
    seed: { type: 'number', default: 0, step: 1, label: 'Seed' },
    loop: { type: 'bool', default: false, label: 'Loop', description: 'repeat the animation outside its keyframes instead of holding its ends' },
  },
  apply(_v, p, c) {
    const size = c.size ?? [1920, 1080], corners: Vec2[] = [[0, 0], [size[0], 0], [size[0], size[1]], [0, size[1]]];
    const pos = c.position?.('', c.t) ?? [size[0] / 2, size[1] / 2];
    const center = p.mode === 'distance' ? (p.source ? c.position?.(String(p.source), c.t) ?? undefined : (p.center as Vec2 | null) ?? [size[0] / 2, size[1] / 2]) : undefined;
    const t = c.t - timeDelay(p as TimeField, pos, c.index, c.count, corners, c.t, center);
    // keyframes hold their ends by themselves; looped, the time goes round their span
    return c.base(p.loop === true && c.keys?.length ? boundTime(t, c.keys[0].t, c.keys[c.keys.length - 1].t, true) : t);
  },
};

export const stagger: ModifierType = {
  type: 'stagger', title: 'Offset', description: 'offsets the animation by the layer\'s rank among its siblings',
  params: {
    delay: { type: 'number', default: 0.06, step: 0.01, unit: 's', label: 'Offset' },
    from: { type: 'enum', default: 'first', options: ['first', 'last'], label: 'Starting from' },
  },
  // the rank case of the time field
  apply: (v, p, c) => timeField.apply(v, { mode: 'rank', amount: p.delay, from: p.from }, c),
};

export const noise: ModifierType = {
  type: 'noise', title: 'Variation', description: 'fixed random offset, different for each sibling layer',
  params: {
    amp: { type: 'number', default: 20, step: 0.5, label: 'Amplitude' },
    seed: { type: 'number', default: 0, step: 1, label: 'Seed' },
  },
  apply: (v, p, c) => each(v, (x, i) => x + p.amp * (hash(c.index * 977 + i * 131 + p.seed * 7919 + c.seed) * 2 - 1)),
};

export const smooth: ModifierType = {
  type: 'smooth', title: 'Smoothing', description: 'smooths the curve with a moving average',
  params: { window: { type: 'number', default: 0.2, min: 0, step: 0.01, unit: 's', label: 'Window' } },
  apply(v, p, c) {
    if (p.window <= 0 || !(isNum(v) || isVec(v))) return v;
    const n = 9;
    let acc: unknown = scale(v, 0);
    for (let i = 0; i < n; i++) acc = add(acc, c.base(c.t + ((i + 0.5) / n - 0.5) * p.window));
    return scale(acc, 1 / n);
  },
};


/** follows the music: the value moves with the beats, the bars, the hits or the loudness of a band */
export const react: ModifierType = {
  type: 'react', title: 'React to sound', description: 'moves with the beats or the loudness of an analysed sound',
  params: {
    source: { type: 'string', default: '', label: 'Sound', description: 'a sound or video layer id, or the asset of its analysis' },
    signal: { type: 'enum', default: 'beat', options: ['beat', 'bar', 'hit', 'rms', 'low', 'mid', 'high'], label: 'Follows' },
    amount: { type: 'number', default: 0.1, step: 0.01, label: 'Amount' },
    decay: { type: 'number', default: 0.2, min: 0.02, step: 0.01, unit: 's', label: 'Decay', description: 'how fast a beat, bar or hit fades' },
  },
  apply(v, p, c) {
    const a = c.audio?.(String(p.source ?? ''));
    if (!a) return v;
    const s = p.signal === 'beat' ? a.pulse(p.decay) : p.signal === 'bar' ? a.barPulse(p.decay) : p.signal === 'hit' ? a.hit(p.decay) : a.energy(p.signal);
    return each(v, (x) => x + p.amount * s);
  },
};

/**
 * Answers a moving layer — the pointer: the value moves by `amount` as the
 * pointer comes within `radius`, then springs back when it leaves (the
 * hairline figures: pillars that rise, keys that sink, cards that lift). The
 * layer and its pointer must sit in the same space (siblings).
 */
export const near: ModifierType = {
  type: 'near', title: 'Near the pointer', description: "answers a moving layer (the pointer): the value moves by an amount as it comes within a radius, on a spring",
  params: {
    source: { type: 'layer', default: null, nullable: true, label: 'Answers', description: 'the layer whose position is the pointer' },
    radius: { type: 'number', default: 260, min: 1, step: 10, unit: 'px', label: 'Radius', description: 'how far the pointer is still answered' },
    amount: { type: 'number', default: 1, step: 0.05, label: 'Amount', description: 'how far the value moves at the closest, in its own unit' },
    axis: { type: 'enum', default: 'both', options: ['both', 'x', 'y'], label: 'Axis', description: 'the component of a vector that moves (a number always moves)' },
    mode: { type: 'enum', default: 'lift', options: ['lift', 'push'], label: 'Mode', description: 'lift: along the axis; push: away from the pointer' },
    freq: { type: 'number', default: 2.2, min: 0.1, step: 0.1, unit: 'x', label: 'Spring (Hz)' },
    damping: { type: 'number', default: 0.5, min: 0.02, max: 1, step: 0.01, label: 'Damping' },
  },
  apply(v, p, c) {
    const source = p.source == null ? '' : String(p.source);
    if (!source || !c.position || !(isNum(v) || isVec(v))) return v;
    const here = c.position('', c.t);
    if (!here) return v;
    // how close the pointer is over the spring's window: 1 under it, 0 past the radius
    const closeness = (t: number): number => {
      const q = c.position!(source, t);
      if (!q) return 0;
      const x = Math.min(1, Math.hypot(q[0] - here[0], q[1] - here[1]) / Math.max(1, p.radius));
      return 1 - x * x * (3 - 2 * x);
    };
    // the spring's response to that moving closeness: superposed step responses,
    // as the spring modifier does across keyframes, here across a sampled window
    const settle = Math.min(2.5, Math.max(0.2, 3 / (Math.max(0.02, p.damping) * 2 * Math.PI * Math.max(0.1, p.freq))));
    const t0 = Math.max(0, c.t - settle), n = 14;
    let u = closeness(t0), ring = u;
    for (let i = 1; i <= n; i++) {
      const t = t0 + ((c.t - t0) * i) / n;
      const next = closeness(t);
      ring += (next - u) * springStep(c.t - t, p.freq, p.damping);
      u = next;
    }
    if (p.mode === 'push' && isVec(v)) {
      const q = c.position!(source, c.t) ?? here;
      const dx = here[0] - q[0], dy = here[1] - q[1], len = Math.hypot(dx, dy) || 1;
      return v.map((_, i) => v[i] + ((i ? dy : dx) / len) * p.amount * ring);
    }
    const axis = p.axis === 'x' ? 0 : p.axis === 'y' ? 1 : -1;
    return isNum(v) ? v + p.amount * ring : v.map((x, i) => (axis < 0 || i === axis ? x + p.amount * ring : x));
  },
};

/** notes for the assistant: when each built-in modifier fits */
const MODIFIER_NOTES: Record<string, AiNotes> = {
  wiggle: { when: 'handheld camera feel (position amp 4 to 10 px, freq 0.6 to 1.2), floating elements, flicker', avoid: 'high frequency on large objects (nervous)' },
  loop: { when: 'repeating an animation: pingpong for breathing, cycle for spinners' },
  spring: { when: 'lively entrances and pops: freq 2 to 3, damping 0.4 to 0.6 gives one or two bounces' },
  stagger: { when: 'cascading entrances of siblings (words, bars, list items): delay 0.04 to 0.08 s per item' },
  noise: { when: 'varying a value across siblings without motion (sizes, rotations of a scatter)' },
  smooth: { when: 'softening jittery keyframes or tracked data' },
  react: { when: 'making things move with the music once it has an analysis (the beats tool): scale +0.06 on beat for a pulse, opacity on hit for flashes, position on low for a bounce', example: { type: 'react', source: 'music', signal: 'beat', amount: 0.06, decay: 0.18 } },
  timeField: { when: 'one animation played at different moments across elements: a wave (angle), a ripple from a point or a layer (distance), a liquid time (noise with drift), a random desynchronisation (noise, scale 0); amount 0.3 to 1.2 s across the field; put it on every animated property of the element, the same settings', avoid: 'amounts longer than the animation itself, which leave elements still while others finish (the reading breaks); loop only for animations made to repeat', example: { type: 'timeField', mode: 'distance', amount: 0.8 } },
  near: { when: 'figures that answer a pointer: keyframe a small layer as the pointer, then let the shapes around it rise, sink or lean (freq 2 to 3, damping 0.45 to 0.6); the layer and its pointer must be siblings', avoid: 'amounts that break the drawing (a scale past 2, an offset past a cell): the rest pose is the picture, the pointer is a bonus', example: { type: 'near', source: 'pointer', radius: 240, amount: 1.4, axis: 'y', freq: 2.4, damping: 0.55 } },
};

export const BUILTIN_MODIFIERS = [wiggle, loop, spring, stagger, noise, smooth, react, near, timeField];
for (const mod of BUILTIN_MODIFIERS) mod.ai = MODIFIER_NOTES[mod.type];

/** default params filled in */
export function modifierParams(m: ModifierType, mod: Modifier): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(m.params)) out[k] = mod[k] ?? d.default;
  return out;
}

/** a stable seed from an address string */
export function seedOf(address: string): number {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = Math.imul(h ^ address.charCodeAt(i), 0x5bd1e995);
  return (hash(h) * 1000) | 0;
}
