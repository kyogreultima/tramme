// Small browser-side contract for a seekable web scene. Every adapter moves to
// absolute scene time; none advances from the previous frame or starts a loop.
export interface SeekableScene { duration: number; seek(t: number): void }
type Seek = (t: number) => void;

export function sceneController(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('scene duration must be positive and finite');
  const adapters: Seek[] = [];
  let current = 0;
  const invoke = (adapter: Seek, t: number) => {
    const result = adapter(t) as unknown;
    if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('scene seek adapters must be synchronous');
  };
  const add = (adapter: Seek) => {
    adapters.push(adapter);
    try { invoke(adapter, current); } catch (error) { adapters.pop(); throw error; }
    return () => { const index = adapters.indexOf(adapter); if (index >= 0) adapters.splice(index, 1); };
  };
  const contract: SeekableScene = {
    duration,
    seek(t) {
      if (!Number.isFinite(t)) throw new Error('scene time must be finite');
      current = Math.max(0, Math.min(duration, t));
      for (const adapter of adapters) invoke(adapter, current);
    },
  };
  const css = (root: { getAnimations(): { pause(): void; currentTime: number | null }[] }) =>
    add((t) => { for (const animation of root.getAnimations()) { animation.pause(); animation.currentTime = t * 1000; } });
  return {
    ...contract,
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
