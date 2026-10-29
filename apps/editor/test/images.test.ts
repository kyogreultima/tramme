// The pictures' tool, its pure parts: the proportions, a picture made again
// changing only what is asked, the palette said, an extension's canvas, the
// size a picture is brought to and its sharpening; and the takes' picker.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@tramme/core';

vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {} });
vi.stubGlobal('document', { hidden: true, hasFocus: () => false, documentElement: { dataset: {} }, querySelector: () => null });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('addEventListener', () => {});

// the files the pictures are kept in, and the canvas, are the browser's: the tool is read through what it records
const kept: Record<string, unknown>[] = [];
const placed: Record<string, unknown>[] = [];
vi.mock('../src/media.ts', async (original) => ({
  ...(await original<typeof import('../src/media.ts')>()),
  canvasOf: (width: number, height: number) => ({ c: { width, height }, g: { drawImage() {} } }),
  dataUrl: async () => 'data:,reference',
  keepMedia: async (_ctx: unknown, _kind: string, _name: string, _blob: Blob, record: Record<string, unknown>) => { kept.push(record); return { asset: 'image-x', ops: [], reload: [] }; },
  placeMedia: (_ctx: unknown, _kind: string, asset: string, name: string, o: Record<string, unknown>) => { placed.push({ asset, name, ...o }); return { ops: [], layer: 'layer-x' }; },
}));
let cut = 0.4;
vi.mock('../src/removebg.ts', async (original) => ({ ...(await original<typeof import('../src/removebg.ts')>()), cutoutBlob: async () => ({ blob: new Blob(['cut'], { type: 'image/png' }), kept: cut }) }));
vi.mock('../src/perception.ts', async (original) => ({ ...(await original<typeof import('../src/perception.ts')>()), jpegOf: () => 'data:image/jpeg;base64,x' }));

const images = await import('../src/images.ts');
const confirm = await import('../src/confirm.ts');
const { api } = await import('../src/api.ts');

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

const made = (n = 1) => Array.from({ length: n }, (_, i) => ({ blob: new Blob([`take ${i + 1}`]), provider: 'openai', model: 'gpt-image' }));

describe('the takes, held for the session', () => {
  it('keeps one take by its index, and lets them all go', async () => {
    const id = images.holdTakes(made(3), { label: 'road' });
    expect(id).toMatch(/^takes-/);
    const second = images.takeHeld(`${id}:2`)!;
    expect(second.made).toHaveLength(1);
    await expect(second.made[0].blob.text()).resolves.toBe('take 2');
    expect(second.extra.label).toBe('road');
    expect(second.take).toBe(2);
    expect(images.takeHeld(`${id}:2`)).toBeNull();
    expect(images.takeHeld(id)).toBeNull();
  });

  it('answers null for a take that was never held', () => {
    expect(images.takeHeld('takes-zzz:1')).toBeNull();
    const id = images.holdTakes(made(2), {});
    expect(images.takeHeld(`${id}:5`)).toBeNull();
  });
});

describe('a style frame as the reference of a picture', () => {
  const seen: string[] = [];
  const ctx = {
    doc: { compositions: { main: { width: 1920, height: 1080, fps: 30, duration: 10, layers: {}, order: [] } }, assets: {}, tokens: {} }, compId: 'main',
    fileUrl: (path: string) => `/files/${path}`, assetUrl: () => '', signal: new AbortController().signal,
    readText: async (path: string) => files.get(path) ?? null,
  } as unknown as ToolContext;
  const files = new Map<string, string>();
  const tool = images.IMAGE_TOOLS[0];
  afterEach(() => { vi.restoreAllMocks(); confirm.turnEnds(); kept.length = 0; placed.length = 0; seen.length = 0; files.clear(); cut = 0.4; });
  const arrange = () => {
    vi.stubGlobal('fetch', async (url: string) => { seen.push(url); return url.includes('missing') ? { ok: false, status: 404 } : { ok: true, blob: async () => new Blob(['frame']) }; });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1600, height: 900, close() {} }));
    confirm.turnBegins(true);
  };

  it('reads the frame file through the project, sends it, and records its path', async () => {
    arrange();
    const ask = vi.spyOn(api, 'generateImages').mockResolvedValue(made());
    await tool.run({ prompt: 'a plate, no words', provider: 'openai', reference: 'assets/frames/a.jpg' }, ctx);
    expect(seen).toEqual(['/files/assets/frames/a.jpg']);
    expect(ask.mock.calls[0][0].reference).toBe('data:,reference');
    expect(kept[0].reference).toBe('assets/frames/a.jpg');
  });

  it('names the path of a frame file that is missing', async () => {
    arrange();
    const ask = vi.spyOn(api, 'generateImages').mockResolvedValue(made());
    await expect(tool.run({ prompt: 'a plate', provider: 'openai', reference: 'assets/frames/missing.jpg' }, ctx)).rejects.toThrow(/assets\/frames\/missing\.jpg/);
    expect(ask).not.toHaveBeenCalled();
  });

  it('keeps an asset id exactly as before: it must be an image asset of the project', async () => {
    arrange();
    await expect(tool.run({ prompt: 'a plate', provider: 'openai', reference: 'nope' }, ctx)).rejects.toThrow(/an image asset of the project/);
  });

  describe('an object on a transparent ground', () => {
    const SUFFIX = 'A single object, whole and centred, on a plain flat ground of one colour, soft even light, nothing else in the frame, no text, no shadow on the ground.';

    it('asks for one object on a flat ground, cuts it out, and places it whole', async () => {
      arrange();
      const ask = vi.spyOn(api, 'generateImages').mockResolvedValue(made());
      await tool.run({ prompt: 'a ceramic bowl of ramen', object: true }, ctx);
      expect(ask.mock.calls[0][0].prompt.trimEnd().endsWith(SUFFIX)).toBe(true);
      expect(kept[0]).toMatchObject({ object: true, kept: 0.4 });
      expect(placed[0]).toMatchObject({ fit: 'contain', background: false, size: [648, 648] });
    });

    it('draws in the style of the film\'s target when the plan has one', async () => {
      arrange();
      files.set('assets/film-plan.json', JSON.stringify({ version: 1, kind: 'film-plan', updated: '', idea: 'x', kinds: [], scenes: [], directions: [], target: 'assets/frames/the-app-ink.jpg' }));
      const ask = vi.spyOn(api, 'generateImages').mockResolvedValue(made());
      await tool.run({ prompt: 'a phone', object: true, provider: 'openai' }, ctx);
      expect(seen).toEqual(['/files/assets/frames/the-app-ink.jpg']);
      expect(ask.mock.calls[0][0].reference).toBe('data:,reference');
      expect(ask.mock.calls[0][0].prompt).toContain('in the style of the reference picture: its rendering, light and palette, not its content');
      expect(kept[0].reference).toBe('assets/frames/the-app-ink.jpg');
    });

    it('never makes an object the background', async () => {
      arrange();
      const ask = vi.spyOn(api, 'generateImages').mockResolvedValue(made());
      await expect(tool.run({ prompt: 'a phone', object: true, background: true }, ctx)).rejects.toThrow(/never a background/);
      expect(ask).not.toHaveBeenCalled();
    });

    it('keeps the asset and says the cutout looks wrong when the subject is almost gone, or almost everything', async () => {
      arrange();
      vi.spyOn(api, 'generateImages').mockResolvedValue(made());
      cut = 0.01;
      const small = await tool.run({ prompt: 'a lamp', object: true }, ctx) as { text: string };
      expect(small.text).toMatch(/cutout looks wrong/);
      expect(kept).toHaveLength(1);
      cut = 0.95;
      expect(((await tool.run({ prompt: 'a lamp', object: true }, ctx)) as { text: string }).text).toMatch(/cutout looks wrong/);
      cut = 0.4;
      expect(((await tool.run({ prompt: 'a lamp', object: true }, ctx)) as { text: string }).text).not.toMatch(/cutout looks wrong/);
    });
  });
});
