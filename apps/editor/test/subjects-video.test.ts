import { afterEach, expect, it, vi } from 'vitest';
import { CanvasSink, Input, InputVideoTrack } from 'mediabunny';
import { newProject } from '@tramme/project';
import type { ToolContext, ToolOutput } from '@tramme/core';
import { PERCEPTION_TOOLS } from '../src/perception.ts';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('can construct the real video sink for person detection', async () => {
  const { doc } = newProject({ name: 'People', width: 1920, height: 1080, fps: 24, duration: 2 });
  doc.assets.clip = { type: 'video', src: 'assets/clip.mp4' };
  // Replace the file and decoding boundary, retaining CanvasSink's real
  // constructor validation (the missing fit option broke every video).
  const track = Object.create(InputVideoTrack.prototype);
  Object.defineProperties(track, { displayWidth: { value: 1920 }, displayHeight: { value: 1080 } });
  vi.spyOn(Input.prototype, 'getPrimaryVideoTrack').mockResolvedValue(track);
  vi.spyOn(Input.prototype, 'computeDuration').mockResolvedValue(2);
  vi.spyOn(CanvasSink.prototype, 'canvasesAtTimestamps').mockImplementation(async function* () { yield null; });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({}) }) });
  const written = new Map<string, string>();
  const ctx = {
    doc, compId: doc.root, selection: [], signal: new AbortController().signal,
    assetUrl: () => 'https://tramme.test/clip.mp4',
    writeFile: async (path: string, data: string) => { written.set(path, data); return path; },
  } as unknown as ToolContext;
  const result = await PERCEPTION_TOOLS.find((tool) => tool.name === 'subjects')!.run({ asset: 'clip' }, ctx) as ToolOutput;
  expect(result.ops).toMatchObject([{ path: '/assets/subjects-clip' }]);
  expect(JSON.parse(written.get('assets/analysis/clip-subjects.json')!)).toMatchObject({ kind: 'subjects', source: 'clip', width: 1920, height: 1080 });
});
