// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset, Layer } from '@tramme/core';

const perception = await import('../src/perception.ts');
const { layerFromAsset } = await import('../src/ui/LeftPanel.tsx');
const { S, load, undo } = await import('../src/state.ts');
const { newProject } = await import('@tramme/project');

const talk: Asset = { type: 'video', src: 'assets/video/talk.mp4', name: 'Talk' };
const logo: Asset = { type: 'image', src: 'assets/images/logo.png', name: 'Logo' };

/** a new project of 5 s, as the editor makes them, holding a video and a picture */
function open() {
  const project = newProject({ name: 'Test', width: 1920, height: 1080, fps: 30, duration: 5 });
  project.doc.assets.talk = talk;
  project.doc.assets.logo = logo;
  load(project.doc, project.manifest, 'http://localhost/api/projects/test/files/document.json', '');
}
const main = () => S.doc.peek().compositions[S.compId.peek()];
/** the layers added since the project opened, by their asset */
const layerOf = (asset: string) => Object.values(main().layers).find((l: Layer) => (l.props as Record<string, unknown> | undefined)?.video === asset || (l.props as Record<string, unknown> | undefined)?.image === asset);

beforeEach(open);
afterEach(() => { vi.restoreAllMocks(); });

describe('a layer of a sub-clip', () => {
  it('plays its media from the start of the range, as long as the range, without reading the file', async () => {
    const duration = vi.spyOn(perception, 'mediaDuration');
    S.doc.peek().assets.part = { type: 'video', src: talk.src, name: 'Opening', of: 'talk', range: [2, 7.5] };
    await layerFromAsset('part', S.doc.peek().assets.part);
    expect(layerOf('talk')).toMatchObject({ type: 'video', in: 0, out: 5.5, props: { video: 'talk', start: 2 } });
    expect(main().duration).toBe(5.5);
    expect(duration).not.toHaveBeenCalled();
  });
});

describe('a layer of a video asset', () => {
  it('plays a 12-minute video whole in a 5-second project', async () => {
    vi.spyOn(perception, 'mediaDuration').mockResolvedValue(753.17);
    await layerFromAsset('talk', talk);
    expect(layerOf('talk')).toMatchObject({ type: 'video', in: 0, out: 753.17 });
    expect(main().duration).toBe(753.17);
    // the new layer is the one selected
    expect(S.selection.peek()).toHaveLength(1);
    expect(main().layers[S.selection.peek()[0]]).toBe(layerOf('talk'));
  });

  it('is taken back with its length in one undo', async () => {
    vi.spyOn(perception, 'mediaDuration').mockResolvedValue(753.17);
    await layerFromAsset('talk', talk);
    undo();
    expect(layerOf('talk')).toBeUndefined();
    expect(main().duration).toBe(5);
  });

  it('ends with a short video, the project keeping its length', async () => {
    vi.spyOn(perception, 'mediaDuration').mockResolvedValue(2.5);
    await layerFromAsset('talk', talk);
    expect(layerOf('talk')).toMatchObject({ in: 0, out: 2.5 });
    expect(main().duration).toBe(5);
  });

  it('runs to the project’s end when the file’s length cannot be read', async () => {
    vi.spyOn(perception, 'mediaDuration').mockResolvedValue(0);
    await layerFromAsset('talk', talk);
    const layer = layerOf('talk')!;
    expect(layer.in).toBeUndefined();
    expect(layer.out).toBeUndefined();
    expect(main().duration).toBe(5);
  });

  it('reads the length from the asset’s own file, beside the document', async () => {
    const read = vi.spyOn(perception, 'mediaDuration').mockResolvedValue(10);
    await layerFromAsset('talk', talk);
    expect(read).toHaveBeenCalledWith('http://localhost/api/projects/test/files/assets/video/talk.mp4');
  });

  it('fills the frame and points at its asset', async () => {
    vi.spyOn(perception, 'mediaDuration').mockResolvedValue(10);
    await layerFromAsset('talk', talk);
    expect(layerOf('talk')).toMatchObject({ name: 'Talk', props: { video: 'talk', size: [1920, 1080], fit: 'cover' } });
  });
});

describe('a layer of another asset', () => {
  it('places a picture as before, without reading any length', async () => {
    const read = vi.spyOn(perception, 'mediaDuration');
    await layerFromAsset('logo', logo);
    expect(layerOf('logo')).toMatchObject({ type: 'image', props: { image: 'logo' } });
    expect(main().duration).toBe(5);
    expect(read).not.toHaveBeenCalled();
  });
});
