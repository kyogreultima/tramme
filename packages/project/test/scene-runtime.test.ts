import { describe, expect, it } from 'vitest';
import { sceneController, type SeekableScene } from '../src/scene-runtime.ts';

describe('absolute-time scene adapters', () => {
  it('seeks CSS/WAAPI, SVG, GSAP, Lottie and Three forward and backward', () => {
    const scene = sceneController(2);
    const animation = { currentTime: null as number | null, pauses: 0, pause() { this.pauses++; } };
    const svgTimes: number[] = [], gsapTimes: [number, boolean | undefined][] = [];
    const lottieTimes: [number, boolean | undefined][] = [], threeTimes: number[] = [], renders: number[] = [];
    scene.css({ getAnimations: () => [animation] });
    scene.waapi({ getAnimations: () => [animation] });
    scene.svg({ pauseAnimations() {}, setCurrentTime(t) { svgTimes.push(t); } });
    scene.gsap({ pause() {}, time(t, quiet) { gsapTimes.push([t, quiet]); } });
    scene.lottie({ goToAndStop(t, frames) { lottieTimes.push([t, frames]); } });
    scene.three({ setTime(t) { threeTimes.push(t); } }, () => renders.push(1));
    const target: { __hf?: SeekableScene } = {};
    scene.install(target);
    expect(target.__hf?.duration).toBe(2);
    target.__hf?.seek(1.25);
    expect(animation.currentTime).toBe(1250);
    expect(svgTimes.at(-1)).toBe(1.25);
    expect(gsapTimes.at(-1)).toEqual([1.25, true]);
    expect(lottieTimes.at(-1)).toEqual([1250, false]);
    expect(threeTimes.at(-1)).toBe(1.25);
    target.__hf?.seek(0.25);
    expect(animation.currentTime).toBe(250);
    expect(threeTimes.at(-1)).toBe(0.25);
    expect(renders.length).toBe(3); // registration at zero, then two seeks
  });

  it('clamps to the scene duration and refuses invalid time', () => {
    const scene = sceneController(1);
    const values: number[] = [];
    scene.three({ setTime(t) { values.push(t); } }, () => {});
    scene.seek(-5); scene.seek(4);
    expect(values).toEqual([0, 0, 1]);
    expect(() => scene.seek(NaN)).toThrow('scene time must be finite');
    expect(() => sceneController(0)).toThrow('scene duration must be positive');
    expect(() => scene.register(async () => {})).toThrow('scene seek adapters must be synchronous');
  });
});

describe('scene parameters', () => {
  it('gives every seek the parameters the host set, and draws again when they change', () => {
    const scene = sceneController(2);
    const drawn: [number, unknown][] = [];
    scene.register((t, params) => { drawn.push([t, params.title]); });
    const target: { __hf?: SeekableScene } = {};
    scene.install(target);
    expect(target.__hf?.params).toEqual({});
    target.__hf?.setParams({ title: 'Hello', size: 3, on: true });
    target.__hf?.seek(0.5);
    target.__hf?.setParams({ title: 'Bye', size: 4, on: false });
    expect(drawn.slice(-3)).toEqual([[0, 'Hello'], [0.5, 'Hello'], [0.5, 'Bye']]);
    expect(scene.params).toEqual({ title: 'Bye', size: 4, on: false });
    expect(Object.isFrozen(scene.params)).toBe(true);
  });

  it('refuses what is not plain data, and keeps the previous values', () => {
    const scene = sceneController(1);
    scene.setParams({ a: 1 });
    for (const bad of [null, [1], 'x', { a: Number.NaN }, { a: {} }, { a: 'x'.repeat(5000) }, { a: undefined }, Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`p${i}`, i]))])
      expect(() => scene.setParams(bad as never)).toThrow();
    expect(scene.params).toEqual({ a: 1 });
  });
});

describe('scene video', () => {
  const element = (dataset: Record<string, string> = {}) => {
    const el = { dataset, muted: false, currentTime: 0, duration: 4, poster: '', paused: false, loaded: 0, removed: [] as string[],
      pause() { this.paused = true; }, load() { this.loaded++; }, removeAttribute(name: string) { this.removed.push(name); } };
    return el;
  };

  it('seeks the browser\'s own decoder when no pictures were extracted (the editor preview)', () => {
    const scene = sceneController(5), el = element({ start: '1' });
    scene.video(el);
    scene.seek(0.5);
    expect(el.currentTime).toBe(0);
    scene.seek(3);
    expect(el.currentTime).toBe(2);
    scene.seek(5);
    expect(el.currentTime).toBe(4);
    expect([el.muted, el.paused]).toEqual([true, true]);
  });

  it('shows the extracted picture of the time asked as the element\'s poster, once it has arrived', async () => {
    const loads: string[] = [];
    class FakeImage { naturalWidth = 8; naturalHeight = 6; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { loads.push(value); queueMicrotask(() => this.onload?.()); } }
    (globalThis as unknown as { Image: unknown }).Image = FakeImage;
    try {
      const scene = sceneController(2), el = element({ frames: '/__media/0/', fps: '10', frameCount: '10', start: '0.5' });
      scene.video(el);
      expect(el.removed).toContain('src');
      scene.seek(0.2);
      await scene.ready();
      expect(el.poster).toBe('/__media/0/000000.jpg');
      scene.seek(0.85);
      expect(el.poster).toBe('/__media/0/000000.jpg');
      await scene.ready();
      expect(el.poster).toBe('/__media/0/000003.jpg');
      scene.seek(1.95);
      await scene.ready();
      expect(el.poster).toBe('/__media/0/000009.jpg');
      scene.seek(0.85);
      expect(el.poster).toBe('/__media/0/000003.jpg');
      expect(loads).toEqual(['/__media/0/000000.jpg', '/__media/0/000003.jpg', '/__media/0/000009.jpg']);
    } finally { delete (globalThis as unknown as { Image?: unknown }).Image; }
  });

  it('needs the rate and the count with its pictures', () => {
    expect(() => sceneController(1).video(element({ frames: '/__media/0/' }))).toThrow('data-fps and data-frame-count');
  });
});
