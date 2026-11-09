// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { newProject } from '@tramme/project';

const { SourceMonitor } = await import('../src/ui/Source.tsx');
const { sourceOpen } = await import('../src/ui/timeline/assets-drag.ts');
const { S } = await import('../src/state.ts');

describe('source monitor project boundary', () => {
  it('shows an error instead of loading a media URL outside the project', async () => {
    const project = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), source: sourceOpen.peek() };
    const mount = document.body.appendChild(document.createElement('div'));
    try {
      project.doc.assets.clip = { type: 'video', src: 'https://tramme.test/api/private' };
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = project.doc;
      sourceOpen.value = 'clip';
      await act(() => { render(h(SourceMonitor, {}), mount); });
      expect(mount.querySelector('video, audio')).toBeNull();
      expect(mount.querySelector('[role="alert"]')?.textContent).toContain('project asset');
    } finally {
      await act(() => { render(null, mount); });
      mount.remove();
      sourceOpen.value = previous.source;
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });
});
