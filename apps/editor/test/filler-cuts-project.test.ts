// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { newProject } from '@tramme/project';

const { api } = await import('../src/api.ts');
const { S } = await import('../src/state.ts');
const { fillerCuts, FillerCutsPanel } = await import('../src/ui/FillerCuts.tsx');

describe('filler cuts project boundary', () => {
  it('refuses a filler list outside project assets before a read', async () => {
    const project = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    project.doc.assets.cuts = { type: 'json', src: 'assets/../private.json' };
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), cuts: fillerCuts.peek() };
    const host = document.body.appendChild(document.createElement('div'));
    const read = vi.spyOn(api, 'readText');
    try {
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = project.doc;
      fillerCuts.value = 'cuts';
      await act(() => { render(h(FillerCutsPanel, {}), host); });
      expect(read).not.toHaveBeenCalled();
    } finally {
      render(null, host);
      host.remove();
      read.mockRestore();
      fillerCuts.value = previous.cuts;
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });

  it('does not show a delayed old-project list after navigation', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    for (const project of [first, second]) project.doc.assets.cuts = { type: 'json', src: 'assets/fillers/cuts.json' };
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), cuts: fillerCuts.peek() };
    const host = document.body.appendChild(document.createElement('div'));
    let finishOld!: (value: any) => void;
    vi.spyOn(api, 'readText').mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; })).mockImplementation(() => new Promise(() => {}));
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      fillerCuts.value = 'cuts';
      await act(() => { render(h(FillerCutsPanel, {}), host); });
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      await act(() => {});
      await act(async () => { finishOld({ text: JSON.stringify({ kind: 'fillers', asset: 'voice', cuts: [{ n: 1, from: 0, to: 1, word: 'old word' }] }) }); });
      expect(host.textContent).not.toContain('old word');
    } finally {
      render(null, host);
      host.remove();
      vi.restoreAllMocks();
      fillerCuts.value = previous.cuts;
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });
});
