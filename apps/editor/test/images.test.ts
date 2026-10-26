// The pictures' tool, its pure parts: the proportions, a picture made again
// changing only what is asked, the palette said, an extension's canvas, the
// size a picture is brought to and its sharpening; and the takes' picker.

import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {} });
vi.stubGlobal('document', { hidden: true, hasFocus: () => false, documentElement: { dataset: {} }, querySelector: () => null });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('addEventListener', () => {});

const images = await import('../src/images.ts');
const confirm = await import('../src/confirm.ts');

describe('pictures', () => {
  it('asks the proportions closest to the composition', () => {
    expect(images.ratioOf(1920, 1080)).toBe('16:9');
    expect(images.ratioOf(1080, 1920)).toBe('9:16');
    expect(images.ratioOf(1000, 1000)).toBe('1:1');
    expect(images.ratioOf(2560, 1080)).toBe('21:9');
  });

  it('makes a picture again changing only what is asked', () => {
    const p = images.againPrompt('a lighthouse at dusk, flat vector', 'night instead of dusk');
    expect(p.startsWith('a lighthouse at dusk, flat vector')).toBe(true);
    expect(p).toMatch(/Change only this: night instead of dusk/);
    expect(p).toMatch(/Keep everything else/);
    expect(images.againPrompt('same', '  ')).toBe('same');
  });

  it('says the project\'s palette, its colours only', () => {
    expect(images.paletteWords({ accent: { type: 'color', value: '#2ec4b6' }, smooth: { type: 'ease', value: [0, 0, 1, 1] }, text: { type: 'color', value: '#F4F5F7' } })).toBe("The project's palette: accent #2EC4B6, text #F4F5F7 — keep to these colours.");
    expect(images.paletteWords({})).toBe('');
  });

  it('extends a picture to wider or taller proportions, centred, its size kept', () => {
    expect(images.extension(1000, 1000, '16:9')).toEqual({ width: 1778, height: 1000, x: 389, y: 0 });
    expect(images.extension(1600, 900, '9:16')).toEqual({ width: 1600, height: 2844, x: 0, y: 972 });
    // already as wide: nothing added that way
    expect(images.extension(1600, 900, '16:9')).toEqual({ width: 1600, height: 900, x: 0, y: 0 });
  });

  it('enlarges a small picture by a whole factor to fill the frame, never shrinks one', () => {
    expect(images.upscaleFactor(1024, 1024, 1920, 1080, 'cover')).toBe(2);
    expect(images.upscaleFactor(640, 360, 1920, 1080, 'contain')).toBe(3);
    expect(images.upscaleFactor(200, 200, 3840, 2160)).toBe(4);
    expect(images.upscaleFactor(2048, 2048, 1920, 1080)).toBeNull();
  });

  it('the takes: a picture kept by its index, none when the user keeps none', async () => {
    const a = confirm.chooseAmong('Which?', 'pick', [{ url: 'data:,a', label: 'Take 1' }, { url: 'data:,b', label: 'Take 2' }]);
    expect(confirm.question.peek()?.choices).toHaveLength(2);
    confirm.choose(1);
    await expect(a).resolves.toBe(1);
    expect(confirm.question.peek()).toBeNull();
    const b = confirm.chooseAmong('Which?', 'pick', [{ url: 'data:,a', label: 'Take 1' }]);
    confirm.answer(false);
    await expect(b).resolves.toBeNull();
    // the assistant alone: nobody to ask, the choice handed back
    confirm.turnBegins(true);
    await expect(confirm.chooseAmong('Which?', 'pick', [{ url: 'data:,a', label: 'Take 1' }])).resolves.toBeNull();
    expect(confirm.alone()).toBe(true);
    confirm.turnEnds();
  });

  it('a turn alone counts every take against its allowance', async () => {
    confirm.turnBegins(true);
    await expect(confirm.payFor('t', 'x', 'y', 'ask', 4)).resolves.toBeUndefined();
    await expect(confirm.payFor('t', 'x', 'y', 'ask', 7)).rejects.toThrow(/allowance/);
    confirm.turnEnds();
  });
});
