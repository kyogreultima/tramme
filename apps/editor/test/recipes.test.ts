import { describe, expect, it } from 'vitest';
import { applyOps, runChecks, validate, type ToolContext, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { BUILTIN_KITS, parseData, parseEvents, parseStops, style } from '../src/recipes.ts';
import { editorRegistry } from '../src/vocabulary.ts';

const reg = editorRegistry();
const project = (w = 1080, h = 1920) => newProject({ name: 'Recipes', width: w, height: h, fps: 30, duration: 12 }).doc;
const ctxOf = (doc: TrammeDoc, time = 1): ToolContext => ({ doc, compId: doc.root, time, selection: [], registry: reg, writeFile: async (path: string) => path } as unknown as ToolContext);
/** run a tool of the vocabulary and apply its operations */
async function use(doc: TrammeDoc, name: string, input: Record<string, unknown>, time = 1): Promise<TrammeDoc> {
  const out = (await reg.tool(name).tool.run(input, ctxOf(doc, time))) as { ops: never[] };
  return applyOps(doc, out.ops).doc;
}

describe('recipes', () => {
  it('read data written by hand', () => {
    expect(parseData('2022: 12, 2023: 30,5; 2024 = 45')).toEqual([{ label: '2022', value: 12 }, { label: '2023', value: 30 }, { label: '3', value: 5 }, { label: '2024', value: 45 }]);
    expect(parseData('3, 7')).toEqual([{ label: '1', value: 3 }, { label: '2', value: 7 }]);
    expect(parseData('Paris: 2.5\nLyon: 1.2')).toEqual([{ label: 'Paris', value: 2.5 }, { label: 'Lyon', value: 1.2 }]);
    expect(parseEvents('2020: Launch, 2022: Series B\n2024: Scale-up')).toEqual([{ label: '2020', text: 'Launch' }, { label: '2022', text: 'Series B' }, { label: '2024', text: 'Scale-up' }]);
    expect(parseStops('0.18,0.32 0.5,0.62 0.82,0.38')).toEqual([[0.18, 0.32], [0.5, 0.62], [0.82, 0.38]]);
  });

  for (const [w, h] of [[1080, 1920], [1920, 1080]]) {
    it(`lay out valid pieces that pass the checks (${w}×${h})`, async () => {
      let doc = project(w, h);
      doc = await use(doc, 'kit', { kit: 'punchy', font: false });
      doc = await use(doc, 'kinetic-title', { text: 'Make every second count', style: 'pop', emphasis: 3, at: 0.5, duration: 3 });
      doc = await use(doc, 'transition', { at: 4, style: 'bars' });
      doc = await use(doc, 'bar-chart', { data: '2022: 12, 2023: 30, 2024: 45', title: 'Growth', unit: '%', at: 4.4, duration: 4 });
      doc = await use(doc, 'stat', { value: '1,250', label: 'new members', at: 8.6, duration: 3 });
      expect(validate(doc, reg)).toEqual([]);
      const warnings = (await runChecks(doc, reg)).filter((i) => i.severity === 'warning');
      expect(warnings.map((i) => i.message)).toEqual([]);
    });
  }

  it('lay out the newer recipes one after another', async () => {
    let doc = newProject({ name: 'Recipes', width: 1920, height: 1080, fps: 30, duration: 24 }).doc;
    doc = { ...doc, assets: { ...doc.assets, pic1: { type: 'image', src: 'assets/pic1.png' }, pic2: { type: 'image', src: 'assets/pic2.png' } } };
    doc = await use(doc, 'kit', { kit: 'punchy', font: false });
    doc = await use(doc, 'split-screen', { assets: ['pic1', 'pic2'], at: 0, duration: 2.5 });
    doc = await use(doc, 'logo-reveal', { logo: 'pic1', name: 'Tramme', style: 'iris', at: 2.7, duration: 2 });
    doc = await use(doc, 'kinetic-title', { text: 'Make every second count', style: 'pop', emphasis: 3, at: 4.9, duration: 3 });
    doc = await use(doc, 'quote', { text: 'The best way to predict the future is to invent it', author: 'Alan Kay', emphasis: 7, at: 8, duration: 3 });
    doc = await use(doc, 'list', { items: 'Plan, Build, Measure', title: 'How we work', marker: 'number', at: 11.2, duration: 3 });
    doc = await use(doc, 'timeline', { data: '2020: Launch, 2022: Series B', title: 'The road', at: 14.4, duration: 3.5 });
    doc = await use(doc, 'map-journey', { stops: '0.2,0.3 0.5,0.6 0.8,0.4', names: 'Paris, Lyon, Marseille', at: 18, duration: 4 });
    expect(validate(doc, reg)).toEqual([]);
    const warnings = (await runChecks(doc, reg)).filter((i) => i.severity === 'warning');
    expect(warnings.map((i) => i.message)).toEqual([]);
  });

  it('keep their keys in order with a slow kit and the shortest pieces', async () => {
    // calm: a 1 s entrance, longer than what a 1 s piece leaves before its fade out
    let doc = await use(project(), 'kit', { kit: 'calm', font: false });
    doc = { ...doc, assets: { ...doc.assets, logo: { type: 'image', src: 'assets/logo.png' } } };
    doc = await use(doc, 'list', { items: 'One, Two, Three', title: 'Steps', at: 0, duration: 1 });
    doc = await use(doc, 'timeline', { data: '2020: Launch, 2022: Series B, 2024: Today', title: 'Road', at: 1, duration: 1 });
    doc = await use(doc, 'logo-reveal', { logo: 'logo', name: 'Brand', style: 'rise', at: 2, duration: 1 });
    doc = await use(doc, 'map-journey', { stops: '0.2,0.3 0.5,0.6 0.8,0.4', names: 'Paris, Lyon, Marseille', at: 3, duration: 1 });
    doc = await use(doc, 'stat', { value: '42', label: 'Answers', at: 6, duration: 1 });
    expect(validate(doc, reg)).toEqual([]);
  });

  it('follow the style kit', async () => {
    let doc = await use(project(), 'kit', { kit: 'editorial', font: false });
    doc = await use(doc, 'kinetic-title', { text: 'Hello world', emphasis: 2 });
    expect(doc.tokens.accent.value).toBe('#C2410C');
    expect(doc.compositions.main.background).toBe('@plate');
    const words = Object.values(doc.compositions.main.layers).filter((l) => l.type === 'text');
    expect(words.map((l) => l.props?.color)).toEqual(['@ink', '@accent']);
  });

  it('bring a kit font into the project', async () => {
    const was = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      asked.push(String(url));
      return new Response(new Blob([new Uint8Array([119, 111, 102, 50])]), { status: 200 });
    }) as typeof fetch;
    try {
      const doc = await use(project(), 'kit', { kit: 'calm' });
      const font = doc.assets['font-karla'];
      expect(font).toMatchObject({ type: 'font', family: 'Karla', weight: '200 800' });
      expect(font.src).toBe('assets/fonts/karla.woff2');
      expect(asked).toEqual(['https://cdn.jsdelivr.net/fontsource/fonts/karla:vf@5.3.0/latin-wght-normal.woff2']);
      // every kit font at a pinned version; a variable one (a weight range) under "<id>:vf", or the CDN answers 404
      for (const k of BUILTIN_KITS) {
        if (!k.font) continue;
        expect(k.font.url).not.toMatch(/@latest/);
        expect(k.font.url.includes(':vf@')).toBe(/\d+ \d+/.test(k.font.weight ?? ''));
      }
      // a second kit does not pile fonts on: the project's font stays
      const again = await use(doc, 'kit', { kit: 'neon' });
      expect(again.assets['font-space-grotesk']).toBeUndefined();
      expect(again.assets['font-karla']).toBeDefined();
    } finally { globalThis.fetch = was; }
  });

  it('place a kinetic title as a group of words that leaves together', async () => {
    const doc = await use(project(), 'kinetic-title', { text: 'one two three four five six seven eight', at: 2 });
    const c = doc.compositions.main, group = Object.values(c.layers).find((l) => l.type === 'group')!;
    expect(group.children).toHaveLength(8);
    expect(group.in).toBe(2);
    // the words are children, not in the root stack
    expect(c.order).toHaveLength(1);
  });

  it('place a quote as its words, a mark and an author line', async () => {
    let doc = await use(project(), 'kit', { kit: 'editorial', font: false });
    doc = await use(doc, 'quote', { text: 'one two three', author: 'Someone', emphasis: 2 });
    const c = doc.compositions.main, group = Object.values(c.layers).find((l) => l.type === 'group')!;
    expect(group.children).toHaveLength(5); // the mark, three words, the author
    const words = group.children!.map((id) => c.layers[id]);
    expect(words[1].props?.color).toBe('@ink');
    expect(words[2].props?.color).toBe('@accent');
  });

  it('tick a list in as one group of rows', async () => {
    const doc = await use(project(), 'list', { items: 'Plan, Build, Measure' });
    const c = doc.compositions.main, group = Object.values(c.layers).find((l) => l.type === 'group')!;
    expect(group.children).toHaveLength(6); // a tick and a text per row
    expect(group.children!.some((id) => c.layers[id].type === 'shape.path')).toBe(true);
  });

  it('draw a map journey with a revealed line and a dot riding it', async () => {
    const doc = await use(project(), 'map-journey', { stops: '0.2,0.3 0.5,0.6 0.8,0.4', names: 'Paris, Lyon, Marseille' });
    const c = doc.compositions.main;
    const path = Object.values(c.layers).find((l) => l.type === 'shape.path' && l.name?.includes('route'))!;
    expect(path.effects ?? []).toEqual([]); // no matte: the line draws itself with its trim
    expect((path.props!.path as { v: unknown[][] }).v).toHaveLength(3);
    const dot = c.layers['journey-dot'];
    expect((dot.transform!.position as { $k: unknown[] }).$k).toHaveLength(3);
    // the trim keeps pace with the dot: a key at the start and at each arrival, the same moments, ending whole
    const at = (k: { $k: { t: number }[] }) => k.$k.map((x) => x.t);
    const trim = path.props!.trimEnd as { $k: { t: number; v: number }[] };
    expect(trim.$k.length).toBe(3);
    expect(at(trim).slice(1)).toEqual(at(dot.transform!.position as never).slice(1));
    expect(trim.$k[0].v).toBe(0);
    expect(trim.$k.at(-1)!.v).toBe(1);
  });

  it('split the frame into sliding panels', async () => {
    let doc = project();
    doc = { ...doc, assets: { ...doc.assets, pic1: { type: 'image', src: 'assets/pic1.png' }, pic2: { type: 'image', src: 'assets/pic2.png' }, clip1: { type: 'video', src: 'assets/clip1.mp4' } } };
    doc = await use(doc, 'split-screen', { assets: ['clip1', 'pic2'], at: 1, duration: 3 });
    const panels = Object.values(doc.compositions.main.layers).filter((l) => l.type === 'video' || l.type === 'image');
    expect(panels).toHaveLength(2);
    expect(panels[0].props?.muted).toBe(false);
    expect(panels[1].props?.muted).toBeUndefined();
  });

  it('refuse what they cannot lay out', async () => {
    await expect(use(project(), 'bar-chart', { data: 'nothing here' })).rejects.toThrow(/no value/);
    await expect(use(project(), 'stat', { value: 'many' })).rejects.toThrow(/digits/);
    await expect(use(project(), 'kit', { kit: 'nope', font: false })).rejects.toThrow(/unknown kit/);
    await expect(use(project(), 'map-journey', { stops: '0.5,0.5' })).rejects.toThrow(/two stops/);
    await expect(use(project(), 'timeline', { data: 'nothing' })).rejects.toThrow(/two events/);
    await expect(use(project(), 'list', { items: 'a,b,c,d,e,f,g,h,i' })).rejects.toThrow(/at most/);
    await expect(use(project(), 'quote', { text: '   ' })).rejects.toThrow(/empty/);
  });
});

describe('the faces of a film', () => {
  const withFonts = (...names: string[]) => {
    const doc = project();
    return { ...doc, assets: { ...doc.assets, ...Object.fromEntries(names.map((name) => [`font-${name.split(' ')[0].toLowerCase()}`, { type: 'font' as const, src: `assets/fonts/${name}.woff2`, family: name.split(' (')[0], name }])) } };
  };
  /** the layers of the main composition, the children of groups included, by id */
  const layersOf = (doc: TrammeDoc) => Object.entries(doc.compositions.main.layers);

  it('tell the display face from the text face', () => {
    const two = withFonts('Bebas (display)', 'Inter (text)');
    expect(style(two)).toMatchObject({ display: 'font-bebas', font: 'font-inter' });
    // listed the other way round, the names decide
    const swapped = withFonts('Inter (text)', 'Bebas (display)');
    expect(style(swapped)).toMatchObject({ display: 'font-bebas', font: 'font-inter' });
    expect(style(withFonts('Karla')).display).toBe('font-karla');
    expect(style(withFonts('Karla')).font).toBe('font-karla');
    expect(style(withFonts('Inter (text)')).display).toBe('font-inter');
    expect(style(project())).toMatchObject({ display: null, font: null });
  });

  it('write the headlines in the display face and the rest in the text face', async () => {
    let doc = await use(withFonts('Bebas (display)', 'Inter (text)'), 'kinetic-title', { text: 'Make it count', at: 0.5, duration: 3 });
    doc = await use(doc, 'list', { items: 'Plan, Build, Measure', title: 'How we work', at: 4, duration: 3 });
    doc = await use(doc, 'stat', { value: '42', label: 'answers', at: 8, duration: 3 });
    doc = await use(doc, 'timeline', { data: '2020: Launch, 2022: Series B', title: 'The road', at: 11, duration: 3 });
    doc = await use(doc, 'bar-chart', { data: '2022: 12, 2023: 30', title: 'Growth', at: 14, duration: 3 });
    doc = await use(doc, 'quote', { text: 'Invent the future', author: 'Alan Kay', at: 17, duration: 3 });
    const of = (name: string) => layersOf(doc).find(([id]) => id.startsWith(name))?.[1].props?.font;
    expect(of('word')).toBe('font-bebas');
    for (const title of ['list-title', 'stat-value', 'timeline-title', 'chart-title', 'quote-word']) expect(of(title), title).toBe('font-bebas');
    for (const rest of ['list-text', 'stat-label', 'timeline-label', 'timeline-text', 'bar-label', 'bar-value', 'quote-author']) expect(of(rest), rest).toBe('font-inter');
    expect(validate(doc, reg)).toEqual([]);
  });

  it('keep one font for everything when the film has only one', async () => {
    const doc = await use(withFonts('Karla'), 'list', { items: 'One, Two', title: 'Steps', at: 0, duration: 3 });
    const fonts = new Set(layersOf(doc).map(([, l]) => l.props?.font).filter(Boolean));
    expect([...fonts]).toEqual(['font-karla']);
  });
});
