// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { newProject } from '@tramme/project';
import type { TrammeDoc } from '@tramme/core';

const { api } = await import('../src/api.ts');
const { useSpoken } = await import('../src/ui/MediaBar.tsx');
const { S } = await import('../src/state.ts');

function Probe({ doc }: { doc: TrammeDoc }) {
  const spoken = useSpoken(doc, true);
  return h('span', {}, spoken('clip') ?? 'empty');
}

describe('media search project boundary', () => {
  it('does not show another project transcript at the same file path', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    for (const p of [first, second]) {
      p.doc.assets.clip = { type: 'audio', src: 'assets/clip.wav' };
      p.doc.assets['transcription-clip'] = { type: 'json', src: 'assets/transcripts/clip.json' };
    }
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    const mount = document.body.appendChild(document.createElement('div'));
    let finishFirst!: (value: { text: string }) => void, finishSecond!: (value: { text: string }) => void;
    const read = vi.spyOn(api, 'readText').mockImplementation((id) => new Promise((resolve) => {
      if (id === first.manifest.id) finishFirst = resolve as typeof finishFirst;
      else finishSecond = resolve as typeof finishSecond;
    }));
    const transcript = (word: string) => ({ text: JSON.stringify({ version: 1, duration: 1, words: [{ w: word, s: 0, e: 1 }] }) });
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      await act(() => { render(h(Probe, { doc: first.doc }), mount); });
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      await act(() => { render(h(Probe, { doc: second.doc }), mount); });
      expect(mount.textContent).toBe('empty');
      finishFirst(transcript('secret'));
      await act(async () => { await Promise.resolve(); });
      expect(mount.textContent).toBe('empty');
      finishSecond(transcript('second'));
      await act(async () => { await Promise.resolve(); });
      expect(mount.textContent).toBe('second');
      expect(read.mock.calls.map(([id]) => id)).toEqual([first.manifest.id, second.manifest.id]);
    } finally {
      await act(() => { render(null, mount); });
      mount.remove();
      read.mockRestore();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });
});
