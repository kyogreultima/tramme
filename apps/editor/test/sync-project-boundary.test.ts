// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import * as perception from '../src/perception.ts';

const { syncClips } = await import('../src/sync.ts');
const { S } = await import('../src/state.ts');

describe('timeline sync project boundary', () => {
  it('does not decode sound from a media URL outside the project', async () => {
    const project = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 2 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), compId: S.compId.peek() };
    const decode = vi.spyOn(perception, 'decodeMono');
    const c = project.doc.compositions[project.doc.root];
    project.doc.assets.clip = { type: 'video', src: 'https://tramme.test/api/private' };
    c.layers.a = { type: 'video', in: 0, out: 2, props: { video: 'clip' } };
    c.layers.b = { type: 'video', in: 0, out: 2, props: { video: 'clip' } };
    c.order = ['a', 'b'];
    try {
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = project.doc;
      S.compId.value = project.doc.root;
      expect(await syncClips(['a', 'b'])).toBe(false);
      expect(decode).not.toHaveBeenCalled();
    } finally {
      decode.mockRestore();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      S.compId.value = previous.compId;
    }
  });
});
