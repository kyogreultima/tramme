// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';

const { exportProject, requireExportProject, waitExportProject } = await import('../src/export-project.ts');
const { S } = await import('../src/state.ts');

describe('browser export project boundary', () => {
  it('rejects a finished export after another project opens', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek() };
    let finish!: (value: Blob) => void;
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      const project = exportProject();
      const pending = waitExportProject(project, new Promise<Blob>((resolve) => { finish = resolve; }));
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      finish(new Blob(['old film']));
      await expect(pending).rejects.toThrow('The project changed during export.');
      expect(() => requireExportProject(project)).toThrow('The project changed during export.');
    } finally {
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
    }
  });

  it('accepts a result only while the same project URL remains open', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek() };
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      const project = exportProject();
      await expect(waitExportProject(project, Promise.resolve('ok'))).resolves.toBe('ok');
      S.docUrl.value = 'https://tramme.test/projects/first-copy/document.tramme.json';
      expect(() => requireExportProject(project)).toThrow('The project changed during export.');
    } finally {
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
    }
  });
});
