import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { applyOps, validate, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { DEFAULT_SHORTLIST, firstTakeOps, musicTracks, sampleName, SHORT, shortlistFor, TONES, withoutVoice, withVoice } from '../src/voice-shortlist.ts';
import { EFFECT_PRESETS } from '../src/effect-chain.ts';

describe('the voices offered first', () => {
  it('starts each provider with five voices that differ, one of each tone', () => {
    for (const [provider, list] of Object.entries(DEFAULT_SHORTLIST)) {
      expect(list, provider).toHaveLength(SHORT);
      expect(list.map((v) => v.tone).sort(), provider).toEqual([...TONES].sort());
    }
  });

  it('keeps only the voices the provider still offers, the gaps filled from its list', () => {
    const offered = [{ id: 'nova', name: 'Nova' }, { id: 'alloy', name: 'Alloy' }, { id: 'ash', name: 'Ash' }, { id: 'echo', name: 'Echo' }, { id: 'sage', name: 'Sage' }, { id: 'verse', name: 'Verse' }];
    const list = shortlistFor('openai', undefined, offered);
    expect(list.map((v) => v.id)).toEqual(['nova', 'alloy', 'ash', 'echo', 'sage']);
    expect(list[0].tone).toBe('lively');
    expect(list[2].tone).toBeUndefined();
    // the provider's answer unknown: the list as kept
    expect(shortlistFor('openai', undefined, null).map((v) => v.id)).toEqual(['coral', 'onyx', 'nova', 'shimmer', 'alloy']);
    // a provider with no default: its first voices
    expect(shortlistFor('hydracept', undefined, offered).map((v) => v.id)).toEqual(['nova', 'alloy', 'ash', 'echo', 'sage']);
  });

  it('is data kept in the settings: a voice added comes first, a full list loses its last, one removed goes', () => {
    const added = withVoice(undefined, 'openai', { id: 'verse', name: 'Verse' });
    expect(added.openai.map((v) => v.id)).toEqual(['verse', 'coral', 'onyx', 'nova', 'shimmer']);
    expect(withVoice(added, 'openai', { id: 'verse', name: 'Verse' }).openai).toEqual(added.openai);
    expect(withoutVoice(added, 'openai', 'onyx').openai.map((v) => v.id)).toEqual(['verse', 'coral', 'nova', 'shimmer']);
    expect(shortlistFor('openai', withoutVoice(undefined, 'openai', 'coral'), null)).toHaveLength(4);
  });

  it('names a sample by provider, voice and language, as a library file', () => {
    expect(sampleName('elevenlabs', 'owner/AbC', 'fr')).toBe('voice-sample-elevenlabs-owner-abc-fr.mp3');
  });
});

describe('the first take', () => {
  function film(): TrammeDoc {
    const { doc } = newProject({ name: 'F', width: 1920, height: 1080, fps: 30, duration: 20 });
    const root = doc.compositions[doc.root];
    doc.assets.song = { type: 'audio', src: 'assets/song.mp3' };
    root.tracks = [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }];
    root.layers.music = { type: 'audio', track: 'A1', in: 0, out: 20, props: { audio: 'song', role: 'music' } } as never;
    root.order.push('music');
    return doc;
  }

  it('lands on a new voice track at the playhead, the voice cleanup on it, the music ducked under it, in one step', () => {
    const doc = film();
    expect(musicTracks(doc, doc.root)).toEqual(['A1']);
    const r = firstTakeOps(doc, doc.root, 'voice1', { src: 'assets/voice/voice1.mp3', name: 'Voice-over', duration: 4.5 }, 3)!;
    const after = applyOps(doc, r.ops).doc, root = after.compositions[after.root];
    const track = root.tracks!.find((x) => x.id === r.track)!;
    expect(r.track).not.toBe('A1');
    expect(track.effects).toEqual(EFFECT_PRESETS['voice-cleanup']);
    expect(root.tracks!.find((x) => x.id === 'A1')!.duckUnder).toBe(r.track);
    expect(root.layers[r.layer]).toMatchObject({ type: 'audio', track: r.track, in: 3, props: { audio: 'voice1', role: 'voice' } });
    expect(after.assets.voice1).toEqual({ type: 'audio', src: 'assets/voice/voice1.mp3', name: 'Voice-over' });
    expect(validate(after, builtinRegistry())).toEqual([]);
  });

  it('places nothing for an empty take', () => {
    expect(firstTakeOps(film(), 'main', 'v', { src: 'x.mp3', name: 'x', duration: 0 }, 0)).toBeNull();
  });
});
