import { expect, it } from 'vitest';
import { DocSchema, validate, type AudioEffect } from '../src/index.ts';
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
