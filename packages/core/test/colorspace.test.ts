import { describe, expect, it } from 'vitest';
import { apply3, GAMUTS, gamutMatrix, invert3, rgbToXyz, SOURCE_SPACES, SOURCES } from '../src/colorspace.ts';

describe('colour spaces', () => {
  it('gives Rec.709 its published XYZ matrix', () => {
    const m = rgbToXyz(GAMUTS.rec709);
    [0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 3));
  });

  it('carries Rec.2020 to Rec.709 as the published matrix does, and back', () => {
    const m = gamutMatrix(GAMUTS.rec2020, GAMUTS.rec709);
    [1.6605, -0.5876, -0.0728, -0.1246, 1.1329, -0.0083, -0.0182, -0.1006, 1.1187].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 3));
    const back = apply3(invert3(m), apply3(m, [0.2, 0.5, 0.7]));
    back.forEach((v, i) => expect(v).toBeCloseTo([0.2, 0.5, 0.7][i], 6));
  });

  it('keeps white white between gamuts of the same white', () => {
    for (const g of Object.values(GAMUTS)) apply3(gamutMatrix(g, GAMUTS.rec709), [1, 1, 1]).forEach((v) => expect(v).toBeCloseTo(1, 4));
  });

  it("reads each camera's 18 % grey back near 0.18", () => {
    // the grey's level as each maker publishes it (the picture's 0..1, video range taken out)
    const grey: Record<string, number> = { slog3: (420 - 64) / 876, vlog: (433 - 64) / 876, logc3: (400 - 64) / 876, applelog: 0.4883, clog3: 0.328, hlg: 0.38 };
    for (const [s, v] of Object.entries(grey)) expect(SOURCE_SPACES[s as keyof typeof SOURCE_SPACES].decode(v), s).toBeCloseTo(0.18, 1);
    expect(SOURCE_SPACES.hlg.decode(0.75)).toBeCloseTo(1, 2);
  });

  it('decodes each curve upward, without a jump', () => {
    for (const s of SOURCES) {
      const d = SOURCE_SPACES[s].decode;
      let last = d(0);
      for (let i = 1; i <= 200; i++) {
        const v = d(i / 200);
        expect(v, `${s} at ${i / 200}`).toBeGreaterThan(last);
        expect(v - last, `${s} at ${i / 200}`).toBeLessThan(s === 'rec709' ? 0.02 : 1.5);
        last = v;
      }
    }
  });
});
