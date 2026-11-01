// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Renderer } from '@tramme/render';

await import('../src/ai/index.ts');
const { preview } = await import('../src/preview.ts');
const { load, S } = await import('../src/state.ts');
const { newProject } = await import('@tramme/project');
const { Stills } = await import('../src/frames.ts');

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); preview.renderer = null; });

it('does not download and decode a complete video to normalize live preview loudness', async () => {
  const project = newProject({ name: 'Streaming voice', width: 1920, height: 1080, fps: 24, duration: 10 });
  project.doc.assets.source = { type: 'video', src: 'source.mp4' };
  project.doc.compositions[project.doc.root].layers.video = { type: 'video', props: { video: 'source' } };
  project.doc.compositions[project.doc.root].order = ['video'];
  preview.renderer = { assets: { url: () => 'http://localhost/source.mp4' } } as unknown as Renderer;
  const offline = vi.fn(function() { throw new Error('unnecessary whole-file decoding'); });
  vi.stubGlobal('OfflineAudioContext', offline);
  (preview as unknown as { levelOf(doc: typeof project.doc, compId: string): void }).levelOf(project.doc, project.doc.root);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(offline).not.toHaveBeenCalled();
});

it('uses preview proxies when opening the storyboard renderer', async () => {
  const project = newProject({ name: 'Storyboard', width: 1920, height: 1080, fps: 24, duration: 10 });
  load(project.doc, project.manifest, 'http://localhost/api/projects/p/files/document.tramme.json', '');
  const open = vi.spyOn(Renderer, 'open').mockResolvedValue({} as Renderer);
  await new Stills().rendererFor(project.doc);
  expect(open.mock.calls[0][4]).toMatchObject({ proxies: true });
});

it('stops requesting sandbox frames once a paused picture is complete', async () => {
  const project = newProject({ name: 'Idle', width: 1920, height: 1080, fps: 24, duration: 10 });
  load(project.doc, project.manifest, 'http://localhost/api/projects/p/files/document.tramme.json', '');
  S.playing.value = false;
  S.previewScale.value = 0.5;
  preview.renderer = { scale: 0.5, sandboxModules: true, setScale() {} } as unknown as Renderer;
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  const draw = vi.spyOn(preview as unknown as { drawSandboxFrame(t: number): Promise<void> }, 'drawSandboxFrame').mockResolvedValue();
  preview.invalidate();
  for (let i = 0; i < 5 && frames.length; i++) {
    frames.shift()!(performance.now());
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(draw).toHaveBeenCalledOnce();
  expect(frames).toHaveLength(0);
});

it('keeps the displayed canvas size while an asynchronous sandbox frame is pending', async () => {
  const project = newProject({ name: 'Resize', width: 1920, height: 1080, fps: 24, duration: 10 });
  load(project.doc, project.manifest, 'http://localhost/api/projects/p/files/document.tramme.json', '');
  S.playing.value = false;
  S.previewScale.value = 0.5;
  const setScale = vi.fn();
  preview.renderer = { scale: 0.25, sandboxModules: true, setScale } as unknown as Renderer;
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  let finish: () => void = () => {};
  vi.spyOn(preview as unknown as { drawSandboxFrame(t: number): Promise<void> }, 'drawSandboxFrame').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  preview.invalidate();
  frames.shift()!(performance.now());
  try { expect(setScale).not.toHaveBeenCalled(); }
  finally { finish(); await new Promise((resolve) => setTimeout(resolve, 0)); }
});
