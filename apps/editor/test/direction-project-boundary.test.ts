// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { newProject } from '@tramme/project';

const { api } = await import('../src/api.ts');
const { Direction } = await import('../src/ui/Direction.tsx');
const { S } = await import('../src/state.ts');

describe('direction panel project boundary', () => {
  it('does not render a target image outside the project assets', async () => {
    const project = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    const mount = document.body.appendChild(document.createElement('div'));
    const read = vi.spyOn(api, 'readText').mockImplementation(async (_id, path) => path === 'assets/film-plan.json'
      ? { text: JSON.stringify({ version: 1, kind: 'film-plan', idea: 'x', target: 'assets/../private.png', scenes: [], kinds: [], directions: [] }) } as never
      : null);
    const info = vi.spyOn(api, 'info').mockResolvedValue({ files: [] } as never);
    try {
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = project.doc;
      await act(() => { render(h(Direction, {}), mount); });
      await act(async () => { await Promise.resolve(); });
      expect(mount.querySelector('.dir-target')).toBeNull();
    } finally {
      await act(() => { render(null, mount); });
      mount.remove();
      read.mockRestore();
      info.mockRestore();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });

  it('does not add an old brief asset after its write completes in another project', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    const mount = document.body.appendChild(document.createElement('div'));
    const read = vi.spyOn(api, 'readText').mockResolvedValue(null);
    const info = vi.spyOn(api, 'info').mockResolvedValue({ files: [] } as never);
    let finishWrite!: (value: never) => void;
    const write = vi.spyOn(api, 'write').mockImplementation(() => new Promise((resolve) => { finishWrite = resolve; }));
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      await act(() => { render(h(Direction, {}), mount); });
      const field = mount.querySelector('textarea') as HTMLTextAreaElement;
      field.value = 'First project brief';
      await act(() => { field.dispatchEvent(new Event('focusout', { bubbles: true })); });
      await vi.waitFor(() => expect(write).toHaveBeenCalled());
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      await act(() => { render(h(Direction, {}), mount); });
      finishWrite({} as never);
      await act(async () => { await Promise.resolve(); });
      expect(S.doc.peek()).toBe(second.doc);
      expect(S.doc.peek().assets.brief).toBeUndefined();
    } finally {
      await act(() => { render(null, mount); });
      mount.remove();
      read.mockRestore();
      info.mockRestore();
      write.mockRestore();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });

  it('does not show a delayed plan from the former project', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    const mount = document.body.appendChild(document.createElement('div'));
    let finishOld!: (value: { text: string }) => void;
    const read = vi.spyOn(api, 'readText').mockImplementation((id, path) => {
      if (id === first.manifest.id && path === 'assets/film-plan.json') return new Promise((resolve) => { finishOld = resolve as typeof finishOld; });
      return Promise.resolve(null);
    });
    const info = vi.spyOn(api, 'info').mockResolvedValue({ files: [] } as never);
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      await act(() => { render(h(Direction, {}), mount); });
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      await act(() => { render(h(Direction, {}), mount); });
      finishOld({ text: JSON.stringify({ version: 1, kind: 'film-plan', idea: 'Private old plan', scenes: [], kinds: [], directions: [] }) });
      await act(async () => { await Promise.resolve(); });
      expect(mount.textContent).not.toContain('Private old plan');
    } finally {
      await act(() => { render(null, mount); });
      mount.remove();
      read.mockRestore();
      info.mockRestore();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });
});
