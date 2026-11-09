// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { newProject } from '@tramme/project';

const { MediaBar, naming } = await import('../src/ui/MediaBar.tsx');
const { S } = await import('../src/state.ts');

describe('media naming project boundary', () => {
  it('does not tag an asset in a new project through an old naming field', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    for (const p of [first, second]) p.doc.assets.clip = { type: 'image', src: 'assets/clip.png' };
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), naming: naming.peek() };
    const mount = document.body.appendChild(document.createElement('div'));
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      naming.value = { kind: 'tag', ids: ['clip'], project: { id: first.manifest.id, docUrl: S.docUrl.peek() } };
      await act(() => { render(h(MediaBar, { doc: first.doc, filter: {}, onChange: () => {} }), mount); });
      const field = [...mount.querySelectorAll('input')].at(-1) as HTMLInputElement;
      field.value = 'old tag';
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      await act(() => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
      expect(naming.peek()).toBeNull();
      expect(S.doc.peek()).toBe(second.doc);
      expect(S.doc.peek().assets.clip.tags).toBeUndefined();
      await act(() => { render(h(MediaBar, { doc: second.doc, filter: {}, onChange: () => {} }), mount); });
      expect(mount.querySelectorAll('input')).toHaveLength(1);
    } finally {
      await act(() => { render(null, mount); });
      mount.remove();
      naming.value = previous.naming;
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });
});
