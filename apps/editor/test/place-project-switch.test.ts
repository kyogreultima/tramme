// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import * as perception from '../src/perception.ts';

const { newSequenceFromAsset } = await import('../src/ui/timeline/place.ts');
const { S } = await import('../src/state.ts');

describe('media placement project switch', () => {
  it('does not create a sequence after the project changes during a sound probe', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    first.doc.assets.clip = { type: 'video', src: 'assets/clip.mp4' };
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), compId: S.compId.peek() };
    let finish!: (value: boolean) => void;
    const duration = vi.spyOn(perception, 'mediaDuration').mockResolvedValue(1);
    const sound = vi.spyOn(perception, 'hasSound').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      S.compId.value = first.doc.root;
      const pending = newSequenceFromAsset('clip');
      await vi.waitFor(() => expect(sound).toHaveBeenCalled());
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      S.compId.value = second.doc.root;
      finish(true);
      expect(await pending).toBe(false);
      expect(S.doc.peek()).toBe(second.doc);
    } finally {
      duration.mockRestore();
      sound.mockRestore();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      S.compId.value = previous.compId;
    }
  });
});
