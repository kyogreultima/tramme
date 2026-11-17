import { describe, expect, it } from 'vitest';
import { nextWait } from '../src/render-pace.ts';

describe('how often the page asks about an export in the cloud', () => {
  it('soon at first, then less and less often up to every 30 seconds', () => {
    const waits = Array.from({ length: 10 }, (_, n) => nextWait(n, false));
    expect(waits[0]).toBe(4000);
    expect(waits.every((w, i) => i === 0 || w >= waits[i - 1])).toBe(true);
    expect(waits.at(-1)).toBe(30_000);
    // a ten-minute export: about thirty questions, not a hundred and fifty
    let t = 0, questions = 0;
    while (t < 10 * 60_000) t += nextWait(questions++, false);
    expect(questions).toBeLessThan(30);
  });

  it('once a minute with the page in the background', () => {
    expect(nextWait(0, true)).toBe(60_000);
    expect(nextWait(20, true)).toBe(60_000);
  });
});
