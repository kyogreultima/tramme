import { describe, expect, it } from 'vitest';
import { applyOps, Evaluator, validate, type PathValue, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { followTrackOps, tracksOf } from '../src/masks.ts';

/** a car tracked from the left to the middle of the picture over 2 s, and a card masked by a square */
const CAR = { version: 1, kind: 'track', source: 'take', name: 'car', width: 640, height: 360, frames: Array.from({ length: 21 }, (_, i) => ({ t: i / 10, box: [0.1 + 0.2 * (i / 10), 0.4, 0.1, 0.2] })) };
function scene(): TrammeDoc {
  return {
    schema: 'tramme/1', meta: { title: 'mask' }, tokens: {}, root: 'main',
    assets: { take: { type: 'video', src: 'take.mp4' }, 'track-take-car': { type: 'json', src: 'tracks/take-car.json', name: 'Track · car' } },
    compositions: { main: { name: 'Main', width: 640, height: 360, fps: 30, duration: 2, background: null, order: ['v', 'card'], layers: {
      v: { type: 'video', transform: { position: [320, 180] }, props: { video: 'take', size: [640, 360] } },
      card: { type: 'shape.rect', transform: { position: [320, 180] }, props: { size: [640, 360] }, masks: [{ id: 'm', props: { path: { v: [[-20, -20], [20, -20], [20, 20], [-20, 20]], closed: true } } }] },
    } } },
  } as TrammeDoc;
}

const pathAt = (doc: TrammeDoc, t: number) => new Evaluator(doc, builtinRegistry(), { data: (id) => (id === 'track-take-car' ? CAR : undefined) }).value('card.masks.m.path', t, 'main') as PathValue;

describe('a mask that follows a track', () => {
  it('lists the tracks of the video layers', () => {
    expect(tracksOf(scene(), 'main')).toEqual([['v', 'track-take-car', 'car']]);
  });

  it('keeps its shape and moves with the object from the moment it was drawn', () => {
    const doc = applyOps(scene(), followTrackOps(scene(), 'main', 'card', 'm', 'v', 'track-take-car', 0)).doc;
    expect(validate(doc, builtinRegistry())).toEqual([]);
    expect(pathAt(doc, 0).v[0][0]).toBeCloseTo(-20, 0);
    // a second later the car is 0.2 of the width (128 px) further: so is the mask, its size the same
    const later = pathAt(doc, 1);
    expect(later.v[0][0]).toBeCloseTo(-20 + 128, -1);
    expect(later.v[1][0] - later.v[0][0]).toBeCloseTo(40);
    expect(later.v[0][1]).toBeCloseTo(-20, 0);
  });
});
