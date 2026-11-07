// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const { api } = await import('../src/api.ts');
const { fileProject } = await import('../src/files.ts');
const { S } = await import('../src/state.ts');
const { listVersions } = await import('../src/ui/TopBar.tsx');

describe('version list project boundary', () => {
  it('rejects a version index returned after another project opens', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    let finish!: (value: any) => void;
    const read = vi.spyOn(api, 'readText').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      const pending = listVersions(fileProject());
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      finish({ text: JSON.stringify({ versions: [{ file: 'versions/old.json', label: 'Old', at: '2026-11-07' }] }) });
      await expect(pending).rejects.toThrow();
      expect(read.mock.calls[0][0]).toBe(first.manifest.id);
    } finally {
      vi.restoreAllMocks();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });
});
