// The kit a scene builder receives: a script (assets/builds/<name>.js, written by
// the assistant) whose default export is called with it, in the plugin sandbox,
// and adds the layers of one composition. It writes what costs a model hundreds
// of operations — keyframes, entrances, typing, measured text, unique ids — so a
// scene is one short file, changed by editing the file and building again
// (build_scene). Pure: no DOM; the sandbox passes the text measure.

/** what the page tells the sandbox about the composition being built */
export interface BuildData {
  comp: { id: string; width: number; height: number; fps: number; duration: number };
  /** the document's token names (an ease or a colour is used as "@name") */
  tokens: string[];
  /** the document's assets: their type, and a font's family as the engine draws it */
  assets: Record<string, { type: string; family?: string; name?: string }>;
  /** ids of the composition's layers the builder does not own: never given again */
  taken: string[];
}

export interface BuiltLayer {
  type: string;
  name?: string;
  transform?: Record<string, unknown>;
  props: Record<string, unknown>;
  effects?: { id: string; type: string; props?: Record<string, unknown> }[];
  children?: string[];
  [key: string]: unknown;
}

/** what a build gives back: the layers, the root order (bottom first), and the composition's settings it set */
export interface BuildOutput {
  layers: Record<string, BuiltLayer>;
  order: string[];
  set: { duration?: number; background?: unknown; markers?: unknown[]; camera?: unknown; motionBlur?: unknown };
}

/** the width of a line of text, in px, as the engine draws it (family, size, weight, tracking in em, italic) */
export type Measure = (text: string, family: string, size: number, weight: number, tracking: number, italic: boolean) => number;

/** the four curves of the house, for documents without ease tokens */
export const EASES = { out: [0.16, 1, 0.3, 1], in: [0.7, 0, 0.84, 0], std: [0.4, 0, 0.2, 1], back: [0.34, 1.56, 0.64, 1] } as const;

const TRANSFORM = ['anchor', 'position', 'scale', 'rotation', 'opacity', 'depth', 'rotationX', 'rotationY'];
const LAYER = ['in', 'out', 'visible', 'locked', 'clip', 'blend', 'masks', 'styles', 'params', 'overrides', 'distribute'];
const OWN = new Set(['id', 'name', 'effects', 'fx', ...TRANSFORM, ...LAYER]);

type Key = [number, unknown, unknown?];
type KeyList = { $k: { t: number; v: unknown; ease?: unknown }[] };

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const pair = (v: unknown) => (typeof v === 'number' ? [v, v] : v);
/** a scale given as one number, fixed, keyed or modified, is both axes: the document wants [x, y] */
function scaleOf(s: unknown): unknown {
  if (typeof s === 'number') return [s, s];
  if (!s || typeof s !== 'object' || Array.isArray(s)) return s;
  const o = s as Record<string, unknown>;
  if (Array.isArray(o.$k)) return { ...o, $k: (o.$k as { v: unknown }[]).map((k) => ({ ...k, v: pair(k.v) })) };
  if ('$v' in o) return { ...o, $v: pair(o.$v) };
  return s;
}
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

/** a rough width where there is no canvas (tests, the command line): about half an em a character */
export const estimate: Measure = (text, _family, size, _weight, tracking) => text.length * size * (0.55 + tracking);

export function makeKit(data: BuildData, measure: Measure = estimate) {
  const { width, height, fps, duration } = data.comp;
  const layers: Record<string, BuiltLayer> = {};
  const root: string[] = [];
  const parentOf = new Map<string, string>();
  const used = new Set(data.taken);
  const set: BuildOutput['set'] = {};
  const tokens = new Set(data.tokens);

  const idFor = (want: string) => {
    const base = slug(want) || 'layer';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
  /** a curve: the document's token of that name when it has one, else the house's own values */
  const ease = (name: keyof typeof EASES | string): unknown => (tokens.has(name) ? `@${name}` : (EASES as Record<string, unknown>)[name] ?? name);
  /** a step lands between two frames, so the motion blur's shutter (a quarter frame on each side) never blends two values */
  const between = (t: number) => (Math.round(t * fps) + 0.5) / fps;

  /** keyframes from [t, value, ease?] triples; a "hold" anywhere puts every key between two frames */
  const key = (...keys: Key[]): KeyList => {
    const steps = keys.some(([, , e]) => e === 'hold');
    const byTime = new Map<number, { t: number; v: unknown; ease?: unknown }>();
    for (const [t, v, e] of keys) {
      if (!Number.isFinite(t)) throw new Error(`key: time ${t} is not a number`);
      const at = steps ? Math.round(between(t) * 1e4) / 1e4 : r3(t);
      byTime.set(at, { t: at, v, ...(e !== undefined ? { ease: e } : {}) });
    }
    return { $k: [...byTime.values()].sort((a, b) => a.t - b.t) };
  };

  const effectIds = (list: { id?: string; type: string; props?: Record<string, unknown> }[]) => {
    const seen = new Set<string>();
    return list.map((e) => {
      let id = e.id ?? (e.type.split('.').pop() || 'fx');
      for (let n = 2; seen.has(id); n++) id = `${e.id ?? (e.type.split('.').pop() || 'fx')}-${n}`;
      seen.add(id);
      return { ...e, id };
    });
  };

  /** a layer of any type: one object of options, the transform's and the layer's keys taken out, the rest its props */
  const add = (type: string, o: Record<string, any> = {}): string => {
    if (typeof type !== 'string' || !type) throw new Error('add: a layer type is needed');
    const id = idFor(String(o.id ?? o.name ?? type.split('.').pop()));
    const transform: Record<string, unknown> = {};
    for (const k of TRANSFORM) if (o[k] !== undefined) transform[k] = k === 'scale' ? scaleOf(o[k]) : o[k];
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) if (!OWN.has(k) && v !== undefined) props[k] = v;
    const layer: BuiltLayer = { type, ...(o.name ? { name: String(o.name) } : {}), ...(Object.keys(transform).length ? { transform } : {}), props };
    for (const k of LAYER) if (o[k] !== undefined) layer[k] = k === 'in' || k === 'out' ? r3(Number(o[k])) : o[k];
    const fx = [...(o.effects ?? []), ...(o.fx ?? [])];
    if (fx.length) layer.effects = effectIds(fx);
    layers[id] = layer;
    root.push(id);
    return id;
  };

  /** put layers in a group: they leave the root (or the group they were in) and are drawn in its space */
  const group = (children: string[], o: Record<string, any> = {}): string => {
    for (const c of children) if (!layers[c]) throw new Error(`group: no layer "${c}" in this build`);
    const id = add('group', { name: o.name ?? 'Group', ...o });
    for (const c of children) {
      const from = parentOf.get(c);
      if (from) layers[from].children = layers[from].children!.filter((x) => x !== c);
      else root.splice(root.indexOf(c), 1);
      parentOf.set(c, id);
    }
    layers[id].children = [...children];
    return id;
  };

  /**
   * An entrance from t: a fade out of a blur, from an offset (dx, dy) and a scale (from), over dur seconds,
   * landing at `at`. With drift: { until, dx, dy, scale }, it keeps moving slowly once landed, so the hold is never
   * frozen. With exit: { t, dx, dy, dur, to, blur }, it leaves the same way, faster. Spread it in a layer's options.
   */
  const enter = (t: number, o: { at?: [number, number]; dx?: number; dy?: number; from?: number; blur?: number; dur?: number; ease?: unknown; opacity?: number; drift?: { until: number; dx?: number; dy?: number; scale?: number }; exit?: { t: number; dx?: number; dy?: number; to?: number; blur?: number; dur?: number; ease?: unknown } } = {}) => {
    const dur = o.dur ?? 0.35, inE = o.ease ?? ease('out'), to = o.opacity ?? 1;
    const x = o.exit, xd = x?.dur ?? 0.2, outE = x?.ease ?? ease('in');
    const d = o.drift && o.drift.until > t + dur ? o.drift : undefined, landed = t + dur;
    const out: Record<string, unknown> = {
      opacity: key([t, 0, inE], [t + dur * 0.6, to], ...(x ? [[x.t, to, outE], [x.t + xd, 0]] as Key[] : [])),
    };
    if (o.at && (o.dx || o.dy || x?.dx || x?.dy || d?.dx || d?.dy)) {
      const [ax, ay] = o.at, [hx, hy] = [ax + (d?.dx ?? 0), ay + (d?.dy ?? 0)];
      out.position = key([t, [ax + (o.dx ?? 0), ay + (o.dy ?? 0)], inE], [landed, [ax, ay], d ? ease('std') : undefined],
        ...(d ? [[d.until, [hx, hy]]] as Key[] : []),
        ...(x ? [[x.t, [hx, hy], outE], [x.t + xd, [hx + (x.dx ?? 0), hy + (x.dy ?? 0)]]] as Key[] : []));
    } else if (o.at) out.position = o.at;
    if ((o.from !== undefined && o.from !== 1) || (x?.to !== undefined && x.to !== 1) || (d?.scale !== undefined && d.scale !== 1)) {
      const f = o.from ?? 1, e = x?.to ?? 1, h = d?.scale ?? 1;
      out.scale = key([t, [f, f], inE], [landed, [1, 1], d ? ease('std') : undefined],
        ...(d ? [[d.until, [h, h]]] as Key[] : []),
        ...(x ? [[x.t, [h, h], outE], [x.t + xd, [e * h, e * h]]] as Key[] : []));
    }
    const b = o.blur ?? 10, xb = x?.blur ?? 0;
    if (b || xb) out.effects = [{ id: 'enter-blur', type: 'fx.blur', props: { radius: key([t, b, inE], [t + dur, 0], ...(x && xb ? [[x.t, 0, outE], [x.t + xd, xb]] as Key[] : [])) } }];
    return out;
  };

  /** a string typed from t at cps characters a second: the text's keyframes, the time each prefix shows, the end */
  const typing = (str: string, t: number, cps = 30) => {
    const times = Array.from({ length: str.length + 1 }, (_, i) => t + i / cps);
    return { text: key(...times.map((at, i) => [at, str.slice(0, i), 'hold'] as Key)), times, end: t + str.length / cps };
  };

  /** the width in px of a text as the engine draws it: the widest line; font is a font asset id */
  const measureText = (text: string, o: { font?: string | null; size?: number; weight?: number; tracking?: number; italic?: boolean } = {}) => {
    const family = o.font ? data.assets[o.font]?.family ?? o.font : 'sans-serif';
    return Math.max(0, ...String(text).split('\n').map((line) => measure(line, family, o.size ?? 64, o.weight ?? 400, o.tracking ?? 0, !!o.italic)));
  };

  const kit = {
    width, height, fps, duration, cx: width / 2, cy: height / 2,
    tokens: [...data.tokens], assets: data.assets, EASES,
    ease, key, between, enter, typing, measure: measureText,
    add, group,
    text: (text: unknown, o: Record<string, any> = {}) => add('text', { name: typeof text === 'string' ? text.slice(0, 40) : 'Text', baseline: 'middle', ...o, text }),
    rect: (o: Record<string, any> = {}) => add('shape.rect', { name: 'Rectangle', ...o }),
    ellipse: (o: Record<string, any> = {}) => add('shape.ellipse', { name: 'Ellipse', ...o }),
    path: (o: Record<string, any> = {}) => add('shape.path', { name: 'Path', ...o }),
    image: (asset: string, o: Record<string, any> = {}) => add('image', { name: data.assets[asset]?.name ?? asset, ...o, image: asset }),
    video: (asset: string, o: Record<string, any> = {}) => add('video', { name: data.assets[asset]?.name ?? asset, ...o, video: asset }),
    comp: (comp: string, o: Record<string, any> = {}) => add('comp', { name: comp, ...o, comp }),
    sound: (asset: string, at: number, o: Record<string, any> = {}) => add('audio', { name: data.assets[asset]?.name ?? asset, ...o, audio: asset, in: at }),
    blur: (radius: unknown) => ({ type: 'fx.blur', props: { radius } }),
    shadow: (o: { color?: unknown; blur?: unknown; offset?: unknown } = {}) => ({ type: 'fx.shadow', props: { color: o.color ?? '#0000002e', blur: o.blur ?? 30, offset: o.offset ?? [0, 12] } }),
    /** the composition's own settings: duration, background, markers, camera, motionBlur */
    set: (o: BuildOutput['set']) => { Object.assign(set, o); },
  };

  /** the layers once the script has run: every layer in one place, the root bottom first */
  const finish = (): BuildOutput => ({ layers, order: [...root], set });
  return { kit, finish };
}

export type BuildKit = ReturnType<typeof makeKit>['kit'];
