// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

const { api } = await import('../src/api.ts');
const { SceneCode, sceneFolder } = await import('../src/ui/SceneCode.tsx');

const host = document.createElement('div');
document.body.append(host);
afterEach(() => { render(null, host); vi.restoreAllMocks(); });
// a plain response: the test environment's own Response has no readable stream body
const fileResponse = (text: string) => {
  const chunks = [new TextEncoder().encode(text)];
  const body = { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift()! } : { done: true, value: undefined }), cancel: async () => {}, releaseLock: () => {} }) };
  return { ok: true, status: 200, headers: new Headers(), body } as unknown as Response;
};
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };

describe('the code view of a web scene', () => {
  it('names only the scene folders the project format admits', () => {
    expect(sceneFolder('scenes/title')).toBe('scenes/title');
    for (const bad of ['scenes', 'scenes/Title', 'scenes/a/b', '../scenes/a', 'assets/a', '', 3, undefined]) expect(sceneFolder(bad)).toBeNull();
  });

  it('lists the scene\'s text files and shows the entry first, read only', async () => {
    vi.spyOn(api, 'info').mockResolvedValue({ manifest: {}, files: [
      { path: 'scenes/title/scene.json', size: 1 }, { path: 'scenes/title/index.html', size: 1 }, { path: 'scenes/title/logo.png', size: 1 }, { path: 'scenes/other/index.html', size: 1 },
    ] } as never);
    const read = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => fileResponse(String(url).includes('index.html') ? '<h1>Hello</h1>' : '{}'));
    await act(async () => { render(h(SceneCode, { projectId: 'p1', folder: 'scenes/title' }), host); });
    await settle();
    expect(host.querySelector('pre')!.textContent).toBe('<h1>Hello</h1>');
    expect(host.textContent).toContain('Read only');
    expect(host.querySelector('[contenteditable], textarea')).toBeNull();
    expect(read.mock.calls.map(([u]) => String(u)).every((u) => u.includes('scenes/title/'))).toBe(true);
  });

  it('says so when the folder holds no file, or the project cannot be read', async () => {
    vi.spyOn(api, 'info').mockResolvedValue({ manifest: {}, files: [] } as never);
    await act(async () => { render(h(SceneCode, { projectId: 'p1', folder: 'scenes/none' }), host); });
    await settle();
    expect(host.textContent).toContain('No files found in scenes/none');
    vi.spyOn(api, 'info').mockRejectedValue(new Error('offline'));
    await act(async () => { render(h(SceneCode, { projectId: 'p2', folder: 'scenes/none' }), host); });
    await settle();
    expect(host.textContent).toContain('offline');
  });
});
