// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const { api } = await import('../src/api.ts');
const { S } = await import('../src/state.ts');
const { rename } = await import('../src/ui/TopBar.tsx');

describe('project rename boundary', () => {
  it('discards a rename completed after another project opens', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), title: document.title };
    let finish!: (value: any) => void;
    const update = vi.spyOn(api, 'update').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      const pending = rename('Renamed first');
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      finish({ ...first.manifest, name: 'Renamed first' });
      await pending;
      expect(update.mock.calls[0][0]).toBe(first.manifest.id);
      expect(S.project.peek()).toEqual(second.manifest);
      expect(S.doc.peek()).toEqual(second.doc);
      expect(document.title).toBe(previous.title);
    } finally {
      vi.restoreAllMocks();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      document.title = previous.title;
    }
  });
});
