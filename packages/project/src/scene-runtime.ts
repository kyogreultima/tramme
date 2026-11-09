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
  /** resolves once what the current seek asked for (a video frame) has arrived; the capture waits for it before taking the picture */
  ready(): Promise<void>;
}
type Seek = (t: number, params: SceneParams) => void;

// What the scene's video element and its stand-in need, as structures: this file also builds for the worker, which has no DOM types.
interface ImageLike { naturalWidth: number; naturalHeight: number; onload: (() => void) | null; onerror: (() => void) | null; src: string }
interface VideoLike {
  dataset: Record<string, string | undefined>;
  muted: boolean; currentTime: number; duration: number;
  poster: string;
  pause(): void; load(): void; removeAttribute(name: string): void;
}

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
  const waits = new Set<Promise<unknown>>();
  const track = (p: Promise<unknown>) => { waits.add(p); void p.finally(() => waits.delete(p)); };
  const ready = async () => { while (waits.size) await Promise.allSettled([...waits]); };
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
    ready,
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
    ready,
    /**
     * A video of the scene, shown for the time asked. The export extracts its frames beforehand and
     * serves them (the element carries data-frames, data-fps and data-frame-count): the element then
     * has no source and shows the picture of the time as its poster, so the scene's own CSS (size,
     * object-fit, filters) applies to it as to any video. Without them, as in the editor's preview, the
     * browser's own decoder is seeked. `data-start` (s) is when the video begins in the scene.
     */
    video(el: VideoLike) {
      const start = Number(el.dataset.start ?? 0) || 0;
      const base = el.dataset.frames;
      if (!base) {
        el.muted = true; el.pause();
        return add((t) => {
          const at = Math.max(0, t - start);
          if (Math.abs(el.currentTime - at) > 1e-3) el.currentTime = Number.isFinite(el.duration) ? Math.min(at, el.duration) : at;
        });
      }
      const fps = Number(el.dataset.fps), count = Number(el.dataset.frameCount);
      if (!(fps > 0) || !(count > 0)) throw new Error('scene video: data-fps and data-frame-count are needed with data-frames');
      el.removeAttribute('src'); el.removeAttribute('autoplay'); el.muted = true; el.load();
      const images = new Map<number, ImageLike>();
      const frame = (i: number) => `${base}${String(i).padStart(6, '0')}.jpg`;
      const later = (globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => unknown }).requestAnimationFrame ?? ((cb: () => void) => setTimeout(cb, 16));
      let wanted = 0, shown = -1;
      const show = (i: number) => {
        if (shown === i) return;
        shown = i;
        el.poster = frame(i);
        // the browser paints the poster a frame or two after it is set: the capture waits for it
        track(new Promise<void>((resolve) => later(() => later(() => resolve()))));
      };
      return add((t) => {
        const i = Math.max(0, Math.min(count - 1, Math.floor((t - start) * fps + 1e-6)));
        wanted = i;
        const img = images.get(i);
        if (img) { if (img.naturalWidth) show(i); return; }
        const made = new (globalThis as unknown as { Image: new () => ImageLike }).Image();
        images.set(i, made);
        track(new Promise<void>((resolve) => {
          made.onload = () => { if (wanted === i) show(i); resolve(); };
          made.onerror = () => resolve();
          made.src = frame(i);
        }));
      });
    },
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
