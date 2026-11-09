import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import { assetsUsedBy, fontFaceCss, injectCss, prepareWebScenes, sceneKey, tokenCss, type SceneCapturer } from '../src/webscene.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function project(manifest: object = { duration: 1, size: [320, 180], entry: 'index.html', parameters: {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-webscene-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'scenes', 'title'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scenes', 'title', 'scene.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'scenes', 'title', 'index.html'), '<p>one</p>');
  const { doc } = newProject({ name: 'Scene', width: 320, height: 180, fps: 6, duration: 1 });
  doc.compositions.main.layers.scene = { type: 'webscene', name: 'Scene', transform: { position: [160, 90] }, props: { folder: 'scenes/title', frames: [], fps: 6, size: [320, 180] } } as never;
  doc.compositions.main.order = ['scene'];
  const file = path.join(dir, 'document.tramme.json');
  fs.writeFileSync(file, JSON.stringify(doc));
  return { dir, doc, file };
}

const fake = (): SceneCapturer & ReturnType<typeof vi.fn> => vi.fn(async ({ out, frames }) => {
  for (let i = 0; i < frames; i++) fs.writeFileSync(path.join(out, `frame_${String(i).padStart(6, '0')}.png`), `frame ${i}`);
}) as never;

describe('web scene export', () => {
  it('captures a scene once, hands the frames to the layer and cleans up its derived document', async () => {
    const { dir, doc, file } = project();
    const capture = fake();
    const prepared = await prepareWebScenes(file, doc, capture);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toMatchObject({ entry: 'index.html', size: [320, 180], fps: 6, frames: 6 });
    expect([prepared.captured, prepared.reused]).toEqual([1, 0]);
    const derived = JSON.parse(fs.readFileSync(prepared.file, 'utf8'));
    const ids: string[] = derived.compositions.main.layers.scene.props.frames;
    expect(ids).toHaveLength(6);
    expect(derived.assets[ids[2]].src).toMatch(/^renders\/webscene\/[0-9a-f]{24}\/frame_000002\.png$/);
    expect(fs.existsSync(path.join(dir, derived.assets[ids[5]].src))).toBe(true);
    expect(doc.compositions.main.layers.scene.props?.frames).toEqual([]);
    prepared.cleanup();
    expect(fs.existsSync(prepared.file)).toBe(false);
  });

  it('renders again only the scene whose folder changed', async () => {
    const { dir, doc, file } = project();
    const capture = fake();
    (await prepareWebScenes(file, doc, capture)).cleanup();
    const second = await prepareWebScenes(file, doc, capture);
    second.cleanup();
    expect([second.captured, second.reused, capture.mock.calls.length]).toEqual([0, 1, 1]);
    fs.writeFileSync(path.join(dir, 'scenes', 'title', 'index.html'), '<p>two</p>');
    const third = await prepareWebScenes(file, doc, capture);
    third.cleanup();
    expect([third.captured, third.reused, capture.mock.calls.length]).toEqual([1, 0, 2]);
  });

  it('keys the cache on the folder, the size and the rate', () => {
    const { dir } = project();
    const scene = path.join(dir, 'scenes', 'title');
    const base = sceneKey(scene, [320, 180], 6);
    expect(sceneKey(scene, [320, 180], 6)).toBe(base);
    expect(sceneKey(scene, [640, 360], 6)).not.toBe(base);
    expect(sceneKey(scene, [320, 180], 12)).not.toBe(base);
  });

  it('leaves a document without scenes, or with frames already listed, alone', async () => {
    const { doc, file } = project();
    const capture = fake();
    const frames = { ...doc, compositions: { main: { ...doc.compositions.main, layers: { scene: { ...doc.compositions.main.layers.scene, props: { ...doc.compositions.main.layers.scene.props, frames: ['x'] } } } } } } as never;
    const prepared = await prepareWebScenes(file, frames, capture);
    expect([prepared.file, capture.mock.calls.length]).toEqual([file, 0]);
  });

  it('refuses a folder outside the project and a capture that comes back short, without keeping a partial cache', async () => {
    const { dir, doc, file } = project();
    (doc.compositions.main.layers.scene.props as { folder: string }).folder = '../elsewhere';
    await expect(prepareWebScenes(file, doc, fake())).rejects.toThrow(/not found in the project/);
    (doc.compositions.main.layers.scene.props as { folder: string }).folder = 'scenes/title';
    const short: SceneCapturer = async ({ out }) => { fs.writeFileSync(path.join(out, 'frame_000000.png'), 'x'); };
    await expect(prepareWebScenes(file, doc, short)).rejects.toThrow(/captured 1 of 6 frames/);
    const cache = path.join(dir, 'renders', 'webscene');
    const keys = fs.readdirSync(cache);
    expect(keys.every((name) => name.endsWith('.partial'))).toBe(true);
    const ok = await prepareWebScenes(file, doc, fake());
    ok.cleanup();
    expect(ok.captured).toBe(1);
  });
});

describe('project tokens in a scene', () => {
  const tokens = {
    ink: { type: 'color', value: '#1C1917' },
    pace: { type: 'number', value: 0.4 },
    swift: { type: 'ease', value: [0.16, 1, 0.3, 1] },
    label: { type: 'string', value: 'a </style><b> "x"' },
    offset: { type: 'vec2', value: [4, -2] },
    bad: { type: 'color', value: 'red; } body { display: none' },
    'not valid': { type: 'number', value: 1 },
    nan: { type: 'number', value: Number.NaN },
  } as never;

  it('become CSS variables, and nothing that is not plain data gets through', () => {
    const css = tokenCss(tokens);
    expect(css).toBe(':root {\n  --ink: #1C1917;\n  --label: "a \\3c /style>\\3c b> \\"x\\"";\n  --offset: 4 -2;\n  --pace: 0.4;\n  --swift: cubic-bezier(0.16, 1, 0.3, 1);\n}');
    expect(css).not.toContain('display');
    expect(tokenCss(undefined)).toBe('');
  });

  it('are put first in the scene\'s head, or at the start of a bare page', () => {
    const css = ':root { --a: 1; }';
    expect(injectCss('<!doctype html><html><head><title>t</title></head>', css)).toBe('<!doctype html><html><head><style id="tramme-tokens">:root { --a: 1; }</style><title>t</title></head>');
    expect(injectCss('<p>x</p>', css)).toBe('<style id="tramme-tokens">:root { --a: 1; }</style><p>x</p>');
    expect(injectCss('<p>x</p>', '')).toBe('<p>x</p>');
  });

  it('give the capture the style, and capture again when a token changes', async () => {
    const { doc, file } = project();
    doc.tokens = { ink: { type: 'color', value: '#111111' } } as never;
    const capture = fake();
    (await prepareWebScenes(file, doc, capture)).cleanup();
    expect(capture.mock.calls[0][0].css).toBe(':root {\n  --ink: #111111;\n}');
    doc.tokens = { ink: { type: 'color', value: '#222222' } } as never;
    const again = await prepareWebScenes(file, doc, capture);
    again.cleanup();
    expect([again.captured, capture.mock.calls.length]).toEqual([1, 2]);
  });
});

describe('project fonts and pictures in a scene', () => {
  it('declares the document fonts, served from the project\'s /assets/', () => {
    const css = fontFaceCss({
      a: { type: 'font', src: 'assets/fonts/Geist Sans.woff2', family: 'Geist', weight: '100 900' },
      b: { type: 'font', src: 'assets/fonts/x.woff2', family: 'Evil"; } body { x', weight: '400' },
      c: { type: 'font', src: '../outside.woff2', family: 'Out' },
      d: { type: 'image', src: 'assets/p.png' },
    } as never);
    expect(css).toBe('@font-face { font-family: "Geist"; src: url("/assets/fonts/Geist%20Sans.woff2"); font-weight: 100 900; font-style: normal; font-display: block; }');
  });

  it('finds the project files a scene names, and only inside assets/', () => {
    const { dir } = project();
    const scene = path.join(dir, 'scenes', 'title');
    fs.writeFileSync(path.join(scene, 'index.html'), '<img src="/assets/logo.png"><style>@font-face{src:url(/assets/fonts/a%20b.woff2)}</style><a href="/assets/../secret.png">');
    expect(assetsUsedBy(scene, ['assets/fonts/doc.woff2', 'plugins/x.js'])).toEqual(['assets/fonts/a b.woff2', 'assets/fonts/doc.woff2', 'assets/logo.png']);
  });

  it('captures again when a picture the scene uses changes', async () => {
    const { dir, doc, file } = project();
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', 'logo.png'), 'one');
    fs.writeFileSync(path.join(dir, 'scenes', 'title', 'index.html'), '<img src="/assets/logo.png">');
    const capture = fake();
    (await prepareWebScenes(file, doc, capture)).cleanup();
    (await prepareWebScenes(file, doc, capture)).cleanup();
    expect(capture.mock.calls.length).toBe(1);
    expect(capture.mock.calls[0][0].projectDir).toBe(dir);
    fs.writeFileSync(path.join(dir, 'assets', 'logo.png'), 'two');
    (await prepareWebScenes(file, doc, capture)).cleanup();
    expect(capture.mock.calls.length).toBe(2);
  });
});
