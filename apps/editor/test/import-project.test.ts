// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { newProject } from '@tramme/project';

vi.stubGlobal('crypto', webcrypto);
const { api } = await import('../src/api.ts');
const { importFiles } = await import('../src/ui/LeftPanel.tsx');
const { S } = await import('../src/state.ts');

describe('project import boundary', () => {
  it('does not add an imported asset to a project opened during upload', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    vi.spyOn(api, 'info').mockResolvedValue({ files: [] } as never);
    let finish!: (value: any) => void;
    const write = vi.spyOn(api, 'writeAny').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      const importing = importFiles([new File(['image bytes'], 'photo.png', { type: 'image/png' })]);
      for (let i = 0; !finish && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      expect(finish).toBeTypeOf('function');
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      finish({});
      await importing;
      expect(write.mock.calls[0][0]).toBe(first.manifest.id);
      expect(Object.keys(S.doc.peek().assets)).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });
});
