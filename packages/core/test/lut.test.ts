import { describe, expect, it } from 'vitest';
import { applyLut, parseCube } from '../src/lut.ts';

/** a 2³ table that swaps red and blue */
const SWAP = `# swap
TITLE "Swap"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
${[0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${b} ${g} ${r}`))).join('\n')}
`;

describe('a .cube LUT', () => {
  it('reads its size, title, domain and table, red fastest', () => {
    const lut = parseCube(SWAP);
    expect(lut).toMatchObject({ kind: 'lut3d', title: 'Swap', size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
    expect(Array.from(lut.data.slice(3, 6))).toEqual([0, 0, 1]);
  });

  it('maps a colour through the table, between its points', () => {
    const lut = parseCube(SWAP);
    expect(applyLut(lut, [1, 0, 0])).toEqual([0, 0, 1]);
    const [r, g, b] = applyLut(lut, [0.25, 0.5, 0.75]);
    expect([r, g, b].map((x) => +x.toFixed(6))).toEqual([0.75, 0.5, 0.25]);
  });

  it('says what is wrong with a file it cannot read', () => {
    expect(() => parseCube('LUT_1D_SIZE 1024\n0 0 0')).toThrow(/1D/);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow(/1 values for 8/);
    expect(() => parseCube('0 0 0')).toThrow(/before LUT_3D_SIZE/);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 x\n')).toThrow(/three numbers/);
  });
});

describe('a tone curve', () => {
  it('is the identity by its two ends', async () => {
    const { curveTable } = await import('../src/lut.ts');
    const t = curveTable([[0, 0], [1, 1]], 5);
    expect(Array.from(t).map((x) => +x.toFixed(6))).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('goes through its points without overshooting between them', async () => {
    const { curveTable } = await import('../src/lut.ts');
    // an S curve: darker shadows, brighter highlights
    const t = curveTable([[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]], 257);
    expect(t[64]).toBeCloseTo(0.15, 5);
    expect(t[192]).toBeCloseTo(0.85, 5);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1] - 1e-7);
    // a plateau stays flat
    const flat = curveTable([[0, 0], [0.4, 0.5], [0.6, 0.5], [1, 1]], 101);
    for (let i = 40; i <= 60; i++) expect(flat[i]).toBeCloseTo(0.5, 6);
  });

  it('takes its points in any order and holds past its ends', async () => {
    const { curveTable } = await import('../src/lut.ts');
    const t = curveTable([[0.8, 0.9], [0.2, 0.1]], 11);
    expect(t[0]).toBeCloseTo(0.1);
    expect(t[10]).toBeCloseTo(0.9);
  });
});
