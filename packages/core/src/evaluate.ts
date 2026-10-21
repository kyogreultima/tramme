// eval(doc, t): the resolved scene at one instant, a pure function of t.
// One Evaluator per document version (documents are immutable: an edit makes
// a new one). Within a frame each property is computed once (memo) and
// expressions or links that read other properties record the dependency, so
// cycles are reported and the editor can show what drives what. Static
// properties are cached across frames.

import { componentOf, distributionCount, instanceProps, isPaletteRule, layoutBatch, paletteColor, paramDef, styleProps, type Instance, type Placement } from './components.ts';
import { applyMat, invertMat, layerMatrix } from './math.ts';
import { audioReader, type AudioReader } from './analysis.ts';
import { eventsReader, type EventsReader } from './events.ts';
import { integrate, mediaClockOf, mediaMoments, mediaTime, trackId, trackReader, type MediaClock, type TrackReader } from './track.ts';
import { compileExpr, type ExprScope } from './expr.ts';
import { fieldOf, modifierParams, seedOf, type ModifierContext, type ModifierType, type TimeField } from './modifiers.ts';
import { asExpr, asKeyframed, asLink, easeFn, modsOf, propKind, resolveTokens, sampleKeyframes, staticValue, tokenValue } from './props.ts';
import { CAMERA_SCHEMA, MASK_SCHEMA, MOTION_BLUR_SCHEMA, SOUND_MIX_SCHEMA, TRANSFORM_SCHEMA, type NodeType, type PathValue, type PropDef, type Registry } from './registry.ts';
import type { Composition, TrammeDoc, KeyframedProp, Layer, Marker, ModifierSpec, Prop, Vec2 } from './types.ts';

export interface EvaluatedTransform {
  anchor: Vec2;
  position: Vec2;
  scale: Vec2;
  rotation: number;
  opacity: number;
  depth: number;
}

export interface EvaluatedCamera { pan: Vec2; zoom: number; perspective: number; focus: number; blur: number }

export interface EvaluatedEffect {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

export interface EvaluatedLayer {
  id: string;
  layer: Layer;
  node: NodeType;
  props: Record<string, unknown>;
  transform: EvaluatedTransform;
  /** enabled layer effects with their props at this instant */
  effects: EvaluatedEffect[];
  /** enabled drawn masks with their props at this instant (path, mode, feather, expansion, opacity, invert) */
  masks: { id: string; props: Record<string, unknown> }[];
  children: EvaluatedLayer[];
  clip: EvaluatedLayer | null;
}

export interface EvaluatedFrame {
  compId: string;
  comp: Composition;
  t: number;
  frame: number;
  background: string | null;
  motionBlur: { samples: number; shutter: number };
  /** the 2.5D camera, when the composition has one */
  camera: EvaluatedCamera | null;
  effects: EvaluatedEffect[];
  /** active, visible layers of the root stack, bottom to top */
  layers: EvaluatedLayer[];
  /** the instance it was read through, when the composition is a component held by a comp layer */
  instance?: Instance;
}

export class EvalError extends Error {
  readonly address: string;
  constructor(address: string, message: string) {
    super(`${address} : ${message}`);
    this.address = address;
  }
}

/** a property slot: where its value lives in the document and how to read it */
interface Slot { prop: Prop | undefined; def: PropDef; /** set by the instance read: never cached across instances */ inst?: boolean }

interface FrameCtx {
  compId: string;
  comp: Composition;
  t: number;
  frame: number;
  memo: Map<string, unknown>;
  stack: string[];
  /** the instance the composition is read through: the properties its parameters and overrides set */
  inst?: Instance;
  /** values read at other instants through base(t), by address (and modifiers applied) then time: shared by the contexts one evaluation spawns */
  at: Map<string, Map<number, unknown>>;
  /** the composition's fixed values (the Evaluator's static cache), found once per context */
  fixed?: Map<string, unknown>;
}

const COMP_DEFS: Record<string, PropDef> = {
  background: { type: 'color', default: null, nullable: true },
};

export function layerActive(layer: Layer, comp: Composition, t: number): boolean {
  return t >= (layer.in ?? 0) && t < (layer.out ?? comp.duration);
}

/** how a composition layer runs the composition it holds: from `start` at its in point, at `speed`, looping or not; `remap` gives the time directly */
export interface NestedTiming { start: number; speed: number; loop: boolean; remap: number | null }

/** the local time of a nested composition at time t of the one holding it */
export function nestedTime(p: NestedTiming, t: number, layerIn: number, duration: number): number {
  let lt = p.remap ?? p.start + (t - layerIn) * p.speed;
  if (p.loop && duration > 0) lt = ((lt % duration) + duration) % duration;
  return lt;
}

export interface EvaluatorOptions {
  /** the loaded content of a JSON asset (analyses), when the caller has it: the renderer does */
  data?(assetId: string): unknown;
}

export class Evaluator {
  readonly doc: TrammeDoc;
  readonly registry: Registry;
  private data?: (assetId: string) => unknown;
  /** address -> addresses it read, from the last evaluations */
  readonly deps = new Map<string, Set<string>>();
  /** fixed values, by composition then address */
  private staticCache = new Map<string, Map<string, unknown>>();

  constructor(doc: TrammeDoc, registry: Registry, opts: EvaluatorOptions = {}) {
    this.doc = doc;
    this.registry = registry;
    this.data = opts.data;
  }

  /**
   * The music at time t from its analysis (asset analysis-<media>). The
   * source is a sound or video layer (its own time: in point and start in
   * the file), or an asset id: the analysis itself, or the media analysed.
   */
  private audioAt(ctx: FrameCtx, source: string): AudioReader {
    const layer = ctx.comp.layers[source];
    let asset = source, t = ctx.t;
    if (layer && (layer.type === 'audio' || layer.type === 'video')) {
      asset = String(staticValue(layer.props?.[layer.type]) ?? '');
      const start = Number(staticValue(layer.props?.start) ?? 0) || 0;
      t = ctx.t - (layer.in ?? 0) + start;
    }
    const a = this.doc.assets[asset];
    const id = a && a.type !== 'json' ? `analysis-${asset}`.slice(0, 64) : asset;
    return audioReader(this.data?.(id), t);
  }

  /** an event list at time t (composition time): its asset id, or the name the events tool saved it under (events-<name>) */
  private eventsAt(ctx: FrameCtx, source: string): EventsReader {
    const id = this.doc.assets[source] || !this.doc.assets[`events-${source}`] ? source : `events-${source}`;
    return eventsReader(this.data?.(id), ctx.t);
  }

  /** a track of a video layer at time t: where its object is, in the space the layer sits in (its first track without a name) */
  private trackAt(ctx: FrameCtx, layerId: string, name = ''): TrackReader {
    const layer = ctx.comp.layers[layerId];
    if (!layer || layer.type !== 'video' || !layerActive(layer, ctx.comp, ctx.t)) return trackReader(null, 0, null);
    const asset = String(staticValue(layer.props?.video) ?? '');
    const id = this.doc.assets[name] ? name : name ? trackId(asset, name) : Object.keys(this.doc.assets).find((a) => a.startsWith(`track-${asset}-`)) ?? '';
    // the layer as the video node shows it: its frame, fit and focus, its transform, its clock (start, speed, loop)
    const prop = (p: string) => this.read(ctx, `${layerId}.${p}`);
    const video = {
      size: prop('size') as Vec2, fit: String(prop('fit')), focus: prop('focus') as Vec2,
      transform: this.evalSchema(ctx, `${layerId}.transform`, TRANSFORM_SCHEMA) as unknown as EvaluatedTransform,
    };
    const def = this.registry.node('video').props.rate;
    const elapsed = def?.integral ? this.integralOf(ctx, layerId, 'rate') : null;
    const clock = { start: Number(prop('start')), rate: Number(prop('rate')), loop: prop('loop') === true, loopEnd: Number(prop('loopEnd')), ...(elapsed !== null ? { rateElapsed: elapsed } : {}) };
    return trackReader(this.data?.(id), mediaTime(clock, ctx.t, layer.in ?? 0), video);
  }

  comp(compId = this.doc.root): Composition {
    const c = this.doc.compositions[compId];
    if (!c) throw new Error(`unknown composition: ${compId}`);
    return c;
  }

  /**
   * How an instance reads a component: the parameters' values (evaluated in
   * the composition holding it) on their targets, and the overrides.
   */
  instance(compId: string, values: Record<string, unknown>, overrides?: Record<string, Prop>, key = compId): Instance {
    return { key, props: instanceProps(this.comp(compId), values, overrides) };
  }

  /** a fresh evaluation context at time t */
  private ctxAt(compId: string, comp: Composition, t: number, inst?: Instance): FrameCtx {
    return { compId, comp, t, frame: Math.round(t * comp.fps), memo: new Map(), stack: [], inst, at: new Map() };
  }

  /** the resolved scene of a composition at time t (seconds), read through an instance when it holds one */
  frame(t: number, compId = this.doc.root, inst?: Instance): EvaluatedFrame {
    const comp = this.comp(compId);
    const ctx = this.ctxAt(compId, comp, t, inst);
    const effects: EvaluatedEffect[] = (comp.effects || []).filter((e) => e.enabled !== false).map((e) => ({
      id: e.id, type: e.type, props: this.evalSchema(ctx, `$comp.effects.${e.id}`, this.effectSchema(e.type)),
    }));
    return {
      compId, comp, t, frame: ctx.frame,
      background: this.read(ctx, '$comp.background') as string | null,
      motionBlur: {
        samples: Math.max(1, Math.round(this.read(ctx, '$comp.motionBlur.samples') as number)),
        shutter: this.read(ctx, '$comp.motionBlur.shutter') as number,
      },
      camera: comp.camera ? this.evalSchema(ctx, '$comp.camera', CAMERA_SCHEMA) as unknown as EvaluatedCamera : null,
      effects,
      layers: this.stack(ctx, comp.order),
      ...(inst ? { instance: inst } : {}),
    };
  }

  /** value of one property: 'layerId.prop', 'layerId.transform.position', '$comp.background' */
  value(address: string, t: number, compId = this.doc.root, inst?: Instance): unknown {
    const comp = this.comp(compId);
    return this.read(this.ctxAt(compId, comp, t, inst), address);
  }

  /**
   * A layer's speed curve played to t: the integral of its `rate` from its in
   * point (the file time it ran), or null when its speed holds one value.
   * The editor's tools invert it (mediaMoments) to place what they found in
   * the file back in composition time.
   */
  elapsed(layerId: string, t: number, compId = this.doc.root, prop = 'rate'): number | null {
    const comp = this.comp(compId);
    if (!comp.layers[layerId]) throw new Error(`unknown layer: ${layerId}`);
    return this.integralOf(this.ctxAt(compId, comp, t), layerId, prop);
  }

  /** one layer at time t, whether or not it is active then (node loading, editor) */
  layerAt(id: string, t: number, compId = this.doc.root, inst?: Instance): EvaluatedLayer {
    const comp = this.comp(compId);
    if (!comp.layers[id]) throw new Error(`unknown layer: ${id}`);
    return this.layer(this.ctxAt(compId, comp, t, inst), id);
  }

  // ── layers ─────────────────────────────────────────────────
  private stack(ctx: FrameCtx, ids: string[]): EvaluatedLayer[] {
    const out: EvaluatedLayer[] = [];
    for (const id of ids) {
      const layer = ctx.comp.layers[id];
      if (!layer || layer.visible === false || !layerActive(layer, ctx.comp, ctx.t)) continue;
      out.push(this.layer(ctx, id));
    }
    return out;
  }

  private layer(ctx: FrameCtx, id: string): EvaluatedLayer {
    const layer = ctx.comp.layers[id];
    const node = this.registry.node(layer.type);
    const clipLayer = layer.clip ? ctx.comp.layers[layer.clip] : null;
    const props = this.evalSchema(ctx, id, node.props);
    for (const [name, def] of Object.entries(node.props)) {
      if (!def.integral) continue;
      const elapsed = this.integralOf(ctx, id, name);
      if (elapsed !== null) props[def.integral] = elapsed;
    }
    // an instance of a component: how it reads it, for the node to draw it so
    const inner = componentOf(this.doc, layer);
    if (inner && (inner.params || layer.overrides || layer.distribute)) {
      const values: Record<string, unknown> = {};
      for (const name of Object.keys(inner.params || {})) if (layer.params?.[name] !== undefined) values[name] = this.read(ctx, `${id}.params.${name}`);
      // its key: where it is (the instance's path through the compositions), the same at every frame
      const key = `${ctx.inst ? `${ctx.inst.key}/` : ''}${ctx.compId}/${id}`;
      if (layer.distribute) props.$instances = this.distribute(ctx, id, String(props.comp), values, key);
      else props.$instance = this.instance(String(props.comp), values, layer.overrides, key);
    }
    return {
      id, layer, node,
      props,
      transform: this.evalSchema(ctx, `${id}.transform`, TRANSFORM_SCHEMA) as unknown as EvaluatedTransform,
      effects: (layer.effects || []).filter((e) => e.enabled !== false).map((e) => ({
        id: e.id, type: e.type, props: this.evalSchema(ctx, `${id}.effects.${e.id}`, this.effectSchema(e.type)),
      })),
      masks: (layer.masks || []).filter((mk) => mk.enabled !== false).map((mk) => ({ id: mk.id, props: this.evalSchema(ctx, `${id}.masks.${mk.id}`, MASK_SCHEMA) })),
      children: node.container ? this.stack(ctx, layer.children || []) : [],
      // a clip layer is used even when hidden; it follows its own in/out
      clip: layer.clip && clipLayer && layerActive(clipLayer, ctx.comp, ctx.t) ? this.layer(ctx, layer.clip) : null,
    };
  }

  /**
   * The instances of a distribution: each placed by the layout, its
   * parameters the comp layer's values with the rules over them, its rank
   * and its row (index, count and row for the component's expressions and
   * modifiers).
   */
  private distribute(ctx: FrameCtx, id: string, compId: string, values: Record<string, unknown>, key: string): ({ instance: Instance } & Placement)[] {
    const layer = ctx.comp.layers[id], d = layer.distribute!, inner = this.comp(compId);
    const data = d.rows ? this.data?.(d.rows) : undefined;
    const rows = d.rows ? (Array.isArray(data) ? data : []) : null;
    const points = d.layout.type === 'points' ? this.pointsOf(ctx, id, d.layout.layer) : null;
    const n = distributionCount(d, rows, points);
    // the numbers of every instance in one pass, in typed arrays: their place, their turn, their delay
    const { x, y, rotation } = layoutBatch(d.layout, n, points);
    let delay: Float64Array | null = null;
    if (d.time) {
      // the field over the instances, read once: its amount and seed at this instant (keyframed, they slide)
      const num = (p: Prop<number> | undefined, name: string) => (p === undefined ? 0 : Number(this.computeRaw(ctx, `${id}.distribute.time.${name}`, p, { type: 'number', default: 0 })) || 0);
      const f = { ...d.time, amount: num(d.time.amount, 'amount'), seed: num(d.time.seed, 'seed') } as TimeField;
      const extent: Vec2[] = Array.from({ length: n }, (_, i) => [x[i], y[i]]);
      const field = fieldOf(f, extent, d.time.center ?? [0, 0]);
      delay = new Float64Array(n);
      for (let i = 0; i < n; i++) delay[i] = field(x[i], y[i], i, n, ctx.t);
    }
    // the rules, a parameter at a time; the parameters that no rule gives are the same object for all
    const rules = Object.entries(d.params || {}).flatMap(([name, rule]) => {
      const p = inner.params?.[name];
      return p ? [{ name, rule, def: paramDef(p), base: values[name] ?? p.default ?? null, address: `${id}.distribute.params.${name}` }] : [];
    });
    const out: ({ instance: Instance } & Placement)[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const row = rows?.[i], vals = rules.length ? { ...values } : values;
      for (const r of rules) vals[r.name] = this.ruleValue(ctx, r.address, r.rule, r.def, r.base, i, n, row);
      const inst = this.instance(compId, vals, layer.overrides, `${key}#${i}`);
      inst.rank = [i, n];
      if (row !== undefined) inst.row = row;
      out[i] = { instance: inst, at: [x[i], y[i]], rotation: rotation[i], ...(delay ? { delay: delay[i], ...(d.time!.loop ? { loop: true } : {}) } : {}) };
    }
    return out;
  }

  /** a distribution's rule for instance i of n: the palette, an expression, or a value */
  private ruleValue(ctx: FrameCtx, address: string, rule: unknown, def: PropDef, base: unknown, index: number, count: number, row: unknown): unknown {
    if (isPaletteRule(rule)) return resolveTokens(def.type, paletteColor(this.doc, rule, index) ?? base, this.doc.tokens);
    if (propKind(rule) === 'expression') return this.runExpr(ctx, address, asExpr(rule).$expr, base, def, { index, count, row });
    return resolveTokens(def.type, staticValue(rule), this.doc.tokens);
  }

  /** the vertices of a layer's path (its first path property), in the space of layer `into` (both in the same parent) */
  private pointsOf(ctx: FrameCtx, into: string, source: string): Vec2[] {
    const src = ctx.comp.layers[source];
    if (!src || !this.registry.hasNode(src.type)) return [];
    const name = Object.entries(this.registry.node(src.type).props).find(([, d]) => d.type === 'path')?.[0];
    const pv = name ? this.read(ctx, `${source}.${name}`) as PathValue | null : null;
    if (!pv?.v) return [];
    const from = layerMatrix(this.evalSchema(ctx, `${source}.transform`, TRANSFORM_SCHEMA) as unknown as EvaluatedTransform);
    const to = invertMat(layerMatrix(this.evalSchema(ctx, `${into}.transform`, TRANSFORM_SCHEMA) as unknown as EvaluatedTransform));
    return to ? pv.v.map((v) => applyMat(to, applyMat(from, v))) : [];
  }

  /**
   * ∫ of a layer's number property from its in point to ctx.t, when the
   * property moves (keyframes, an expression, a link, modifiers); null when it
   * holds one value, which its users multiply by the time themselves.
   */
  private integralOf(ctx: FrameCtx, layerId: string, name: string): number | null {
    const address = `${layerId}.${name}`, { prop } = this.slot(ctx, address);
    if (prop === undefined || (propKind(prop) === 'static' && !modsOf(prop))) return null;
    const from = ctx.comp.layers[layerId].in ?? 0;
    const breaks = propKind(prop) === 'keyframes' ? asKeyframed(prop).$k.map((k) => k.t) : [];
    const at = (t: number) => {
      const v = Number(t === ctx.t ? this.read(ctx, address) : this.read({ ...ctx, t, frame: Math.round(t * ctx.comp.fps), memo: new Map(), stack: [...ctx.stack] }, address));
      return Number.isFinite(v) ? v : 0;
    };
    return integrate(at, from, ctx.t, breaks);
  }

  private effectSchema(type: string) {
    return this.registry.hasEffect(type) ? this.registry.effect(type).props : {};
  }

  private evalSchema(ctx: FrameCtx, base: string, schema: Record<string, PropDef>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const name of Object.keys(schema)) out[name] = this.read(ctx, `${base}.${name}`);
    return out;
  }

  // ── addresses ──────────────────────────────────────────────
  /** the property at an address: the document's, then a style's on the layer, then the instance's */
  private slot(ctx: FrameCtx, address: string): Slot {
    // where an address lives in the document depends on it alone (documents are immutable): found once
    let slots = this.slots.get(ctx.comp);
    if (!slots) this.slots.set(ctx.comp, (slots = new Map()));
    let s = slots.get(address);
    if (!s) slots.set(address, (s = this.docSlot(ctx, address)));
    const dot = address.indexOf('.');
    const styled = dot > 0 && address[0] !== '$' ? this.styled(ctx.comp.layers[address.slice(0, dot)])?.get(address.slice(dot + 1)) : undefined;
    const own = ctx.inst?.props.get(address);
    return own !== undefined ? { ...s, prop: own, inst: true } : styled !== undefined ? { ...s, prop: styled } : s;
  }

  private slots = new WeakMap<Composition, Map<string, Slot>>();
  private styles = new WeakMap<Layer, Map<string, Prop> | null>();
  /** the properties a layer's styles set, once per layer */
  private styled(layer: Layer | undefined): Map<string, Prop> | null {
    if (!layer?.styles) return null;
    if (!this.styles.has(layer)) this.styles.set(layer, styleProps(this.doc, layer));
    return this.styles.get(layer)!;
  }

  private docSlot(ctx: FrameCtx, address: string): Slot {
    const parts = address.split('.');
    if (parts[0] === '$comp') {
      if (parts[1] === 'background') return { prop: ctx.comp.background ?? undefined, def: COMP_DEFS.background };
      if (parts[1] === 'motionBlur' && MOTION_BLUR_SCHEMA[parts[2]]) {
        return { prop: (ctx.comp.motionBlur as any)?.[parts[2]], def: MOTION_BLUR_SCHEMA[parts[2]] };
      }
      if (parts[1] === 'camera' && CAMERA_SCHEMA[parts[2]]) {
        return { prop: (ctx.comp.camera as any)?.[parts[2]], def: CAMERA_SCHEMA[parts[2]] };
      }
      if (parts[1] === 'sound' && SOUND_MIX_SCHEMA[parts[2]]) {
        return { prop: (ctx.comp.sound as any)?.[parts[2]] ?? undefined, def: SOUND_MIX_SCHEMA[parts[2]] };
      }
      if (parts[1] === 'effects') {
        const fx = (ctx.comp.effects || []).find((e) => e.id === parts[2]);
        const def = fx && this.effectSchema(fx.type)[parts[3]];
        if (fx && def) return { prop: fx.props?.[parts[3]], def };
      }
      throw new EvalError(address, 'unknown address');
    }
    const layer = ctx.comp.layers[parts[0]];
    if (!layer) throw new EvalError(address, `unknown layer "${parts[0]}"`);
    if (parts[1] === 'transform' && TRANSFORM_SCHEMA[parts[2]]) {
      return { prop: (layer.transform as any)?.[parts[2]], def: TRANSFORM_SCHEMA[parts[2]] };
    }
    if (parts[1] === 'effects') {
      const fx = (layer.effects || []).find((e) => e.id === parts[2]);
      const def = fx && this.effectSchema(fx.type)[parts[3]];
      if (fx && def) return { prop: fx.props?.[parts[3]], def };
      throw new EvalError(address, 'unknown effect or effect property');
    }
    if (parts[1] === 'masks') {
      const mk = (layer.masks || []).find((x) => x.id === parts[2]), def = MASK_SCHEMA[parts[3]];
      if (mk && def) return { prop: mk.props?.[parts[3]], def };
      throw new EvalError(address, 'unknown mask or mask property');
    }
    if (parts[1] === 'params') {
      const p = parts.length === 3 ? componentOf(this.doc, layer)?.params?.[parts[2]] : undefined;
      if (p) return { prop: layer.params?.[parts[2]], def: paramDef(p) };
      throw new EvalError(address, 'unknown parameter');
    }
    const def = this.registry.node(layer.type).props[parts[1]];
    if (!def || parts.length !== 2) throw new EvalError(address, `unknown property for ${layer.type}`);
    return { prop: layer.props?.[parts[1]], def };
  }

  private read(ctx: FrameCtx, address: string): unknown {
    const memo = ctx.memo.get(address);
    if (memo !== undefined || ctx.memo.has(address)) return memo;
    let fixed = ctx.fixed;
    if (!fixed) {
      fixed = this.staticCache.get(ctx.compId);
      if (!fixed) this.staticCache.set(ctx.compId, (fixed = new Map()));
      ctx.fixed = fixed;
    }
    const known = fixed.get(address);
    if ((known !== undefined || fixed.has(address)) && !ctx.inst?.props.has(address)) return known;
    if (ctx.stack.includes(address)) throw new EvalError(address, `circular dependency (${[...ctx.stack, address].join(' → ')})`);
    const { prop, def, inst } = this.slot(ctx, address);
    ctx.stack.push(address);
    let v: unknown;
    try {
      v = this.compute(ctx, address, prop, def);
    } finally {
      ctx.stack.pop();
    }
    // a fixed value reads nothing else: the same in every frame and every instance, except one an instance sets
    if (!inst && (prop === undefined || (propKind(prop) === 'static' && !modsOf(prop)))) fixed.set(address, v);
    else ctx.memo.set(address, v);
    return v;
  }

  private compute(ctx: FrameCtx, address: string, prop: Prop | undefined, def: PropDef): unknown {
    const v = this.computeRaw(ctx, address, prop, def);
    const mods = modsOf(prop);
    return mods ? this.applyMods(ctx, address, prop!, def, v, mods.length) : v;
  }

  /** apply the first `upto` modifiers of the stack to v */
  private applyMods(ctx: FrameCtx, address: string, prop: Prop, def: PropDef, v: unknown, upto: number): unknown {
    const mods = modsOf(prop)!;
    const kp = propKind(prop) === 'keyframes' ? asKeyframed(prop) : null;
    const selfId = address.slice(0, address.indexOf('.') >>> 0);
    // an instance of a distribution: its rank among the instances, and noise of its own
    const [index, count] = ctx.inst?.rank ?? this.rank(ctx.comp, selfId);
    const seed = seedOf(address) + (ctx.inst?.rank ? ctx.inst.rank[0] * 7919 : 0);
    for (let k = 0; k < upto; k++) {
      const spec = mods[k];
      if (!this.registry.hasModifier(spec.type)) throw new EvalError(address, `unknown modifier "${spec.type}"`);
      const m = this.registry.modifier(spec.type);
      const mc: ModifierContext = {
        t: ctx.t, fps: ctx.comp.fps, index, count, seed, size: [ctx.comp.width, ctx.comp.height],
        audio: (source: string) => this.audioAt(ctx, source),
        position: (id: string, t2?: number) => this.layerPosition(ctx, address, id || selfId, t2 ?? ctx.t),
        keys: kp ? kp.$k : null,
        keyValues: kp ? this.keyValues(kp, def) : null,
        base: (t2: number) => this.valueAt(ctx, address, prop, def, t2, k),
      };
      v = m.apply(v, this.modParams(m, spec, ctx.t), mc);
    }
    return v;
  }

  private keyed = new WeakMap<object, unknown[]>();
  /** a keyframed property's key values, tokens resolved, once per property */
  private keyValues(kp: KeyframedProp, def: PropDef): unknown[] {
    let v = this.keyed.get(kp);
    if (!v) this.keyed.set(kp, (v = kp.$k.map((key) => resolveTokens(def.type, key.v, this.doc.tokens))));
    return v;
  }

  private params = new WeakMap<ModifierSpec, { p: Record<string, unknown>; keyed: string[] }>();
  /** a modifier's parameters at time t: its defaults filled in (once per modifier of the document), a keyframed one (an amount, a seed) sampled, so it slides rather than jumps */
  private modParams(m: ModifierType, spec: ModifierSpec, t: number): Record<string, unknown> {
    let c = this.params.get(spec);
    if (!c) {
      const p = modifierParams(m, spec);
      c = { p, keyed: Object.keys(p).filter((k) => m.params[k] && propKind(p[k]) === 'keyframes') };
      this.params.set(spec, c);
    }
    if (!c.keyed.length) return c.p;
    const p = { ...c.p };
    for (const k of c.keyed) p[k] = sampleKeyframes(m.params[k].type, asKeyframed(c.p[k]).$k, t, this.doc.tokens);
    return p;
  }

  /**
   * The position of a layer, as a modifier's pointer: another layer's with
   * everything that drives it (the dependency is recorded); the owning
   * layer's own rest position, without its modifiers, so a modifier never
   * feeds itself.
   */
  private layerPosition(ctx: FrameCtx, from: string, id: string, t: number): Vec2 | null {
    if (!ctx.comp.layers[id]) return null;
    const address = `${id}.transform.position`;
    let v: unknown;
    if (id === from.split('.')[0]) {
      // the rest pose: computed raw (no modifiers), so the modifier cannot feed
      // itself; a cycle through an expression or a link is caught by read
      const { prop, def } = this.slot(ctx, address);
      v = prop === undefined ? def.default : this.computeRaw(ctx, address, prop, def);
    } else {
      this.depend(from, address);
      v = t === ctx.t
        ? this.read(ctx, address)
        : this.read({ ...ctx, t, frame: Math.round(t * ctx.comp.fps), memo: new Map(), stack: [...ctx.stack] }, address);
    }
    return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as Vec2) : null;
  }

  /** the property at another time, with only its first `upto` modifiers */
  private valueAt(ctx: FrameCtx, address: string, prop: Prop, def: PropDef, t: number, upto: number): unknown {
    // the same reading asked again within this evaluation (modifiers reading other instants, a time field over a smoothing)
    const key = upto ? `${address}#${upto}` : address;
    let times = ctx.at.get(key);
    if (!times) ctx.at.set(key, (times = new Map<number, unknown>()));
    if (times.has(t)) return times.get(t);
    const c2: FrameCtx = { ...ctx, t, frame: Math.round(t * ctx.comp.fps), memo: new Map(), stack: [...ctx.stack] };
    const v = this.applyMods(c2, address, prop, def, this.computeRaw(c2, address, prop, def), upto);
    times.set(t, v);
    return v;
  }

  private ranks = new WeakMap<Composition, Map<string, [number, number]>>();
  /** rank of a layer among its siblings (bottom first) and their number */
  private rank(comp: Composition, id: string): [number, number] {
    let m = this.ranks.get(comp);
    if (!m) {
      m = new Map();
      const put = (ids: string[]) => ids.forEach((x, i) => m!.set(x, [i, ids.length]));
      put(comp.order);
      for (const l of Object.values(comp.layers)) if (l.children) put(l.children);
      this.ranks.set(comp, m);
    }
    return m.get(id) ?? [0, 1];
  }

  private computeRaw(ctx: FrameCtx, address: string, prop: Prop | undefined, def: PropDef): unknown {
    const tokens = this.doc.tokens;
    if (prop === undefined) return def.default;
    switch (propKind(prop)) {
      case 'static':
        return resolveTokens(def.type, staticValue(prop), tokens);
      case 'keyframes': {
        const kp = asKeyframed(prop);
        const base = sampleKeyframes(def.type, kp.$k, ctx.t, tokens);
        return kp.$expr === undefined ? base : this.runExpr(ctx, address, kp.$expr, base, def);
      }
      case 'expression':
        return this.runExpr(ctx, address, asExpr(prop).$expr, def.default, def);
      case 'link': {
        const target = asLink(prop).$link;
        if (target.startsWith('@')) return resolveTokens(def.type, tokenValue(tokens, target), tokens);
        this.depend(address, target);
        return this.read(ctx, target);
      }
    }
  }

  private depend(from: string, to: string) {
    let s = this.deps.get(from);
    if (!s) this.deps.set(from, (s = new Set()));
    s.add(to);
  }

  private runExpr(ctx: FrameCtx, address: string, src: string, value: unknown, def: PropDef, at?: { index: number; count: number; row: unknown }): unknown {
    const { comp } = ctx;
    const tokens = this.doc.tokens;
    const [index, count] = at ? [at.index, at.count] : ctx.inst?.rank ?? (address[0] === '$' ? [0, 1] : this.rank(comp, address.split('.')[0]));
    const scope: ExprScope = {
      index, count, row: at ? at.row : ctx.inst?.row,
      t: ctx.t, frame: ctx.frame, fps: comp.fps, value,
      comp: { width: comp.width, height: comp.height, duration: comp.duration, fps: comp.fps },
      prop: (a: string) => { this.depend(address, a); return this.read(ctx, a); },
      token: (name: string) => tokenValue(tokens, name),
      marker: (q: string) => markerInfo(comp, q),
      audio: (source: string) => this.audioAt(ctx, source),
      events: (source: string) => this.eventsAt(ctx, source),
      track: (layer: string, name?: string, at?: number) => {
        this.depend(address, `${layer}.transform.position`);
        const when = typeof at === 'number' && Number.isFinite(at) ? at : ctx.t;
        return this.trackAt(when === ctx.t ? ctx : { ...ctx, t: when, frame: Math.round(when * ctx.comp.fps), memo: new Map(), stack: [...ctx.stack] }, layer, name);
      },
      ease: (spec: unknown, x: number) => {
        const f = easeFn(spec as any, tokens);
        return f === 'hold' ? (x >= 1 ? 1 : 0) : f(x);
      },
    };
    let v: unknown;
    try {
      v = compileExpr(src)(scope);
    } catch (e) {
      if (e instanceof EvalError) throw e;
      throw new EvalError(address, `expression : ${(e as Error).message}`);
    }
    const bad = checkShape(def, v);
    if (bad) throw new EvalError(address, `the expression returns ${JSON.stringify(v)}: ${bad}`);
    return resolveTokens(def.type, v, tokens);
  }
}

export function markerInfo(comp: Composition, q: string) {
  const m: Marker | undefined = (comp.markers || []).find((x) => x.id === q) ||
    (comp.markers || []).find((x) => x.kind === q) || (comp.markers || []).find((x) => x.label === q);
  if (!m) throw new Error(`marker not found: ${q}`);
  return { t: m.t, frame: Math.round(m.t * comp.fps), label: m.label, kind: m.kind };
}

/** minimal runtime check of an expression's result (the validator checks static values) */
function checkShape(def: PropDef, v: unknown): string | null {
  if (v === null && def.nullable) return null;
  switch (def.type) {
    case 'number': return typeof v === 'number' && Number.isFinite(v) ? null : 'number expected';
    case 'vec2': return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? null : '[x, y] expected';
    case 'bool': return typeof v === 'boolean' ? null : 'boolean expected';
    case 'color': case 'string': case 'text': case 'enum': case 'asset': case 'comp': case 'layer': return typeof v === 'string' ? null : 'text expected';
    case 'assets': return Array.isArray(v) && v.every((x) => typeof x === 'string') ? null : 'list of asset ids expected';
    default: return null;
  }
}

/**
 * How a video or sound layer plays its file, for the editor's tools: the
 * file time at a composition time, and the composition times of a file time,
 * through its start, loop and speed (a speed curve integrated, then inverted).
 */
export function layerClock(ev: Evaluator, compId: string, layerId: string): { clock: MediaClock; fileTime: (t: number) => number; moments: (fileTime: number) => number[] } {
  const comp = ev.comp(compId), l = comp.layers[layerId];
  const clock = mediaClockOf(l.props), from = l.in ?? 0, to = l.out ?? comp.duration;
  const elapsedAt = ev.elapsed(layerId, from, compId) === null ? undefined : (t: number) => ev.elapsed(layerId, t, compId) ?? 0;
  return {
    clock,
    fileTime: (t) => mediaTime(elapsedAt ? { ...clock, rateElapsed: elapsedAt(t) } : clock, t, from),
    moments: (x) => mediaMoments(clock, x, from, to, elapsedAt),
  };
}

/** shorthand: eval(doc, t) */
export function evaluate(doc: TrammeDoc, registry: Registry, t: number, compId?: string): EvaluatedFrame {
  return new Evaluator(doc, registry).frame(t, compId);
}
