// Small browser-side contract for a seekable web scene. Every adapter moves to
// absolute scene time; none advances from the previous frame or starts a loop.
/** the values of the scene's parameters at the instant being drawn: plain numbers, strings and booleans */
export type SceneParams = Readonly<Record<string, number | string | boolean>>;
export interface SeekableScene {
  duration: number;
  /** the parameters as the host last set them (empty until it does) */
  readonly params: SceneParams;
  seek(t: number): void;
  /** the host sets the parameters for the instant it is about to seek to; the scene draws again at the current time */
  setParams(values: SceneParams): void;
}
type Seek = (t: number, params: SceneParams) => void;

const MAX_PARAMS = 64;
function checkedParams(values: unknown): SceneParams {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('scene parameters must be an object');
  const entries = Object.entries(values);
  if (entries.length > MAX_PARAMS) throw new Error('too many scene parameters');
  for (const [name, value] of entries) {
    const ok = (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 4096);
    if (!ok) throw new Error(`scene parameter "${name}" must be a finite number, a string or a boolean`);
  }
  return Object.freeze({ ...(values as Record<string, number | string | boolean>) });
}

export function sceneController(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('scene duration must be positive and finite');
  const adapters: Seek[] = [];
  let current = 0;
  let params: SceneParams = Object.freeze({});
  const invoke = (adapter: Seek, t: number) => {
    const result = adapter(t, params) as unknown;
    if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('scene seek adapters must be synchronous');
  };
  const add = (adapter: Seek) => {
    adapters.push(adapter);
    try { invoke(adapter, current); } catch (error) { adapters.pop(); throw error; }
    return () => { const index = adapters.indexOf(adapter); if (index >= 0) adapters.splice(index, 1); };
  };
  const contract: SeekableScene = {
    duration,
    get params() { return params; },
    setParams(values) {
      params = checkedParams(values);
      for (const adapter of adapters) invoke(adapter, current);
    },
    seek(t) {
      if (!Number.isFinite(t)) throw new Error('scene time must be finite');
      current = Math.max(0, Math.min(duration, t));
      for (const adapter of adapters) invoke(adapter, current);
    },
  };
  const css = (root: { getAnimations(): { pause(): void; currentTime: number | null }[] }) =>
    add((t) => { for (const animation of root.getAnimations()) { animation.pause(); animation.currentTime = t * 1000; } });
  return {
    duration,
    get params() { return params; },
    seek: contract.seek,
    setParams: contract.setParams,
    /** a function of the scene time and its parameters, called on every seek and whenever the parameters change */
    register: add,
    /** CSS animations and WAAPI animations share the browser's Animation clock (milliseconds). */
    css,
    waapi: css,
    /** SVG SMIL uses seconds, and its own clock must stay paused. */
    svg(root: { pauseAnimations(): void; setCurrentTime(t: number): void }) {
      return add((t) => { root.pauseAnimations(); root.setCurrentTime(t); });
    },
    gsap(timeline: { pause(): unknown; time(t: number, suppressEvents?: boolean): unknown }) {
      return add((t) => { timeline.pause(); timeline.time(t, true); });
    },
    /** Lottie's time-valued goToAndStop uses milliseconds, unlike its frame option. */
    lottie(animation: { goToAndStop(t: number, isFrame?: boolean): void; setSubframe?(enabled: boolean): void }) {
      animation.setSubframe?.(true);
      return add((t) => animation.goToAndStop(t * 1000, false));
    },
    three(mixer: { setTime(t: number): unknown }, render: () => void) {
      return add((t) => { mixer.setTime(t); render(); });
    },
    /** The low-level capture engine and the iframe preview both call this contract. */
    install(target: { __hf?: SeekableScene }) { target.__hf = contract; return contract; },
  };
}
