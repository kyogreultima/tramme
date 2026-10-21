import { describe, expect, it } from 'vitest';
import { applyOps, validate, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { outgoingOf, transitionPlan } from '../src/transitions.ts';

/** two shots of one take cut at 4 s: the first plays the file from 0, the second from 10 s */
function cut(secondStart = 10): TrammeDoc {
  return {
    schema: 'tramme/1', meta: { title: 'cut' }, tokens: {}, root: 'main', assets: { take: { type: 'video', src: 'take.mp4' } },
    compositions: { main: { name: 'Main', width: 640, height: 360, fps: 20, duration: 8, background: null, order: ['two', 'one'], layers: {
      one: { type: 'video', in: 0, out: 4, props: { video: 'take', start: 0 } },
      two: { type: 'video', in: 4, out: 8, props: { video: 'take', start: secondStart } },
    } } },
  } as TrammeDoc;
}

const apply = (doc: TrammeDoc, plan: ReturnType<typeof transitionPlan>) => {
  if ('error' in plan) throw new Error(plan.error);
  return applyOps(doc, plan.ops).doc;
};

describe('a transition put on a cut', () => {
  it('finds the shot that ends where this one starts', () => {
    expect(outgoingOf(cut(), 'main', 'two')).toBe('one');
    expect(outgoingOf(cut(), 'main', 'one')).toBeNull();
  });

  it('overlaps the two shots by its length, centred on the cut, from the handles of the file', () => {
    const doc = apply(cut(), transitionPlan(cut(), 'main', 'two', 'crossfade', 1, () => 30));
    const c = doc.compositions.main;
    expect(c.layers.two.in).toBe(3.5);
    expect(c.layers.two.props!.start).toBe(9.5);
    expect(c.layers.one.out).toBe(4.5);
    expect(c.layers.two.effects).toEqual([{ id: 'transition', type: 'fx.transition', props: { from: 'one', kind: 'crossfade', duration: 1 } }]);
    // the incoming shot drawn above the outgoing one (the order runs from the bottom up)
    expect(c.order).toEqual(['one', 'two']);
    expect(validate(doc, builtinRegistry())).toEqual([]);
  });

  it('takes from the other side what one file lacks', () => {
    // the second shot starts 0.2 s into the file: it can start only 0.2 s earlier
    const doc = apply(cut(0.2), transitionPlan(cut(0.2), 'main', 'two', 'push', 1, () => 30));
    expect(doc.compositions.main.layers.two.in).toBe(3.8);
    expect(doc.compositions.main.layers.one.out).toBe(4.8);
  });

  it('says so when the files have no handle left', () => {
    // nothing before the second shot's start, and the first shot already at the end of a 4 s file
    expect(transitionPlan(cut(0), 'main', 'two', 'crossfade', 1, () => 4)).toEqual({ error: 'no-handle', missing: 1 });
  });

  it('changes its length around the same cut when it is put again', () => {
    const once = apply(cut(), transitionPlan(cut(), 'main', 'two', 'crossfade', 1, () => 30));
    const twice = apply(once, transitionPlan(once, 'main', 'two', 'dip', 0.4, () => 30));
    const c = twice.compositions.main;
    expect(c.layers.two.in).toBe(3.8);
    expect(c.layers.two.props!.start).toBe(9.8);
    expect(c.layers.two.effects).toHaveLength(1);
    expect(c.layers.two.effects![0].props).toMatchObject({ kind: 'dip', duration: 0.4, from: 'one' });
  });

  it('keeps to whole frames', () => {
    const doc = apply(cut(), transitionPlan(cut(), 'main', 'two', 'push', 0.5, () => 30));
    const c = doc.compositions.main, fps = c.fps;
    for (const x of [c.layers.two.in!, c.layers.one.out!, c.layers.two.effects![0].props!.duration as number]) expect(Math.abs(x * fps - Math.round(x * fps))).toBeLessThan(1e-6);
  });
});
