import { describe, expect, it } from 'vitest';
import type { Composition, TrammeDoc } from '@tramme/core';
import { sceneAt, scenesOf } from '../src/scenes.ts';

const comp = (o: Partial<Composition> = {}): Composition => ({ name: 'Main', width: 1920, height: 1080, fps: 30, duration: 20, layers: {}, order: [], ...o });
const docOf = (compositions: Record<string, Composition>): TrammeDoc => ({ root: 'main', compositions } as unknown as TrammeDoc);

describe('the scenes of a film', () => {
  it('are named by the scene markers, each to the next', () => {
    const doc = docOf({ main: comp({ markers: [{ id: 'b', t: 8, label: 'The reveal', kind: 'scene' }, { id: 'a', t: 0, label: 'The problem', kind: 'scene' }, { id: 'cut', t: 4, kind: 'cut' }] }) });
    expect(scenesOf(doc, 'main')).toEqual([
      { id: 'a', name: 'The problem', from: 0, to: 8 },
      { id: 'b', name: 'The reveal', from: 8, to: 20 },
    ]);
  });

  it('open on the time before the first marker', () => {
    const doc = docOf({ main: comp({ markers: [{ id: 'a', t: 3, label: 'Title', kind: 'scene' }] }) });
    expect(scenesOf(doc, 'main', 'Opening')).toEqual([{ id: '~opening', name: 'Opening', from: 0, to: 3 }, { id: 'a', name: 'Title', from: 3, to: 20 }]);
  });

  it('are the compositions a film plays one after another, without the number put first', () => {
    const doc = docOf({
      main: comp({
        layers: {
          'scene-02': { type: 'comp', in: 6, out: 14, props: { comp: 'film-02' } },
          'scene-01': { type: 'comp', name: '01 · Meet Nimbus', in: 0, out: 6, props: { comp: 'film-01' } },
          ground: { type: 'comp', props: { comp: 'bg' } },
          music: { type: 'audio', props: { audio: 'film-music' } },
        },
        order: ['scene-02', 'scene-01', 'ground', 'music'],
      }),
      'film-01': comp({ name: '01 · Meet Nimbus' }),
      'film-02': comp({ name: '02 · Breathe' }),
      bg: comp({ name: 'Ground' }),
    });
    // the ground under the whole film is not a scene
    expect(scenesOf(doc, 'main')).toEqual([
      { id: 'scene-01', name: 'Meet Nimbus', from: 0, to: 6, comp: 'film-01' },
      { id: 'scene-02', name: 'Breathe', from: 6, to: 14, comp: 'film-02' },
    ]);
  });

  it('is the whole composition when nothing divides it', () => {
    expect(scenesOf(docOf({ main: comp({ name: 'Teaser' }) }), 'main')).toEqual([{ id: 'main', name: 'Teaser', from: 0, to: 20 }]);
    expect(scenesOf(docOf({ main: comp() }), 'gone')).toEqual([]);
  });

  it('tells the scene playing at a moment, the last one at the very end', () => {
    const list = scenesOf(docOf({ main: comp({ markers: [{ id: 'a', t: 0, kind: 'scene' }, { id: 'b', t: 8, kind: 'scene' }] }) }), 'main');
    expect(sceneAt(list, 7.99)?.id).toBe('a');
    expect(sceneAt(list, 8)?.id).toBe('b');
    expect(sceneAt(list, 20)?.id).toBe('b');
  });
});
