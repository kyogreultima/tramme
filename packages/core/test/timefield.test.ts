import { describe, expect, it } from 'vitest';
import { Evaluator, instanceTime, timeDelay, validate, type Instance, type NodeType, type Placement, type TrammeDoc } from '../src/index.ts';
import { registry as baseRegistry } from './fixtures.ts';

const compNode: NodeType = {
  type: 'comp', title: 'Composition', category: 'test',
  props: { comp: { type: 'comp', default: null, nullable: true, animatable: false }, start: { type: 'number', default: 0 }, speed: { type: 'number', default: 1 }, loop: { type: 'bool', default: false }, remap: { type: 'number', default: null, nullable: true } },
  render: { canvas2d() {} },
};
const registry = () => baseRegistry().register(compNode);
const RISE = { $k: [{ t: 0, v: 0 }, { t: 1, v: 100 }] };

/** a row of boxes across a 1000 × 500 frame, their radius rising from 0 to 100 over a second, through the modifiers given */
function row(mods: unknown[], xs = [0, 250, 500, 750, 1000]): TrammeDoc {
  const layers: TrammeDoc['compositions'][string]['layers'] = {};
  xs.forEach((x, i) => { layers[`b${i}`] = { type: 'box', transform: { position: [x, 250] }, props: { radius: { ...RISE, $mod: mods } } } as never; });
  return { schema: 'tramme/1', meta: { title: 'field' }, tokens: {}, assets: {}, root: 'main', compositions: { main: { name: 'M', width: 1000, height: 500, fps: 30, duration: 5, layers, order: Object.keys(layers) } } };
}
const radii = (d: TrammeDoc, t: number) => { const ev = new Evaluator(d, registry()); return Object.keys(d.compositions.main.layers).map((id) => ev.layerAt(id, t, 'main').props.radius as number); };

describe('the time field', () => {
  it('in rank mode matches the stagger it replaces', () => {
    for (const t of [0, 0.1, 0.35, 0.8, 1.3]) {
      expect(radii(row([{ type: 'timeField', mode: 'rank', amount: 0.1 }]), t)).toEqual(radii(row([{ type: 'stagger', delay: 0.1 }]), t));
      expect(radii(row([{ type: 'timeField', mode: 'rank', amount: 0.1, from: 'last' }]), t)).toEqual(radii(row([{ type: 'stagger', delay: 0.1, from: 'last' }]), t));
    }
    expect(validate(row([{ type: 'timeField', mode: 'angle', amount: 0.5 }]), registry())).toEqual([]);
  });

  it('along an angle: the wave crosses the frame in its amount', () => {
    // left to right over 1 s: at t = 1 the left box has finished, the right one starts
    const close = (v: number[]) => v.map((x) => expect.closeTo(x, 9));
    expect(radii(row([{ type: 'timeField', mode: 'angle', amount: 1 }]), 1)).toEqual(close([100, 75, 50, 25, 0]));
    // right to left
    expect(radii(row([{ type: 'timeField', mode: 'angle', angle: 180, amount: 1 }]), 1)).toEqual(close([0, 25, 50, 75, 100]));
  });

  it('by distance: a ripple from the centre, or from a layer', () => {
    const r = radii(row([{ type: 'timeField', mode: 'distance', amount: 1 }]), 0.5);
    expect(r[2]).toBe(50);
    expect(r[0]).toBe(r[4]);
    expect(r[0]).toBeLessThan(r[1]);
    const d = row([{ type: 'timeField', mode: 'distance', amount: 1, source: 'b0' }]);
    const from = radii(d, 0.5);
    expect(from[0]).toBe(50);
    expect(from[4]).toBeLessThan(from[1]);
  });

  it('by noise: smooth in space, a fixed random delay per element at scale 0', () => {
    const xs = Array.from({ length: 21 }, (_, i) => i * 10);
    const r = radii(row([{ type: 'timeField', mode: 'noise', amount: 1, scale: 400 }], xs), 0.5);
    // neighbours 10 px apart under a 400 px noise: close values
    for (let i = 1; i < r.length; i++) expect(Math.abs(r[i] - r[i - 1])).toBeLessThan(6);
    const fixed = radii(row([{ type: 'timeField', mode: 'noise', amount: 1, scale: 0 }]), 0.5);
    expect(new Set(fixed).size).toBeGreaterThan(2);
    expect(radii(row([{ type: 'timeField', mode: 'noise', amount: 1, scale: 0 }]), 0.5)).toEqual(fixed);
  });

  it('an animated seed or amount slides: no jump between two frames', () => {
    for (const mod of [
      { type: 'timeField', mode: 'noise', amount: 1, scale: 0, seed: { $k: [{ t: 0, v: 0 }, { t: 4, v: 3 }] } },
      { type: 'timeField', mode: 'noise', amount: 1, scale: 300, seed: { $k: [{ t: 0, v: 0 }, { t: 4, v: 3 }] } },
      { type: 'timeField', mode: 'angle', amount: { $k: [{ t: 0, v: 0 }, { t: 4, v: 2 }] } },
    ]) {
      // the radius rises 100 a second (3.4 a frame) and the field moves with the seed: a switch would jump by up to 100
      const d = row([mod]);
      expect(validate(d, registry())).toEqual([]);
      let prev = radii(d, 0.4);
      for (let f = 13; f < 60; f++) {
        const cur = radii(d, f / 30);
        cur.forEach((v, i) => expect(Math.abs(v - prev[i])).toBeLessThan(15));
        prev = cur;
      }
    }
  });

  it('loops the animation instead of holding its ends', () => {
    const d = row([{ type: 'timeField', mode: 'rank', amount: 0.25, loop: true }]);
    // the third box is 0.5 s late: at 0.25 s it plays its 1.75 s, looped: 0.75 s in
    expect(radii(d, 0.25)[2]).toBe(75);
    expect(radii(row([{ type: 'timeField', mode: 'rank', amount: 0.25 }]), 0.25)[2]).toBe(0);
  });
});

describe('a time field over a distribution', () => {
  const doc = (time: unknown): TrammeDoc => ({
    schema: 'tramme/1', meta: { title: 'wave' }, tokens: {}, assets: {}, root: 'main',
    compositions: {
      dot: { name: 'Dot', width: 10, height: 10, fps: 30, duration: 2, layers: { d: { type: 'box', props: { radius: RISE } } }, order: ['d'] },
      main: { name: 'Main', width: 1000, height: 500, fps: 30, duration: 4, order: ['many'], layers: { many: { type: 'comp', props: { comp: 'dot' }, distribute: { count: 5, layout: { type: 'list', spacing: 100 }, time } as never } } },
    },
  });
  const delays = (d: TrammeDoc) => (new Evaluator(d, registry()).layerAt('many', 1, 'main').props.$instances as Placement[]).map((p) => p.delay);

  it('delays each instance by the field over the instances', () => {
    expect(delays(doc({ mode: 'angle', amount: 1 }))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(delays(doc({ mode: 'rank', amount: 0.1 }))).toEqual([0, 0.1, 0.2, 0.3, 0.4].map((x) => expect.closeTo(x, 9)));
    // a ripple from the middle one
    const r = delays(doc({ mode: 'distance', amount: 1 }));
    expect(r[2]).toBe(0);
    expect(r[0]).toBe(1);
    expect(validate(doc({ mode: 'angle', amount: { $k: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } }), registry())).toEqual([]);
  });

  it('an instance holds the first and last pose, or loops', () => {
    expect(instanceTime(0.2, { at: [0, 0], rotation: 0, delay: 0.5 }, 2)).toBe(0);
    expect(instanceTime(1.9, { at: [0, 0], rotation: 0, delay: -0.5 }, 2)).toBeCloseTo(2, 2);
    expect(instanceTime(0.2, { at: [0, 0], rotation: 0, delay: 0.5, loop: true }, 2)).toBeCloseTo(1.7, 9);
    // the component read at that time
    const d = doc({ mode: 'angle', amount: 1 }), ev = new Evaluator(d, registry());
    const list = ev.layerAt('many', 0.75, 'main').props.$instances as ({ instance: Instance } & Placement)[];
    const r = list.map((one) => ev.frame(instanceTime(0.75, one, 2), 'dot', one.instance).layers[0].props.radius);
    expect(r).toEqual([75, 50, 25, 0, 0]);
  });

  it('timeDelay is continuous in the seed between whole values', () => {
    const f = (seed: number) => timeDelay({ mode: 'noise', amount: 1, scale: 0, seed }, [0, 0], 3, 10, [], 0);
    expect(Math.abs(f(1.001) - f(1))).toBeLessThan(0.01);
    expect(Math.abs(f(1.999) - f(2))).toBeLessThan(0.01);
  });
});

describe('the Evaluator for many instances', () => {
  it('keys each instance by where it is, the same at every frame (its simulation keeps going)', () => {
    const d: TrammeDoc = {
      schema: 'tramme/1', meta: { title: 'keys' }, tokens: {}, assets: {}, root: 'main',
      compositions: {
        dot: { name: 'Dot', width: 10, height: 10, fps: 30, duration: 2, params: { r: { type: 'number', targets: ['d.radius'] } }, layers: { d: { type: 'box' } }, order: ['d'] },
        main: { name: 'Main', width: 100, height: 100, fps: 30, duration: 2, order: ['many'], layers: { many: { type: 'comp', props: { comp: 'dot' }, distribute: { count: 3, layout: { type: 'list' }, params: { r: { $expr: 't * 10 + index' } } } as never } } },
      },
    };
    const ev = new Evaluator(d, registry());
    const keys = (t: number) => (ev.layerAt('many', t, 'main').props.$instances as { instance: Instance }[]).map((x) => x.instance.key);
    expect(keys(0)).toEqual(['main/many#0', 'main/many#1', 'main/many#2']);
    expect(keys(1)).toEqual(keys(0));
  });

  it('reads a smoothing through a time field the same, its readings shared within a frame', () => {
    const smooth = row([{ type: 'wiggle', freq: 2, amp: 30 }, { type: 'smooth', window: 0.3 }, { type: 'timeField', mode: 'angle', amount: 0.5 }]);
    const a = radii(smooth, 0.7), b = radii(smooth, 0.7);
    expect(a).toEqual(b);
    expect(new Set(a.map((v) => v.toFixed(3))).size).toBe(5);
  });
});
