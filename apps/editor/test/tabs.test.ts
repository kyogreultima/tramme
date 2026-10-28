import { describe, expect, it } from 'vitest';
import { applyOps, type Composition, type Layer, type TrammeDoc } from '@tramme/core';
import { closeTab, openTab, pruneTabs } from '../src/ui/timeline/tabs.ts';
import { nestOps, newSequenceOps } from '../src/ui/timeline/place-ops.ts';

describe('the tabs of the open compositions', () => {
  it('a composition opens once, at the end', () => {
    expect(openTab(['main'], 'seq')).toEqual(['main', 'seq']);
    expect(openTab(['main', 'seq'], 'main')).toEqual(['main', 'seq']);
  });

  it('closing the active tab selects its neighbour, the one before when it is the last', () => {
    expect(closeTab(['a', 'b', 'c'], 'b', 'b')).toEqual({ tabs: ['a', 'c'], active: 'c' });
    expect(closeTab(['a', 'b', 'c'], 'c', 'c')).toEqual({ tabs: ['a', 'b'], active: 'b' });
  });

  it('closing another tab leaves the active one, and the last tab cannot be closed', () => {
    expect(closeTab(['a', 'b', 'c'], 'a', 'c')).toEqual({ tabs: ['a', 'b'], active: 'a' });
    expect(closeTab(['a'], 'a', 'a')).toEqual({ tabs: ['a'], active: 'a' });
  });

  it('a composition that is gone leaves the tabs', () => {
    expect(pruneTabs(['main', 'gone', 'seq'], { main: {}, seq: {} } as never, 'main')).toEqual(['main', 'seq']);
    expect(pruneTabs(['gone'], { main: {} } as never, 'main')).toEqual(['main']);
  });
});

const base = (): TrammeDoc => ({
  schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: {}, root: 'main',
  compositions: { main: { name: 'Main', width: 1280, height: 720, fps: 30, duration: 10, background: null, layers: {}, order: [] } as Composition },
});
const vid = (a: string, len: number): Layer => ({ type: 'video', in: 0, out: len, props: { video: a } });

describe('a new sequence from media', () => {
  it('lays the clips end to end on a magnetic V1, with the size and rate of the open composition', () => {
    const d = base(), r = newSequenceOps(d, 'main', 'seq', 'Rough cut', [
      { base: 'one', placement: { layer: vid('one', 2), withSound: false } },
      { base: 'two', placement: { layer: vid('two', 3), withSound: false } },
      { base: 'three', placement: { layer: vid('three', 1), withSound: false } },
    ])!;
    const c = applyOps(d, r.ops).doc.compositions.seq;
    expect([c.kind, c.width, c.height, c.fps, c.name]).toEqual(['sequence', 1280, 720, 30, 'Rough cut']);
    expect(c.tracks).toEqual([{ id: 'V1', kind: 'video', magnetic: true }, { id: 'A1', kind: 'audio' }]);
    expect(Object.values(c.layers).map((l) => [l.track, l.in, l.out])).toEqual([['V1', 0, 2], ['V1', 2, 5], ['V1', 5, 6]]);
    expect(c.duration).toBe(6);
  });

  it('puts the sound of a video on A1, linked', () => {
    const d = base(), r = newSequenceOps(d, 'main', 'seq', 'Cut', [{ base: 'one', placement: { layer: vid('one', 2), withSound: true } }])!;
    const layers = Object.values(applyOps(d, r.ops).doc.compositions.seq.layers);
    expect(layers.map((l) => l.type).sort()).toEqual(['audio', 'video']);
    expect(new Set(layers.map((l) => l.link)).size).toBe(1);
  });

  it('is null with nothing to put in it', () => {
    expect(newSequenceOps(base(), 'main', 'seq', 'Empty', [])).toBeNull();
  });
});

describe('a sequence nested in another composition', () => {
  const two = (): TrammeDoc => {
    const d = base();
    d.compositions.seq = { name: 'Seq', kind: 'sequence', width: 1280, height: 720, fps: 30, duration: 4, background: null, tracks: [{ id: 'V1', kind: 'video' }], layers: {}, order: [] };
    d.compositions.main = { ...d.compositions.main, kind: 'sequence', tracks: [{ id: 'V1', kind: 'video', magnetic: true }], layers: {}, order: [] };
    return d;
  };

  it('is a comp layer on the track, as long as the sequence', () => {
    const d = two(), r = nestOps(d, 'main', 'seq', 2, 'V1', 'insert')!;
    const l = Object.values(applyOps(d, r.ops).doc.compositions.main.layers)[0];
    expect([l.type, l.track, l.in, l.out, l.props?.comp]).toEqual(['comp', 'V1', 2, 6, 'seq']);
  });

  it('refuses to hold itself, or a composition that holds it', () => {
    const d = two();
    expect(nestOps(d, 'main', 'main', 0, 'V1', 'insert')).toBeNull();
    d.compositions.seq.layers.inner = { type: 'comp', props: { comp: 'main' } }; d.compositions.seq.order = ['inner'];
    expect(nestOps(d, 'main', 'seq', 0, 'V1', 'insert')).toBeNull();
  });
});
