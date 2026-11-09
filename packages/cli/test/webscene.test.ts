import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import { prepareWebScenes, sceneKey, type SceneCapturer } from '../src/webscene.ts';

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
