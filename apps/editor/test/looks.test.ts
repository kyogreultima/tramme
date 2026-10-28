import { describe, expect, it } from 'vitest';
import { applyOps, type Composition, type TrammeDoc } from '@tramme/core';
import { matchLookOps } from '../src/looks.ts';

const doc = (effects?: Composition['layers'][string]['effects']): TrammeDoc => ({
  schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: {}, root: 'main',
  compositions: { main: { name: 'Main', width: 640, height: 360, fps: 30, duration: 10, layers: { a: { type: 'video', props: { video: 'x' }, ...(effects ? { effects } : {}) } }, order: ['a'] } },
});
const params = { lift: [0.1, 0.2], liftLevel: -0.02, gamma: [0, 0], gammaLevel: 0, gain: [0.3, 0.1], gainLevel: 0.05 } as const;

describe('a look matched by the colour wheels', () => {
  it('is an fx.wheels effect on the clip, with the wheels it was given', () => {
    const d = doc(), c = applyOps(d, matchLookOps(d, 'main', 'a', { ...params, lift: [...params.lift], gamma: [0, 0], gain: [...params.gain] }) ).doc.compositions.main;
    expect(c.layers.a.effects).toHaveLength(1);
    expect(c.layers.a.effects![0]).toMatchObject({ type: 'fx.wheels', props: { lift: [0.1, 0.2], liftLevel: -0.02, gainLevel: 0.05 } });
  });

  it('replaces the wheels of the clip when it has some, and keeps its other effects', () => {
    const d = doc([{ id: 'blur', type: 'fx.blur', props: { radius: 2 } }, { id: 'wheels', type: 'fx.wheels', props: { liftLevel: 0.3 } }]);
    const effects = applyOps(d, matchLookOps(d, 'main', 'a', { ...params, lift: [...params.lift], gamma: [0, 0], gain: [...params.gain] })).doc.compositions.main.layers.a.effects!;
    expect(effects.map((e) => e.type)).toEqual(['fx.blur', 'fx.wheels']);
    expect(effects[1].props!.liftLevel).toBe(-0.02);
  });

  it('writes nothing for a clip that is gone', () => {
    expect(matchLookOps(doc(), 'main', 'nope', { ...params, lift: [...params.lift], gamma: [0, 0], gain: [...params.gain] })).toEqual([]);
  });
});
