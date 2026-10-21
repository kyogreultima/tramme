// Components (docs/components-roadmap.md, step 1). A composition that
// exposes parameters is a component; a comp layer that holds it is an
// instance: a value per parameter, and overrides of any property by its
// address in the component. The Evaluator reads the component through the
// instance (instanceProps below): every address a parameter targets, and
// every override, answers with the instance's value instead of its own. A
// style is a set of properties defined once and applied to any layer that
// has them; keyframed, it is an animation, moved in time where it is used.

import { pointer, type Op } from './ops.ts';
import { asKeyframed, propKind, staticValue } from './props.ts';
import { CAMERA_SCHEMA, MASK_SCHEMA, MOTION_BLUR_SCHEMA, SOUND_MIX_SCHEMA, TRANSFORM_SCHEMA, type PropDef, type PropType, type Registry } from './registry.ts';
import { hash } from './math.ts';
import { boundTime } from './modifiers.ts';
import type { ComponentParam, Composition, Distribution, Layer, Layout, PaletteRule, Prop, TrammeDoc, Vec2 } from './types.ts';

/** a component's parameters as read by one instance: the property each address takes instead of its own */
export interface Instance {
  /** the same for two instances that read the component the same way (the Evaluator's caches) */
  key: string;
  props: Map<string, Prop>;
  /** in a distribution: its rank and the number of instances, which the component's modifiers and expressions read as index and count */
  rank?: [number, number];
  /** in a distribution over a data asset: its row, read as `row` */
  row?: unknown;
}

/** the types a parameter can take: those of the schema's properties */
export const PARAM_TYPES: readonly PropType[] = ['number', 'vec2', 'bool', 'color', 'paint', 'enum', 'string', 'text', 'ease', 'path', 'asset', 'assets', 'comp', 'layer', 'json'];

/** a value of type `from` can land on a property of type `to` (a colour on a paint, a line on a text) */
export function paramFits(from: string, to: PropType): boolean {
  return from === to || (from === 'color' && to === 'paint') || ((from === 'string' || from === 'text') && (to === 'string' || to === 'text'));
}

/** the property definition of a parameter: its type, its default, its options */
export function paramDef(p: ComponentParam): PropDef {
  return { type: p.type as PropType, default: p.default ?? null, nullable: true, label: p.label, description: p.description, ...(p.options ? { options: p.options } : {}) };
}

/**
 * What a property address of a composition holds, without evaluating it:
 * a layer's property ('card.fill'), its transform, an effect's or a mask's
 * property, an instance's parameter ('card.params.color'), or a setting of
 * the composition ('$comp.background'). Null when there is nothing there.
 */
export function addressDef(doc: TrammeDoc, registry: Registry, comp: Composition, address: string): PropDef | null {
  const [lid, a, b, c, ...rest] = address.split('.');
  if (lid === '$comp') {
    if (a === 'background' && b === undefined) return { type: 'color', default: null, nullable: true };
    if (a === 'motionBlur' && c === undefined) return MOTION_BLUR_SCHEMA[b] ?? null;
    if (a === 'camera' && c === undefined) return CAMERA_SCHEMA[b] ?? null;
    if (a === 'sound' && c === undefined) return SOUND_MIX_SCHEMA[b] ?? null;
    if (a === 'effects' && !rest.length) {
      const fx = (comp.effects || []).find((e) => e.id === b);
      return fx && registry.hasEffect(fx.type) ? registry.effect(fx.type).props[c] ?? null : null;
    }
    return null;
  }
  const layer = comp.layers[lid];
  if (!layer || a === undefined || rest.length) return null;
  if (a === 'transform') return c === undefined ? TRANSFORM_SCHEMA[b] ?? null : null;
  if (a === 'effects') {
    const fx = (layer.effects || []).find((e) => e.id === b);
    return fx && registry.hasEffect(fx.type) ? registry.effect(fx.type).props[c] ?? null : null;
  }
  if (a === 'masks') return (layer.masks || []).some((m) => m.id === b) ? MASK_SCHEMA[c] ?? null : null;
  if (a === 'params') {
    const p = c === undefined ? componentOf(doc, layer)?.params?.[b] : undefined;
    return p ? paramDef(p) : null;
  }
  if (b !== undefined || !registry.hasNode(layer.type)) return null;
  return registry.node(layer.type).props[a] ?? null;
}

/** the composition a comp layer holds, when it names one */
export function componentOf(doc: TrammeDoc, layer: Layer): Composition | null {
  if (layer.type !== 'comp') return null;
  const id = staticValue(layer.props?.comp);
  return typeof id === 'string' ? doc.compositions[id] ?? null : null;
}

/**
 * The properties an instance sets in its component: each parameter's value
 * (`values`, already evaluated in the composition holding the instance) on
 * every one of its targets, then the overrides, which win. A parameter with
 * neither a value nor a default leaves its targets as they are.
 */
export function instanceProps(comp: Composition, values: Record<string, unknown>, overrides?: Record<string, Prop>): Map<string, Prop> {
  const out = new Map<string, Prop>();
  for (const [name, p] of Object.entries(comp.params || {})) {
    const v = name in values ? values[name] : p.default;
    if (v === undefined) continue;
    // always wrapped: an object value is never read as keyframes or a link
    for (const target of p.targets) out.set(target, { $v: v });
  }
  for (const [address, prop] of Object.entries(overrides || {})) out.set(address, prop);
  return out;
}

/** a property moved `at` seconds later: its keyframes (the rest holds no time) */
export function shiftProp(prop: Prop, at: number): Prop {
  if (!at || propKind(prop) !== 'keyframes') return prop;
  const kp = asKeyframed(prop);
  return { ...kp, $k: kp.$k.map((k) => ({ ...k, t: Math.round((k.t + at) * 1e6) / 1e6 })) };
}

/**
 * The properties a layer's styles set, by their name on the layer
 * ('fill', 'transform.opacity'): each style's in order, the later over the
 * earlier, renamed by its `map`, its keyframes moved by its `at`. Null when
 * the layer has none.
 */
export function styleProps(doc: TrammeDoc, layer: Layer): Map<string, Prop> | null {
  if (!layer.styles?.length) return null;
  const out = new Map<string, Prop>();
  for (const use of layer.styles) {
    const style = doc.styles?.[use.style];
    if (!style) continue;
    for (const [name, prop] of Object.entries(style.props)) out.set(use.map?.[name] ?? name, shiftProp(prop, use.at ?? 0));
  }
  return out;
}

export type DetachError = 'not-instance' | 'distributed' | 'timing' | 'time' | 'camera' | 'finish' | 'rect';
export interface DetachPlan { ops: Op[]; ids: string[] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** does any value of x (deeply) carry one of these keys */
const carries = (x: unknown, keys: string[]): boolean =>
  Array.isArray(x) ? x.some((y) => carries(y, keys)) : isObj(x) ? Object.entries(x).some(([k, v]) => keys.includes(k) || carries(v, keys)) : false;
/** does any expression in x read the composition holding it (its size, its markers) */
const readsComp = (x: unknown): boolean =>
  Array.isArray(x) ? x.some(readsComp) : isObj(x) ? Object.entries(x).some(([k, v]) => (k === '$expr' && typeof v === 'string' && /\bcomp\.|marker\(/.test(v)) || (k === '$link' && typeof v === 'string' && v.startsWith('$comp')) || readsComp(v)) : false;

/**
 * Detach (docs/components-roadmap.md, step 1): the operations that turn the
 * instance `layerId` into plain layers of the composition holding it, which
 * draw the same. The comp layer becomes a group (same id, transform,
 * effects, masks and timing) holding the composition's background, the clip
 * of its frame when it crops, and its layers under new ids, moved to the
 * holding composition's time, with every parameter and override written
 * into them (parameters as the instance gives them, keyframes and all).
 * Refused when the copy could not draw the same: a time that does not run
 * one to one, or an expression or modifier that reads the time while the
 * copy is moved; an expression reading the composition itself; a camera or
 * finishing effects on the component. The layers keep their ids where the
 * composition has none of them: a modifier's noise, seeded by its address,
 * then draws the same too.
 */
export function detachPlan(doc: TrammeDoc, registry: Registry, compId: string, layerId: string): DetachPlan | { error: DetachError } {
  const host = doc.compositions[compId], L = host?.layers[layerId], inner = L && componentOf(doc, L);
  if (!L || !inner) return { error: 'not-instance' };
  // a distribution's instances are read from its rules at each instant: not one copy
  if (L.distribute) return { error: 'distributed' };
  const innerId = String(staticValue(L.props?.comp));
  const P = L.props || {};
  const timed = (k: string) => P[k] !== undefined && propKind(P[k]) !== 'static';
  if (timed('start') || timed('speed') || timed('loop') || timed('remap') || staticValue(P.loop) === true || (staticValue(P.remap) ?? null) !== null || (Number(staticValue(P.speed) ?? 1) !== 1)) return { error: 'timing' };
  if (inner.camera) return { error: 'camera' };
  if (inner.effects?.some((e) => e.enabled !== false)) return { error: 'finish' };
  // composition time = the component's + dt
  const dt = Math.round(((L.in ?? 0) - (Number(staticValue(P.start)) || 0)) * 1e6) / 1e6;
  const own = { layers: inner.layers, overrides: L.overrides, styles: Object.values(inner.layers).map((l) => (l.styles || []).map((u) => doc.styles?.[u.style])) };
  if (readsComp(own)) return { error: 'time' };
  if (dt !== 0 && carries(own, ['$expr', '$mod'])) return { error: 'time' };
  const crop = staticValue(P.crop) !== false;
  if ((crop || (inner.background ?? null) !== null) && !registry.hasNode('shape.rect')) return { error: 'rect' };

  // the component's ids where they are free (a modifier's noise is seeded by its address), else the instance's id before them
  const taken = new Set(Object.keys(host.layers)), rename = new Map<string, string>();
  const fresh = (base: string) => { let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`; taken.add(id); return id; };
  for (const id of Object.keys(inner.layers)) rename.set(id, taken.has(id) ? fresh(`${layerId}-${id}`) : fresh(id));
  const renamed = (s: string) => rename.get(s) ?? s;
  // a property of the component in the holding composition: its keyframes moved, the layers it names renamed
  const move = (prop: Prop, def: PropDef | null): Prop => {
    let p = shiftProp(prop, dt);
    if (isObj(p) && typeof p.$link === 'string' && !p.$link.startsWith('@')) {
      const [first, ...rest] = (p.$link as string).split('.');
      p = { ...p, $link: [renamed(first), ...rest].join('.') };
    }
    if (isObj(p) && typeof p.$expr === 'string') {
      p = { ...p, $expr: (p.$expr as string).replace(/(['"`])([A-Za-z0-9_-]+)(?=[.'"`])/g, (m, q: string, id: string) => (rename.has(id) ? q + rename.get(id) : m)) };
    }
    if (def?.type === 'layer' && propKind(p) === 'static') {
      const v = staticValue(p);
      if (typeof v === 'string') p = isObj(p) && '$v' in p ? { ...p, $v: renamed(v) } : renamed(v);
    }
    return p;
  };
  const moveAll = (props: Record<string, Prop> | undefined, defs: Record<string, PropDef>) =>
    props && Object.fromEntries(Object.entries(props).map(([k, v]) => [k, move(v, defs[k] ?? null)]));
  const effectDefs = (type: string) => (registry.hasEffect(type) ? registry.effect(type).props : {});

  const layers: Record<string, Layer> = {};
  for (const [id, l] of Object.entries(inner.layers)) {
    const nodeDefs = registry.hasNode(l.type) ? registry.node(l.type).props : {};
    const c: Layer = { ...structuredClone(l), in: Math.round(((l.in ?? 0) + dt) * 1e6) / 1e6, out: Math.round(((l.out ?? inner.duration) + dt) * 1e6) / 1e6 };
    if (l.props) c.props = moveAll(l.props, nodeDefs);
    if (l.transform) c.transform = moveAll(l.transform as Record<string, Prop>, TRANSFORM_SCHEMA);
    if (l.effects) c.effects = l.effects.map((e) => ({ ...e, ...(e.props ? { props: moveAll(e.props, effectDefs(e.type)) } : {}) }));
    if (l.masks) c.masks = l.masks.map((m) => ({ ...m, ...(m.props ? { props: moveAll(m.props, MASK_SCHEMA) } : {}) }));
    if (l.overrides) c.overrides = Object.fromEntries(Object.entries(l.overrides).map(([k, v]) => [k, shiftProp(v, dt)]));
    if (l.params) c.params = moveAll(l.params, {});
    if (l.styles) c.styles = l.styles.map((u) => ({ ...u, at: Math.round(((u.at ?? 0) + dt) * 1e6) / 1e6 }));
    if (l.clip) c.clip = renamed(l.clip);
    if (l.children) c.children = l.children.map(renamed);
    layers[rename.get(id)!] = c;
  }
  // the parameters as the instance gives them (in this composition's time already), then the overrides
  let background: Prop | null | undefined = inner.background === undefined ? undefined : inner.background === null ? null : move(inner.background, null);
  const put = (address: string, prop: Prop) => {
    const [lid, a, b, c] = address.split('.');
    if (lid === '$comp') { if (a === 'background') background = prop; return; }
    const l = layers[renamed(lid)];
    if (!l) return;
    if (a === 'transform') l.transform = { ...l.transform, [b]: prop };
    else if (a === 'effects') l.effects = l.effects?.map((e) => (e.id === b ? { ...e, props: { ...e.props, [c]: prop } } : e));
    else if (a === 'masks') l.masks = l.masks?.map((m) => (m.id === b ? { ...m, props: { ...m.props, [c]: prop } } : m));
    else if (a === 'params') l.params = { ...l.params, [b]: prop };
    else l.props = { ...l.props, [a]: prop };
  };
  for (const [name, p] of Object.entries(inner.params || {})) {
    const v = L.params?.[name] ?? (p.default === undefined ? undefined : { $v: p.default });
    if (v !== undefined) for (const target of p.targets) put(target, v);
  }
  for (const [address, prop] of Object.entries(L.overrides || {})) put(address, move(prop, addressDef(doc, registry, inner, address)));

  // the group in the instance's place: its frame centred on the instance's origin, as the comp node draws it
  const { width: w, height: h } = inner, children: string[] = [];
  const extra: Record<string, Layer> = {};
  const frame = crop ? fresh(`${layerId}-frame`) : undefined;
  if (frame) {
    extra[frame] = { type: 'shape.rect', name: 'Frame', visible: false, props: { size: [w, h] } };
    children.push(frame);
  }
  if (background !== undefined && background !== null) {
    // cut by the frame as well: its edges drawn as the nested composition's are
    const id = fresh(`${layerId}-background`);
    extra[id] = { type: 'shape.rect', name: 'Background', ...(frame ? { clip: frame } : {}), props: { size: [w, h], fill: background } };
    children.push(id);
  }
  const content = fresh(`${layerId}-content`);
  extra[content] = { type: 'group', name: inner.name, transform: { anchor: [w / 2, h / 2] }, ...(frame ? { clip: frame } : {}), children: inner.order.map(renamed) };
  children.push(content);
  const group: Layer = {
    type: 'group', name: L.name ?? inner.name,
    ...Object.fromEntries((['in', 'out', 'visible', 'locked', 'clip', 'blend', 'transform', 'effects', 'masks', 'styles'] as const).filter((k) => L[k] !== undefined).map((k) => [k, L[k]])),
    children,
  };
  const at = (id: string) => pointer('compositions', compId, 'layers', id);
  const ops: Op[] = [
    ...Object.entries({ ...layers, ...extra }).map(([id, l]): Op => ({ op: 'add', path: at(id), value: l })),
    { op: 'replace', path: at(layerId), value: group },
  ];
  return { ops, ids: [...Object.keys(extra), ...Object.keys(layers)] };
}

// ── distribution (step 2) ───────────────────────────────────

/** where one instance of a distribution goes: its offset in the comp layer's space, its turn in degrees; with a time field, how late it runs and whether it loops */
export interface Placement { at: Vec2; rotation: number; delay?: number; loop?: boolean }

/**
 * An instance's own time under a time field: later by its delay, holding the
 * component's first or last pose (or going round, looped) while the layer's
 * own time is inside the component
 */
export function instanceTime(lt: number, one: Placement, duration: number): number {
  if (!one.delay) return lt;
  if (one.loop) return boundTime(lt - one.delay, 0, duration, true);
  return lt >= 0 && lt < duration ? Math.min(duration - 1e-3, Math.max(0, lt - one.delay)) : lt;
}

/** how many instances a distribution makes */
export function distributionCount(d: Distribution, rows: unknown[] | null, points: Vec2[] | null): number {
  const n = d.count ?? rows?.length ?? (d.layout.type === 'points' ? points?.length : undefined) ?? 1;
  return Math.max(0, Math.min(MAX_INSTANCES, Math.floor(n)));
}

/** more is a mistake, not a film */
export const MAX_INSTANCES = 10000;

/** the placements of n instances by a layout; `points` gives a points layout its vertices, already in the layer's space */
export function layoutPlacements(layout: Layout, n: number, points: Vec2[] | null = null): Placement[] {
  const { x, y, rotation } = layoutBatch(layout, n, points);
  return Array.from({ length: n }, (_, i) => ({ at: [x[i], y[i]] as Vec2, rotation: rotation[i] }));
}

/** the same placements in typed arrays, one pass over the instances (the shape a WebAssembly module would take) */
export function layoutBatch(layout: Layout, n: number, points: Vec2[] | null = null): { x: Float64Array; y: Float64Array; rotation: Float64Array } {
  const x = new Float64Array(n), y = new Float64Array(n), rotation = new Float64Array(n);
  switch (layout.type) {
    case 'grid': {
      const cols = Math.max(1, layout.columns ?? Math.ceil(Math.sqrt(n))), rows = Math.ceil(n / cols), [sx, sy] = layout.spacing ?? [100, 100];
      for (let i = 0; i < n; i++) { x[i] = ((i % cols) - (cols - 1) / 2) * sx; y[i] = (Math.floor(i / cols) - (rows - 1) / 2) * sy; }
      break;
    }
    case 'list': {
      const s = layout.spacing ?? 100, v = layout.direction === 'vertical';
      for (let i = 0; i < n; i++) { const k = (i - (n - 1) / 2) * s; if (v) y[i] = k; else x[i] = k; }
      break;
    }
    case 'circle': {
      const r = layout.radius ?? 300, start = layout.start ?? -90, sweep = layout.sweep ?? 360;
      // a whole turn: n gaps (the last does not land on the first); an arc: from end to end
      const step = n > 1 ? sweep / (Math.abs(Math.abs(sweep) - 360) < 1e-9 ? n : n - 1) : 0;
      for (let i = 0; i < n; i++) {
        const a = start + i * step, rad = (a * Math.PI) / 180;
        x[i] = r * Math.cos(rad); y[i] = r * Math.sin(rad);
        if (layout.rotate) rotation[i] = a + 90;
      }
      break;
    }
    case 'path': {
      const s = pathSampler(layout.path), gaps = layout.path.closed ? n : n - 1;
      for (let i = 0; i < n; i++) {
        const { at, angle } = s(gaps > 0 ? i / gaps : 0);
        x[i] = at[0]; y[i] = at[1];
        if (layout.rotate) rotation[i] = angle;
      }
      break;
    }
    case 'points':
      for (let i = 0; i < n; i++) { x[i] = points?.[i]?.[0] ?? 0; y[i] = points?.[i]?.[1] ?? 0; }
      break;
  }
  return { x, y, rotation };
}

/** a point along a path at a fraction of its length, and its direction there in degrees */
export function pathSampler(p: { v: Vec2[]; i?: Vec2[]; o?: Vec2[]; closed?: boolean }): (u: number) => { at: Vec2; angle: number } {
  const pts: Vec2[] = [], STEPS = 32, n = p.v.length;
  const segs = n < 2 ? 0 : p.closed ? n : n - 1;
  if (n) pts.push(p.v[0]);
  for (let k = 0; k < segs; k++) {
    const a = p.v[k], b = p.v[(k + 1) % n], o = p.o?.[k] ?? [0, 0], i = p.i?.[(k + 1) % n] ?? [0, 0];
    const c1: Vec2 = [a[0] + o[0], a[1] + o[1]], c2: Vec2 = [b[0] + i[0], b[1] + i[1]];
    for (let s = 1; s <= STEPS; s++) {
      const t = s / STEPS, m = 1 - t;
      pts.push([m * m * m * a[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * b[0], m * m * m * a[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * b[1]]);
    }
  }
  const len = [0];
  for (let k = 1; k < pts.length; k++) len.push(len[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const total = len[len.length - 1];
  return (u) => {
    if (pts.length < 2 || total <= 0) return { at: pts[0] ?? [0, 0], angle: 0 };
    const d = Math.min(1, Math.max(0, u)) * total;
    let k = 1;
    while (k < len.length - 1 && len[k] < d) k++;
    const f = len[k] > len[k - 1] ? (d - len[k - 1]) / (len[k] - len[k - 1]) : 0, a = pts[k - 1], b = pts[k];
    return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI };
  };
}

export const isPaletteRule = (r: unknown): r is PaletteRule => isObj(r) && (r.$palette === 'order' || r.$palette === 'random');

/** the colour a palette rule gives instance i: its colours, else the document's colour tokens (as references), in turn or at random */
export function paletteColor(doc: TrammeDoc, r: PaletteRule, i: number): string | null {
  const colors = r.colors?.length ? r.colors : Object.entries(doc.tokens).filter(([, t]) => t.type === 'color').map(([name]) => `@${name}`);
  if (!colors.length) return null;
  const k = r.$palette === 'order' ? i % colors.length : Math.floor(hash(i * 7919 + (r.seed ?? 0) * 104729 + 1) * colors.length) % colors.length;
  return colors[k];
}

// ── defining a component from what exists (step 4) ─────────

export interface DefinePlan { ops: Op[]; component: string; instance: string }

/**
 * The operations that turn layers of a composition (siblings, with their
 * children) into a component and one instance of it in their place, which
 * draws the same: the component's frame is `box` (where they are drawn, in
 * the composition's pixels; the whole frame by default), the layers keep
 * their ids and times inside it, moved by a group so they stay where they
 * were, and the instance sits on the box's centre without cropping. `params`
 * expose what will vary: a name, the addresses it lands on (the layers' own:
 * 'title.text'), its type (the first target's by default) and its default.
 */
export function defineComponentPlan(doc: TrammeDoc, registry: Registry, compId: string, ids: string[], opts: { id: string; name?: string; box?: { x: number; y: number; w: number; h: number }; params?: Record<string, { targets: string[]; type?: string; default?: unknown; label?: string }> }): DefinePlan | { error: string } {
  const host = doc.compositions[compId];
  if (!host) return { error: `no composition "${compId}"` };
  if (!ids.length) return { error: 'no layers given' };
  const missing = ids.filter((id) => !host.layers[id]);
  if (missing.length) return { error: `no such layer: ${missing.join(', ')}` };
  if (doc.compositions[opts.id]) return { error: `a composition "${opts.id}" exists already` };
  // one stack: the composition's or a group's
  const parentOf = (id: string) => Object.entries(host.layers).find(([, l]) => l.children?.includes(id))?.[0] ?? null;
  const parent = parentOf(ids[0]);
  if (ids.some((id) => parentOf(id) !== parent)) return { error: 'the layers must be siblings (in the same group or all at the root)' };
  const stack = parent ? host.layers[parent].children! : host.order;
  const chosen = stack.filter((id) => ids.includes(id));
  // the layers with their children
  const all: string[] = [];
  const take = (id: string) => { all.push(id); for (const c of host.layers[id].children ?? []) take(c); };
  chosen.forEach(take);
  if (readsComp(all.map((id) => host.layers[id]))) return { error: 'an expression or a link of these layers reads the composition (its size, its markers): it would read the component\'s' };
  const outside = all.map((id) => host.layers[id].clip).filter((c): c is string => !!c && !all.includes(c));
  if (outside.length) return { error: `clipped by layers left outside: ${[...new Set(outside)].join(', ')}` };

  const box = opts.box ?? { x: 0, y: 0, w: host.width, h: host.height };
  const w = Math.max(1, Math.round(box.w)), h = Math.max(1, Math.round(box.h)), x = Math.round(box.x), y = Math.round(box.y);
  const taken = new Set([...Object.keys(host.layers)]);
  const fresh = (base: string) => { let id = base.replace(/[^A-Za-z0-9_-]/g, '') || 'component', n = 2; const b = id; while (taken.has(id)) id = `${b}${n++}`; taken.add(id); return id; };
  const inner = fresh('content');
  const layers: Record<string, Layer> = { [inner]: { type: 'group', name: 'Content', transform: { position: [-x, -y] }, children: chosen } };
  for (const id of all) layers[id] = host.layers[id];
  const params: Record<string, ComponentParam> = {};
  const comp: Composition = { name: opts.name ?? opts.id, width: w, height: h, fps: host.fps, duration: host.duration, layers, order: [inner] };
  for (const [name, p] of Object.entries(opts.params ?? {})) {
    const def = p.targets.length ? addressDef(doc, registry, comp, p.targets[0]) : null;
    if (!def) return { error: `the parameter "${name}" lands on nothing: ${p.targets[0] ?? '(no target)'}` };
    params[name] = { type: p.type ?? def.type, targets: p.targets, ...(p.default !== undefined ? { default: p.default } : {}), ...(p.label ? { label: p.label } : {}) };
  }
  if (Object.keys(params).length) comp.params = params;

  const instance = fresh(opts.id);
  const at = (id: string) => pointer('compositions', compId, 'layers', id);
  const first = stack.indexOf(chosen[chosen.length - 1]);
  const rest = stack.filter((id) => !chosen.includes(id));
  // the instance where the topmost of them was
  rest.splice(first - (chosen.length - 1), 0, instance);
  return {
    component: opts.id, instance,
    ops: [
      { op: 'add', path: pointer('compositions', opts.id), value: comp },
      ...all.map((id): Op => ({ op: 'remove', path: at(id) })),
      { op: 'add', path: at(instance), value: { type: 'comp', name: opts.name ?? opts.id, transform: { position: [x + w / 2, y + h / 2] }, props: { comp: opts.id, crop: false } } },
      { op: 'replace', path: parent ? pointer('compositions', compId, 'layers', parent, 'children') : pointer('compositions', compId, 'order'), value: rest },
    ],
  };
}
