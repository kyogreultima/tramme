// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const { api } = await import('../src/api.ts');
const { attachFiles, pending } = await import('../src/attachments.ts');
const { S } = await import('../src/state.ts');

describe('attachment project boundary', () => {
  it('clears unsent attachments when another project opens', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), pending: pending.peek() };
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      pending.value = [{ path: 'assets/chat/secret.json', name: 'secret.json', kind: 'file', size: 1 }];
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      await Promise.resolve();
      expect(pending.peek()).toEqual([]);
    } finally {
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      pending.value = previous.pending;
    }
  });

  it('does not attach an upload that completes after a project switch', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), pending: pending.peek() };
    vi.spyOn(api, 'info').mockResolvedValue({ files: [] } as never);
    let finish!: (value: any) => void;
    vi.spyOn(api, 'writeAny').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    try {
      pending.value = [];
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      const attaching = attachFiles([new File(['{}'], 'note.json', { type: 'application/json' })]);
      for (let i = 0; !finish && i < 20; i++) await Promise.resolve();
      expect(finish).toBeTypeOf('function');
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      finish({});
      await attaching;
      expect(pending.peek()).toEqual([]);
      expect(Object.keys(second.doc.assets)).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      pending.value = previous.pending;
    }
  });
});
