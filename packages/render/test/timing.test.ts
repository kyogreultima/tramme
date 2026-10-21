import { describe, expect, it } from 'vitest';
import { addParts, bottleneck, formatParts, noParts, perFrame } from '../src/timing.ts';

describe('where a frame’s time goes', () => {
  it('adds the parts of several frames', () => {
    const total = noParts();
    addParts(total, { evaluate: 2, draw: 10 });
    addParts(total, { evaluate: 4, draw: 20, readback: 6, send: 1 });
    expect(total).toEqual({ evaluate: 6, draw: 30, video: 0, readback: 6, send: 1 });
    expect(perFrame(total, 2)).toEqual({ evaluate: 3, draw: 15, video: 0, readback: 3, send: 0.5 });
  });

  it('prints them per frame, in a stable order', () => {
    const total = addParts(noParts(), { evaluate: 6, draw: 30, video: 0, readback: 6, send: 1 });
    expect(formatParts(total, 2)).toBe('evaluate 3.0 · draw 15 · video 0.0 · readback 3.0 · send 0.5 ms');
  });

  it('names the part that takes the most time', () => {
    expect(bottleneck({ evaluate: 1, draw: 2, video: 9, readback: 3, send: 0 })).toBe('video');
    expect(bottleneck(noParts())).toBe('evaluate');
  });

  it('counts no frame as one, rather than dividing by zero', () => {
    expect(perFrame(addParts(noParts(), { draw: 4 }), 0).draw).toBe(4);
  });
});
