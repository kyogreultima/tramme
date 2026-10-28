import { describe, expect, it } from 'vitest';
import { applyOps, type Composition, type TrammeDoc } from '@tramme/core';
import { takeOps } from '../src/voiceover.ts';

const doc = (c?: Partial<Composition>): TrammeDoc => ({
  schema: 'tramme/1', meta: { title: 't' }, tokens: {}, root: 'main',
  assets: { bed: { type: 'audio', src: 'assets/sounds/bed.mp3' } },
  compositions: {
    main: {
      name: 'Seq', kind: 'sequence', width: 640, height: 360, fps: 30, duration: 10, background: null,
      tracks: [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }],
      order: ['music'], layers: { music: { type: 'audio', track: 'A1', in: 0, out: 10, props: { audio: 'bed' } } },
      ...c,
    },
  },
});
const take = { src: 'assets/voice/voice.wav', name: 'Voice 1', duration: 3 };

describe('a voice-over taken on the timeline', () => {
  it('lies over what is on the track from the playhead, the covered sound cut and its media kept', () => {
    const d = doc(), r = takeOps(d, 'main', 'voice', take, 4, 'A1')!, next = applyOps(d, r.ops).doc, c = next.compositions.main;
    expect(next.assets.voice).toEqual({ type: 'audio', src: 'assets/voice/voice.wav', name: 'Voice 1' });
    expect(next.assets.bed).toBeDefined();
    expect([c.layers[r.id].in, c.layers[r.id].out, c.layers[r.id].track, c.layers[r.id].props!.audio]).toEqual([4, 7, 'A1', 'voice']);
    expect([c.layers.music.in, c.layers.music.out]).toEqual([0, 4]);
    const tail = Object.entries(c.layers).find(([id, l]) => id !== r.id && id !== 'music' && l.track === 'A1')![1];
    expect([tail.in, tail.out, tail.props!.start]).toEqual([7, 10, 7]);
  });

  it('is a voice, so the mix leads with it', () => {
    const d = doc(), r = takeOps(d, 'main', 'voice', take, 0, 'A1')!;
    expect(applyOps(d, r.ops).doc.compositions.main.layers[r.id].props!.role).toBe('voice');
  });

  it('makes a sound track when there is none', () => {
    const d = doc({ tracks: [{ id: 'V1', kind: 'video' }], layers: {}, order: [] }), r = takeOps(d, 'main', 'voice', take, 1, 'A1')!;
    expect(applyOps(d, r.ops).doc.compositions.main.tracks!.map((t) => t.id)).toEqual(['V1', 'A1']);
  });

  it('turns an ordinary composition into a sequence', () => {
    const c: Partial<Composition> = { tracks: undefined, kind: undefined, layers: {}, order: [] };
    const d = doc(c);
    delete (d.compositions.main as Partial<Composition>).tracks; delete (d.compositions.main as Partial<Composition>).kind;
    const r = takeOps(d, 'main', 'voice', take, 0, 'A1')!, next = applyOps(d, r.ops).doc.compositions.main;
    expect([next.kind, next.tracks!.map((t) => t.id)]).toEqual(['sequence', ['A1']]);
  });

  it('writes nothing for a recording that is empty, or on a locked track', () => {
    expect(takeOps(doc(), 'main', 'voice', { ...take, duration: 0 }, 0, 'A1')).toBeNull();
    const d = doc(); d.compositions.main.tracks![1].locked = true;
    expect(takeOps(d, 'main', 'voice', take, 0, 'A1')).toBeNull();
  });
});
