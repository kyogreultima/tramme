import { describe, expect, it } from 'vitest';
import { charterColours } from '../src/charter.ts';
import { momentLines } from '../src/moments.ts';
import { speechMoments } from '@tramme/core';

const luma = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

describe('the charter of a dressed video', () => {
  it('takes the accent from the footage\'s most vivid colour and the plate from the room, deep', () => {
    // a beige wall, a grey jumper, an orange lamp
    const c = charterColours([{ rgb: [200, 180, 150], share: 0.6 }, { rgb: [90, 90, 95], share: 0.3 }, { rgb: [230, 120, 30], share: 0.1 }]);
    expect(parseInt(c.accent.slice(1, 3), 16)).toBeGreaterThan(parseInt(c.accent.slice(5, 7), 16));
    expect(luma(c.plate)).toBeLessThan(0.1);
    expect(luma(c.ink)).toBeGreaterThan(0.8);
    expect(luma(c.accent2)).toBeGreaterThan(luma(c.accent));
  });

  it('turns pale with dark ink when asked, and keeps an accent for grey footage', () => {
    const c = charterColours([{ rgb: [128, 128, 128], share: 1 }], 'light');
    expect(luma(c.plate)).toBeGreaterThan(0.85);
    expect(luma(c.ink)).toBeLessThan(0.1);
    expect(c.accent).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('the moments of a talking video', () => {
  it('lists each moment with its beats, and the long stretches with none', () => {
    const words = [{ w: 'Ça', s: 0, e: 0.3 }, { w: 'coûte', s: 0.4, e: 0.7 }, { w: '10', s: 0.8, e: 1 }, { w: 'euros.', s: 1.1, e: 1.4 },
      ...Array.from({ length: 30 }, (_, i) => ({ w: 'bla', s: 1.6 + i * 0.5, e: 1.9 + i * 0.5 }))];
    const lines = momentLines(speechMoments(words), words);
    expect(lines[0]).toBe('- 0.80–1.40 s figure: "Ça coûte 10 euros."; beats "10 euros." 0.80 s');
    expect(lines.at(-1)).toContain('No moment from 1.40–16.40 s');
  });
});
