// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const { api } = await import('../src/api.ts');
const { takenPaths, upload } = await import('../src/files.ts');
const { S } = await import('../src/state.ts');

describe('project file operations', () => {
  it('refuses a file list that returns after the project changes', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek() };
    let finish!: (value: any) => void;
    const info = vi.spyOn(api, 'info').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      const pending = takenPaths();
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      finish({ files: [] });
      await expect(pending).rejects.toThrow('The project changed during the file operation.');
      expect(info).toHaveBeenCalledWith(first.manifest.id);
    } finally {
      info.mockRestore();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
    }
  });

  it('refuses an upload after its file list belongs to a previous project', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek() };
    const info = vi.spyOn(api, 'info').mockResolvedValue({ files: [] } as never);
    const write = vi.spyOn(api, 'writeAny').mockResolvedValue({} as never);
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      const paths = await takenPaths();
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      await expect(upload(paths, 'assets/note.json', new Blob(['x']))).rejects.toThrow('The project changed during the file operation.');
      expect(info).toHaveBeenCalledWith(first.manifest.id);
      expect(write).not.toHaveBeenCalled();
    } finally {
      info.mockRestore(); write.mockRestore();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
    }
  });

  it('refuses to return an upload that finishes after a project switch', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek() };
    vi.spyOn(api, 'info').mockResolvedValue({ files: [] } as never);
    let finish!: (value: any) => void;
    const write = vi.spyOn(api, 'writeAny').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      const paths = await takenPaths();
      const pending = upload(paths, 'assets/note.json', new Blob(['x']));
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      finish({});
      await expect(pending).rejects.toThrow('The project changed during the file operation.');
      expect(write.mock.calls[0][0]).toBe(first.manifest.id);
      expect(paths.size).toBe(0);
    } finally {
      vi.restoreAllMocks();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
    }
  });
});
