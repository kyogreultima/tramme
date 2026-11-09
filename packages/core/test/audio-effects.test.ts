import { expect, it } from 'vitest';
import { AudioEffectSchema, delayTimeSeconds, DocSchema, validate, type AudioEffect } from '../src/index.ts';
import { makeDoc, registry } from './fixtures.ts';

const effects: AudioEffect[] = [
  { kind: 'compressor', amount: 0.5, bypass: true },
  { kind: 'eq', low: 2, mid: -3, midFreq: 2400, midQ: 0.9, high: 1 },
  { kind: 'lowCut', frequency: 80 },
  { kind: 'highCut', frequency: 7000 },
  { kind: 'reverb', wet: 0.2 },
];

const withEffects = () => {
  const doc = makeDoc();
  doc.compositions.main.kind = 'sequence';
  doc.compositions.main.tracks = [
    { id: 'A1', kind: 'audio', to: 'B1', effects },
    { id: 'B1', kind: 'audio', bus: true, effects: [{ kind: 'reverb', wet: 0.1 }] },
  ];
  return doc;
};

it('keeps ordered, bypassable sound-track and bus effects as document data, without changing defaults', () => {
  const doc = withEffects();
  expect(validate(doc, registry())).toEqual([]);
  expect(DocSchema.parse(doc)).toEqual(doc);
  expect(DocSchema.parse(makeDoc())).toEqual(makeDoc());
});

it('rejects unknown processors and fields, missing parameters and invalid numbers', () => {
  for (const effect of [
    { kind: 'script', code: 'fetch(...)' },
    { kind: 'compressor', amount: 0.5, source: 'remote.js' },
    { kind: 'compressor' },
    { kind: 'compressor', amount: NaN },
    { kind: 'compressor', amount: 1.1 },
    { kind: 'reverb', wet: -0.1 },
    { kind: 'lowCut', frequency: Infinity },
    { kind: 'highCut', frequency: 24001 },
    { kind: 'eq', low: 0, mid: 0, high: 0, midFreq: 1000, midQ: 0 },
    { kind: 'eq', low: 13, mid: 0, high: 0, midFreq: 1000, midQ: 1 },
  ]) {
    const doc = withEffects();
    (doc.compositions.main.tracks![0] as unknown as { effects: unknown[] }).effects = [effect];
    expect(DocSchema.safeParse(doc).success).toBe(false);
  }
});

it('refuses sound effects on a video track', () => {
  const doc = withEffects();
  doc.compositions.main.tracks![0].kind = 'video';
  delete doc.compositions.main.tracks![0].to;
  expect(validate(doc, registry())).toContainEqual({ path: '/compositions/main/tracks/0/effects', message: 'only a sound track has audio effects' });
});

it('stores delay/distortion and requires an explicit tempo only for an active note delay', () => {
  const doc = withEffects();
  doc.compositions.main.sound = { tempo: 120 };
  doc.compositions.main.tracks![0].effects = [
    { kind: 'delay', time: '1/4', feedback: 0.95, wet: 0.55 },
    { kind: 'distortion', drive: 5, tone: 0, wet: 1 },
  ];
  expect(validate(doc, registry())).toEqual([]);
  delete doc.compositions.main.sound.tempo;
  expect(validate(doc, registry())).toContainEqual({ path: '/compositions/main/tracks/0/effects/0/time', message: 'a composition tempo is required for an active note delay' });
  doc.compositions.main.tracks![0].effects![0].bypass = true;
  expect(validate(doc, registry())).toEqual([]);
  doc.compositions.main.tracks![0].effects![0] = { kind: 'delay', time: 280, feedback: 0.38, wet: 0.55 };
  expect(validate(doc, registry())).toEqual([]);
});

it('converts milliseconds or musical notes to seconds and never invents a missing tempo', () => {
  expect(delayTimeSeconds(280)).toBe(0.28);
  expect(delayTimeSeconds('1/4', 120)).toBe(0.5);
  expect(delayTimeSeconds('1/8', 120)).toBe(0.25);
  expect(delayTimeSeconds('1/1', 60)).toBe(4);
  expect(delayTimeSeconds('1/32', 300)).toBe(0.025);
  expect(() => delayTimeSeconds('1/4')).toThrow(/tempo/);
  expect(() => delayTimeSeconds('1/4', NaN)).toThrow(/tempo/);
});

it('rejects runaway feedback, unsupported notes and invalid drive/tone/wet settings', () => {
  for (const effect of [
    { kind: 'delay', time: 280, feedback: 0.96, wet: 0.5 },
    { kind: 'delay', time: -1, feedback: 0.3, wet: 0.5 },
    { kind: 'delay', time: 1, feedback: 0.3, wet: 0.5 },
    { kind: 'delay', time: '1/3', feedback: 0.3, wet: 0.5 },
    { kind: 'distortion', drive: 0, tone: 0, wet: 1 },
    { kind: 'distortion', drive: 2, tone: Infinity, wet: 1 },
    { kind: 'distortion', drive: 2, tone: 500, wet: 2 },
  ]) expect(AudioEffectSchema.safeParse(effect).success).toBe(false);
});
