import { describe, expect, it } from 'vitest';
import { clockTime, Runs, scrubWindow, step, type Clock } from '../src/playclock.ts';

describe('playclock', () => {
  it('reads the clock from its start', () => expect(clockTime({ at: 10, t0: 2, audio: false }, 11.5)).toBe(3.5));
  it('wraps a loop once, at the remainder', () => expect(step({ at: 0, t0: 9, audio: false }, 2, 10, true)).toEqual({ t: 1, wrap: true, end: false }));
  it('ends without a loop', () => expect(step({ at: 0, t0: 9, audio: false }, 2, 10, false)).toEqual({ t: 10, wrap: false, end: true }));
  it('a restarted clock no longer wraps', () => {
    const now = 100, restarted: Clock = { at: now, t0: 0, audio: false };
    expect(step(restarted, now + 0.016, 10, true).wrap).toBe(false);
  });
  it('a run overtaken by another is dead', () => { const r = new Runs(); const a = r.begin(); const b = r.begin(); expect(r.live(a)).toBe(false); expect(r.live(b)).toBe(true); });
  it('a pause kills the run under way', () => { const r = new Runs(); const a = r.begin(); r.cancel(); expect(r.live(a)).toBe(false); });
  it('the scrub window waits its 60 ms, then opens on 80 ms', () => {
    expect(scrubWindow(1, 0, 30)).toBeNull();
    expect(scrubWindow(1, 0, 70)).toEqual({ from: 1, dur: 0.08 });
  });
});
