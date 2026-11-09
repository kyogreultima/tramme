// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const { api } = await import('../src/api.ts');
const { S } = await import('../src/state.ts');
const { recording, toggleVoiceover } = await import('../src/voiceover-run.ts');

describe('voiceover project boundary', () => {
  it('releases a microphone granted after another project opens', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    let grant!: (stream: MediaStream) => void;
    const stop = vi.fn();
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: () => new Promise<MediaStream>((resolve) => { grant = resolve; }) },
    });
    const write = vi.spyOn(api, 'writeAny');
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      const pending = toggleVoiceover();
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
      await pending;
      expect(stop).toHaveBeenCalledOnce();
      expect(write).not.toHaveBeenCalled();
      expect(recording.peek()).toBeNull();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });
});
