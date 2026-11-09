import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import { FFMPEG } from '../src/media.ts';
import { annotateVideos, extractFrames, probeMedia, scanSceneMedia } from '../src/webscene-media.ts';
import { prepareWebScenes, type SceneCapturer } from '../src/webscene.ts';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-media-'));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

/** a one-second clip of 10 pictures, with or without a sound */
function clip(name: string, sound: boolean) {
  const file = path.join(work, name);
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x48:rate=10', ...(sound ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'] : []), '-shortest', '-pix_fmt', 'yuv420p', file];
  expect(spawnSync(FFMPEG, args).status).toBe(0);
  return file;
}

describe('the media of a web scene', () => {
  it('finds the local files the page names, in page order, with their start and mute', () => {
    const html = `<video src="clip.mp4" data-start="0.5"></video><audio src="/assets/music.mp3" muted></audio>
      <video src="https://example.com/x.mp4"></video><video src="../other/z.mp4"></video><video src="../../assets/a b.mp4" data-start="-1"></video><video src='sub/v.webm'></video>`;
    expect(scanSceneMedia(html, 'scenes/title')).toEqual([
      { index: 0, tag: 'video', path: 'scenes/title/clip.mp4', start: 0.5, muted: false },
      { index: 1, tag: 'audio', path: 'assets/music.mp3', start: 0, muted: true },
      { index: 4, tag: 'video', path: 'assets/a b.mp4', start: 0, muted: false },
      { index: 5, tag: 'video', path: 'scenes/title/sub/v.webm', start: 0, muted: false },
    ]);
  });

  it('marks the videos that were extracted with where their pictures are served from', () => {
    const html = '<audio src="a.mp3"></audio><video src="a.mp4" class="x"></video><VIDEO src="b.mp4"></VIDEO>';
    expect(annotateVideos(html, [{ index: 1, count: 10, fps: 30 }])).toBe('<audio src="a.mp3"></audio><video data-frames="/__media/1/" data-fps="30" data-frame-count="10" src="a.mp4" class="x"></video><VIDEO src="b.mp4"></VIDEO>');
  });

  it('reads what a file holds and extracts a video to numbered pictures', async () => {
    const withSound = clip('with.mp4', true), silent = clip('silent.mp4', false);
    expect(await probeMedia(withSound)).toMatchObject({ video: true, audio: true });
    expect((await probeMedia(withSound)).duration).toBeCloseTo(1, 1);
    expect(await probeMedia(silent)).toMatchObject({ video: true, audio: false });
    const out = path.join(work, 'frames');
    expect(await extractFrames(withSound, 10, out)).toBe(10);
    expect(fs.existsSync(path.join(out, '000000.jpg')) && fs.existsSync(path.join(out, '000009.jpg'))).toBe(true);
    await expect(extractFrames(path.join(work, 'missing.mp4'), 10, path.join(work, 'none'))).rejects.toThrow(/could not read/);
  }, 60_000);

  it('adds the sound of a scene\'s media to the film as audio layers, from where the media starts', async () => {
    const project = path.join(work, 'project');
    fs.mkdirSync(path.join(project, 'scenes', 'title'), { recursive: true });
    fs.copyFileSync(clip('s1.mp4', true), path.join(project, 'scenes', 'title', 'loud.mp4'));
    fs.copyFileSync(clip('s2.mp4', false), path.join(project, 'scenes', 'title', 'quiet.mp4'));
    fs.copyFileSync(clip('s3.mp4', true), path.join(project, 'scenes', 'title', 'muted.mp4'));
    fs.writeFileSync(path.join(project, 'scenes', 'title', 'scene.json'), JSON.stringify({ duration: 2, size: [320, 180], entry: 'index.html', parameters: {} }));
    fs.writeFileSync(path.join(project, 'scenes', 'title', 'index.html'), '<video src="loud.mp4" data-start="0.5"></video><video src="quiet.mp4"></video><video src="muted.mp4" muted></video>');
    const { doc } = newProject({ name: 'S', width: 320, height: 180, fps: 10, duration: 2 });
    doc.compositions.main.layers.scene = { type: 'webscene', name: 's', transform: { position: [160, 90] }, props: { folder: 'scenes/title', frames: [], fps: 10, size: [320, 180] } } as never;
    doc.compositions.main.order = ['scene'];
    const file = path.join(project, 'document.tramme.json');
    fs.writeFileSync(file, JSON.stringify(doc));
    const capture: SceneCapturer = vi.fn(async ({ out, frames }) => { for (let i = 0; i < frames; i++) fs.writeFileSync(path.join(out, `frame_${String(i).padStart(6, '0')}.png`), 'x'); });
    const prepared = await prepareWebScenes(file, doc, capture);
    const derived = JSON.parse(fs.readFileSync(prepared.file, 'utf8'));
    prepared.cleanup();
    const sounds = Object.values(derived.compositions.main.layers).filter((l) => (l as { type: string }).type === 'audio') as { in: number; out: number; props: { audio: string } }[];
    expect(sounds).toHaveLength(1);
    expect(sounds[0].in).toBe(0.5);
    expect(sounds[0].out).toBeCloseTo(1.5, 1);
    expect(derived.assets[sounds[0].props.audio]).toMatchObject({ type: 'video', src: 'scenes/title/loud.mp4' });
    expect(doc.compositions.main.order).toEqual(['scene']);
  }, 60_000);
});
