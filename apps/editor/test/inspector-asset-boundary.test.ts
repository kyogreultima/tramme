// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { newProject } from '@tramme/project';

const { Inspector } = await import('../src/ui/Inspector.tsx');
const { S } = await import('../src/state.ts');

describe('inspector asset previews', () => {
  it('does not give private asset URLs to image elements', async () => {
    const project = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const c = project.doc.compositions[project.doc.root];
    project.doc.assets.private = { type: 'image', src: 'https://tramme.test/api/private' };
    c.layers.sequence = { type: 'sequence', props: { frames: ['private'] } };
    c.order = ['sequence'];
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), compId: S.compId.peek(), selection: S.selection.peek() };
    const mount = document.body.appendChild(document.createElement('div'));
    try {
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = project.doc;
      S.compId.value = project.doc.root;
      S.selection.value = ['sequence'];
      await act(() => { render(h(Inspector, {}), mount); });
      const images = [...mount.querySelectorAll('.assets-strip img')];
      expect(images).toHaveLength(1);
      expect(images[0].getAttribute('src')).toBe('');
    } finally {
      await act(() => { render(null, mount); });
      mount.remove();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      S.compId.value = previous.compId;
      S.selection.value = previous.selection;
    }
  });
});
