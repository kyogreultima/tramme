import { expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { audioEffectsKey } from '../src/audio-key.ts';

const project = () => {
  const { doc } = newProject({ name: 'Audio keys', width: 10, height: 10, fps: 30, duration: 1 });
  doc.compositions.main.tracks = [{ id: 'A1', kind: 'audio', to: 'B1', effects: [{ kind: 'compressor', amount: 0.5 }, { kind: 'lowCut', frequency: 80 }] }, { id: 'B1', kind: 'audio', bus: true }];
  doc.assets.tone = { type: 'audio', src: 'tone.wav' };
  doc.compositions.main.layers.voice = { type: 'audio', track: 'A1', props: { audio: 'tone' } };
  doc.compositions.main.order = ['voice'];
  return doc;
};

it('invalidates live audio and loudness for changed parameters, order, bus chains and routing', () => {
  const original = project(), before = audioEffectsKey(original, 'main');
  const changed = project(); changed.compositions.main.tracks![0].effects![0] = { kind: 'compressor', amount: 0.9 };
  expect(audioEffectsKey(changed, 'main')).not.toBe(before);
  const reordered = project(); reordered.compositions.main.tracks![0].effects!.reverse();
  expect(audioEffectsKey(reordered, 'main')).not.toBe(before);
  const bus = project(); bus.compositions.main.tracks![1].effects = [{ kind: 'reverb', wet: 0.4 }];
  expect(audioEffectsKey(bus, 'main')).not.toBe(before);
  const routed = project(); delete routed.compositions.main.tracks![0].to;
  expect(audioEffectsKey(routed, 'main')).not.toBe(before);
  const moved = project(); delete moved.compositions.main.layers.voice.track;
  expect(audioEffectsKey(moved, 'main')).not.toBe(before);
  const tempo = project(); tempo.compositions.main.sound = { tempo: 120 };
  expect(audioEffectsKey(tempo, 'main')).not.toBe(before);
  const dip = project(); dip.compositions.main.tracks![0].volumeBlocks = [{ id: 'dip-1', keys: [{ t: 0, v: 0 }, { t: 0.1, v: -12 }, { t: 0.8, v: -12 }, { t: 0.9, v: 0 }] }];
  expect(audioEffectsKey(dip, 'main')).not.toBe(before);
});

it('does not restart a sound for an unrelated picture, label, lane or fader draft', () => {
  const doc = project(), before = audioEffectsKey(doc, 'main');
  doc.compositions.main.background = '#112233';
  doc.compositions.main.tracks![0].name = 'Voice';
  doc.compositions.main.tracks![0].height = 150;
  doc.compositions.main.tracks![0].volume = -3;
  expect(audioEffectsKey(doc, 'main')).toBe(before);
});
