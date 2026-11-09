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
