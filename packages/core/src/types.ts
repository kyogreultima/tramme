// The Tramme document, version 1. The JSON file is the source of truth:
// everything the editor, the AI and the renderer know lives here.
// Collections of things that can be edited (layers, assets, tokens,
// compositions) are maps keyed by id, so a patch path stays valid while
// other items are added, removed or reordered. Order lives in explicit arrays.

export const SCHEMA_VERSION = 'tramme/1';
/** the same format under the tool's former names (trame, before that emotion); read, then saved as tramme/1 */
export const LEGACY_SCHEMA_VERSIONS = ['trame/1', 'emotion/1'];

/** a document of a former name, brought to today's version (the content is the same) */
export function upgradeDoc<T>(raw: T): T {
  if (raw && typeof raw === 'object' && LEGACY_SCHEMA_VERSIONS.includes((raw as { schema?: string }).schema ?? '')) (raw as unknown as { schema: string }).schema = SCHEMA_VERSION;
  return raw;
}

export type Vec2 = [number, number];

/** cubic-bezier control points, CSS style: [x1, y1, x2, y2] */
export type Bezier = [number, number, number, number];

/** ease of the segment that starts at a keyframe: a preset, a curve, or an ease token ('@swift') */
export type EaseSpec = 'linear' | 'hold' | Bezier | `@${string}`;

export interface Keyframe<T = unknown> {
  /** time in seconds, composition time */
  t: number;
  v: T;
  /** ease towards the next keyframe (default linear) */
  ease?: EaseSpec;
}

/** a modifier of the stack applied after the value is computed (see modifiers.ts) */
export interface ModifierSpec { type: string; [param: string]: unknown }

/**
 * A property is one of:
 *   static      the raw JSON value, or { $v: value, $mod: [...] } when modifiers apply to it
 *   keyframes   { $k: [...] }, optionally with an expression on top ($expr reads it as `value`)
 *   expression  { $expr: 'js' }
 *   link        { $link: 'layerId.prop' | 'layerId.transform.position' | '@token' }
 * Every non-raw form may carry $mod, a stack of modifiers applied in order.
 */
/** a distribution's rule taking the colours in turn (`order`) or at random: `colors`, else the document's colour tokens */
export interface PaletteRule { $palette: 'order' | 'random'; seed?: number; colors?: string[] }

export interface StaticProp<T = unknown> { $v: T; $mod?: ModifierSpec[] }
export interface KeyframedProp<T = unknown> { $k: Keyframe<T>[]; $expr?: string; $mod?: ModifierSpec[] }
export interface ExprProp { $expr: string; $mod?: ModifierSpec[] }
export interface LinkProp { $link: string; $mod?: ModifierSpec[] }
export type Prop<T = unknown> = T | StaticProp<T> | KeyframedProp<T> | ExprProp | LinkProp;

export type TokenType = 'color' | 'number' | 'ease' | 'string' | 'vec2';
export interface Token {
  type: TokenType;
  value: unknown;
  description?: string;
}

export type AssetType = 'image' | 'font' | 'audio' | 'video' | 'module' | 'json' | 'model' | 'lut';
export interface Asset {
  type: AssetType;
  /** path relative to the document, or an absolute URL path served by the host */
  src: string;
  name?: string;
  /** font: CSS family registered for this file, weight range ('200 800'), style */
  family?: string;
  weight?: string;
  style?: string;
  /** image: region of interest in image pixels [x0, y0, x1, y1], used by fit and focus */
  box?: [number, number, number, number];
  /** hash of the file's content, kept at import: a file already in the project is answered with this asset rather than imported again */
  hash?: string;
  /** the models that made this file (a cut-out's matte, a depth map, a transcript), with their version: another model later never changes it */
  madeBy?: string[];
  /** video: the asset of a lighter copy (the proxy tool) the editor's preview may play instead; exports always read this one */
  proxy?: string;
  /** sound or video: the sound asset of its voice cleaned (the denoise tool), timed like it; a layer plays it with its `clean` amount */
  clean?: string;
  /** video: a copy with frames made up between its frames (the interpolate tool), timed like it; a layer slowed under 1× plays it */
  interpolated?: string;
}

export interface Transform {
  /** point of the layer's local space placed at `position` (px) */
  anchor?: Prop<Vec2>;
  position?: Prop<Vec2>;
  /** factor, 1 = 100 % */
  scale?: Prop<Vec2>;
  /** degrees, clockwise */
  rotation?: Prop<number>;
  /** 0..1 */
  opacity?: Prop<number>;
  /** px behind the screen (negative: in front), for the composition camera */
  depth?: Prop<number>;
}

/** a 2.5D camera: layers at a depth move with parallax and blur away from the focus */
export interface Camera {
  pan?: Prop<Vec2>;
  zoom?: Prop<number>;
  perspective?: Prop<number>;
  focus?: Prop<number>;
  blur?: Prop<number>;
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'add';

export interface Effect {
  id: string;
  type: string;
  enabled?: boolean;
  props?: Record<string, Prop>;
}

/** a mask drawn on a layer: its props follow MASK_SCHEMA (path, mode, feather, expansion, opacity, invert) */
export interface Mask {
  id: string;
  enabled?: boolean;
  props?: Record<string, Prop>;
}

export interface Layer {
  /** node type in the registry: 'shape.rect', 'text', 'image', 'group', 'code', ... */
  type: string;
  name?: string;
  /** visible range in composition time (seconds), in inclusive, out exclusive; defaults to the whole composition */
  in?: number;
  out?: number;
  /** hidden layers are not drawn but can still serve as a clip */
  visible?: boolean;
  locked?: boolean;
  /** id of a layer whose path clips this one (in the same parent space) */
  clip?: string;
  /** sequences: the track this clip sits on */
  track?: string;
  /** sequences: clips sharing a link id move, split and are deleted together (a video and its detached sound) */
  link?: string;
  blend?: BlendMode;
  transform?: Transform;
  props?: Record<string, Prop>;
  effects?: Effect[];
  /** drawn masks, in order: each adds to, takes from or intersects what the ones before it let through */
  masks?: Mask[];
  /** container layers only (group): child ids, bottom to top */
  children?: string[];
  /** comp layers (an instance of a component): a value per parameter the composition exposes */
  params?: Record<string, Prop>;
  /** comp layers: properties of the component set for this instance alone, by their address in it ('title.text', 'card.transform.position') */
  overrides?: Record<string, Prop>;
  /** styles and animations of the document applied to this layer, in order: each sets its properties over the layer's own, the later over the earlier */
  styles?: StyleUse[];
  /** comp layers: N instances at once, placed by a layout, each parameter given by a rule */
  distribute?: Distribution;
}

/** where the instances of a distribution go, in the comp layer's own space (centred on its origin) */
export type Layout =
  /** rows of `columns` (default: as square as the count allows), `spacing` [x, y] apart */
  | { type: 'grid'; columns?: number; spacing?: Vec2 }
  /** a line, `spacing` apart */
  | { type: 'list'; direction?: 'horizontal' | 'vertical'; spacing?: number }
  /** around a circle from `start` degrees (0: right, -90: top) over `sweep` degrees; `rotate` turns each one with its angle */
  | { type: 'circle'; radius?: number; start?: number; sweep?: number; rotate?: boolean }
  /** evenly along a path (vertices and tangents as a shape.path writes them); `rotate` turns each one along it */
  | { type: 'path'; path: { v: Vec2[]; i?: Vec2[]; o?: Vec2[]; closed?: boolean }; rotate?: boolean }
  /** on the vertices of another layer's path, in the same parent: one instance per vertex */
  | { type: 'points'; layer: string };

/**
 * N instances of a component at once. The count is `count`, else one per
 * row of `rows` (a JSON asset holding an array), else one per point of a
 * `points` layout. Each parameter of `params` is given by a rule: a value
 * (the same for all), an expression reading `index`, `count`, `row` (and
 * `random(seed)`, `noise(x)`, `t`...), or the palette in order or at random.
 */
export interface Distribution {
  count?: number;
  rows?: string;
  layout: Layout;
  params?: Record<string, unknown>;
  /** each instance plays the component later by a time field over the instances: a wave, a ripple, a liquid time */
  time?: DistributionTime;
}

/**
 * A time field over a distribution's instances (as the timeField modifier
 * reads it): `rank`, `angle`, `distance` (from `center`, in the comp layer's
 * space, its origin by default) or `noise`. `amount` and `seed` may be
 * keyframed: they slide. An instance's time before the component's start or
 * past its end holds the first or the last pose, or goes round with `loop`.
 */
export interface DistributionTime {
  mode: 'rank' | 'angle' | 'distance' | 'noise';
  amount: Prop<number>;
  from?: 'first' | 'last';
  angle?: number;
  center?: Vec2;
  scale?: number;
  speed?: number;
  seed?: Prop<number>;
  loop?: boolean;
}

/**
 * A parameter a composition exposes, which makes it a component: each
 * instance (a comp layer) gives it a value, which lands on every target, an
 * address in the composition ('card.fill', 'title.transform.position',
 * 'glow.effects.blur.radius', '$comp.background'). Without a value from the
 * instance, the default; without a default, the targets keep their own.
 */
export interface ComponentParam {
  /** a property type of the schema: number, vec2, color, text, asset... */
  type: string;
  targets: string[];
  default?: unknown;
  /** enum parameters: the values accepted */
  options?: string[];
  label?: string;
  description?: string;
}

/** a set of properties defined once (a look, or an animation when they are keyframed), applied to any layer that has them */
export interface Style {
  /** by the property's name on the layer ('fill', 'transform.opacity') */
  props: Record<string, Prop>;
  description?: string;
}

/** a style applied to a layer */
export interface StyleUse {
  style: string;
  /** seconds its keyframes are moved by: an animation written from 0 played from `at` */
  at?: number;
  /** a style's property applied to another one of the layer: { 'transform.scale': 'size' } */
  map?: Record<string, string>;
}

export interface Marker {
  id: string;
  t: number;
  label?: string;
  /** free category; the engine knows 'cut' (motion blur never straddles it) and 'hold' (frozen grain after it) */
  kind?: string;
  duration?: number;
}

export interface MotionBlur {
  /** sub-frames per frame (1 = off) */
  samples: Prop<number>;
  /** shutter as a fraction of the frame duration */
  shutter: Prop<number>;
}

/** a lane of a sequence: its clips follow one another, a video track draws, an audio track plays */
export interface Track {
  id: string;
  name?: string;
  kind: 'video' | 'audio';
  locked?: boolean;
  hidden?: boolean;
  muted?: boolean;
  solo?: boolean;
  /** clips of this track close their gaps by themselves and ripple when one is removed or trimmed */
  magnetic?: boolean;
  /** lane height in the timeline, px */
  height?: number;
}

export interface Composition {
  name: string;
  width: number;
  height: number;
  fps: number;
  /** seconds */
  duration: number;
  /** 'sequence': a film put together on `tracks`; the engine reads it like any composition */
  kind?: 'sequence';
  /** the lanes of a sequence, bottom to top */
  tracks?: Track[];
  /** plate under the layers; null for a transparent render */
  background?: Prop<string> | null;
  motionBlur?: MotionBlur;
  /** 2.5D camera; without it, depth does nothing */
  camera?: Camera;
  markers?: Marker[];
  /** finishing effects applied to the whole frame */
  effects?: Effect[];
  /** how its sound is finished: the master's loudness (LUFS, null: as mixed) and the share of the room the effects have in common */
  sound?: { loudness?: number | null; room?: number };
  layers: Record<string, Layer>;
  /** root stack, bottom to top */
  order: string[];
  /** what it exposes as a component: its comp layers give these values */
  params?: Record<string, ComponentParam>;
}

export interface TrammeDoc {
  /** optional link to the JSON Schema, for editors */
  $schema?: string;
  schema: typeof SCHEMA_VERSION;
  meta: { title: string; description?: string; [k: string]: unknown };
  tokens: Record<string, Token>;
  assets: Record<string, Asset>;
  /** looks and animations defined once, applied to layers by name (Layer.styles) */
  styles?: Record<string, Style>;
  compositions: Record<string, Composition>;
  /** composition rendered by default */
  root: string;
  /**
   * module assets that extend the vocabulary: each exports `nodes` and/or
   * `effects` (arrays of NodeType / EffectType), registered before validation
   */
  plugins?: string[];
}
