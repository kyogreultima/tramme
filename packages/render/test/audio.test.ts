// The equaliser's place in the mix: the clips carry it, the chain builds one
// biquad per band set — and none at 0 dB, so an uneq'd mix is unchanged.

import { describe, expect, it } from 'vitest';
import { audioClips, type AudioClip, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { clipChain } from '../src/audio.ts';

const withSound = (sound: Record<string, unknown>): TrammeDoc => {
  const { doc } = newProject({ name: 'T', width: 100, height: 100, fps: 30, duration: 2 });
  doc.assets.snd = { type: 'audio', src: 'assets/snd.wav', name: 'snd' };
  doc.compositions[doc.root].layers.a = { type: 'audio', props: { audio: 'snd', ...sound } } as never;
  doc.compositions[doc.root].order = ['a'];
  return doc;
};

describe('audioClips', () => {
  it('reads the equaliser, clamped, 0 as recorded', () => {
    const [plain] = audioClips(withSound({}), 'main');
    expect(plain.eqLow).toBe(0);
    expect(plain.eqMid).toBe(0);
    expect(plain.eqMidFreq).toBe(1000);
    expect(plain.eqHigh).toBe(0);
    const [eq] = audioClips(withSound({ eqLow: 6, eqMid: -3, eqMidFreq: 2400, eqHigh: 4.5 }), 'main');
    expect([eq.eqLow, eq.eqMid, eq.eqMidFreq, eq.eqHigh]).toEqual([6, -3, 2400, 4.5]);
    const [over] = audioClips(withSound({ eqLow: 99, eqMidFreq: 1 }), 'main');
    expect([over.eqLow, over.eqMidFreq]).toEqual([12, 200]);
  });
});

// a mock context: it only counts and records the nodes the chain builds
const param = () => ({ value: 0, setValueCurveAtTime: () => {}, setValueAtTime: () => {} });
const mockCtx = () => {
  const panners: { pan: { value: number } }[] = [];
  const filters: { type: string; frequency: { value: number }; Q: { value: number }; gain: { value: number } }[] = [];
  const compressors: { threshold: { value: number }; knee: { value: number }; ratio: { value: number }; attack: { value: number }; release: { value: number } }[] = [];
  const node = () => {
    const n = { connect: (other: unknown) => other };
    return n as never;
  };
  const ctx = {
    createBiquadFilter: () => {
      const f = { type: '', frequency: param(), Q: param(), gain: param(), connect: (o: unknown) => o };
      filters.push(f);
      return f as never;
    },
    createDynamicsCompressor: () => {
      const f = { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect: (o: unknown) => o };
      compressors.push(f);
      return f as never;
    },
    createGain: () => ({ gain: param(), connect: (o: unknown) => o }) as never,
    createStereoPanner: () => { const p = { pan: param(), connect: (o: unknown) => o }; panners.push(p); return p as never; },
    createConvolver: () => ({ buffer: null, connect: (o: unknown) => o }) as never,
  };
  return { ctx: ctx as unknown as BaseAudioContext, filters, compressors, panners };
};

const clip = (sound: Partial<AudioClip>): AudioClip => ({
  layerId: 'a', role: 'effect', weight: 'support', asset: 'snd', at: 0, offset: 0, duration: 1,
  gainDb: 0, envelope: null, fadeIn: 0, fadeOut: 0, rate: 1, lowCut: 0, lowCutCurve: null, highCut: 0,
  eqLow: 0, eqMid: 0, eqMidFreq: 1000, eqHigh: 0, compress: 0, reverb: 0, voice: 'none', semitones: 0, keepPitch: false, ...sound,
});

describe('clipChain', () => {
  it('pans a clip that has a pan, and builds no panner for a centred one', () => {
    const centred = mockCtx();
    clipChain(centred.ctx, clip({}), { connect: () => {} } as never, 0, 0);
    expect(centred.panners).toHaveLength(0);
    const { ctx, panners } = mockCtx();
    clipChain(ctx, clip({ pan: -0.4 }), { connect: () => {} } as never, 0, 0);
    expect(panners.map((p) => p.pan.value)).toEqual([-0.4]);
  });

  it('adds no node when the equaliser is flat', () => {
    const { ctx, filters } = mockCtx();
    clipChain(ctx, clip({}), { connect: () => {} } as never, 0, 0);
    expect(filters.length).toBe(0);
  });

  it('builds one biquad per band set, after the cuts, before the gain', () => {
    const { ctx, filters } = mockCtx();
    clipChain(ctx, clip({ lowCut: 80, eqLow: 6, eqMid: -3, eqMidFreq: 2400, eqHigh: 4.5 }), { connect: () => {} } as never, 0, 0);
    expect(filters.map((f) => [f.type, f.frequency.value, f.gain.value, f.Q.value])).toEqual([
      ['highpass', 80, 0, 0],
      ['lowshelf', 120, 6, 0],
      ['peaking', 2400, -3, 0.9],
      ['highshelf', 8000, 4.5, 0],
    ]);
  });

  it('skips only the flat bands', () => {
    const { ctx, filters } = mockCtx();
    clipChain(ctx, clip({ eqHigh: 4.5 }), { connect: () => {} } as never, 0, 0);
    expect(filters.map((f) => f.type)).toEqual(['highshelf']);
  });

  it('compresses when asked, between the eq and the gain', () => {
    const plain = mockCtx();
    clipChain(plain.ctx, clip({}), { connect: () => {} } as never, 0, 0);
    expect(plain.compressors.length).toBe(0);
    const { ctx, compressors, filters } = mockCtx();
    clipChain(ctx, clip({ eqHigh: 4.5, compress: 0.5 }), { connect: () => {} } as never, 0, 0);
    expect(filters.map((f) => f.type)).toEqual(['highshelf']);
    expect(compressors).toHaveLength(1);
    expect([compressors[0].threshold.value, compressors[0].ratio.value, compressors[0].knee.value]).toEqual([-21, 7, 24]);
  });
});
