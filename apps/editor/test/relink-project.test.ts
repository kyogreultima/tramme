// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const { api } = await import('../src/api.ts');
const { preview } = await import('../src/preview.ts');
const { S } = await import('../src/state.ts');
const { relinkFiles } = await import('../src/relink-run.ts');

describe('media relink project boundary', () => {
  it('does not reload another project after a delayed media write', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    first.doc.assets.missing = { type: 'image', src: 'assets/photo.png' };
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), offline: S.offline.peek() };
    let finish!: (value: any) => void;
    const write = vi.spyOn(api, 'writeAny').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const reload = vi.spyOn(preview, 'reload').mockResolvedValue(undefined);
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      S.offline.value = ['missing'];
      const pending = relinkFiles([new File(['photo'], 'photo.png', { type: 'image/png' })]);
      for (let i = 0; !finish && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      expect(finish).toBeTypeOf('function');
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      finish({});
      await expect(pending).rejects.toThrow();
      expect(write.mock.calls[0][0]).toBe(first.manifest.id);
      expect(write.mock.calls[0][1]).toBe('assets/photo.png');
      expect(reload).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      S.offline.value = previous.offline;
    }
  });
});
