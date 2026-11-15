// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const { api, ApiError } = await import('../src/api.ts');
const { keepThisVersion, load, resumeSaving, S, saveHeld, saveNow } = await import('../src/state.ts');

const answer = { path: 'document.tramme.json', size: 1, etag: '"e2"', modified: '2026-11-15T00:00:00Z' };

function open() {
  const p = newProject({ name: 'P', width: 64, height: 64, fps: 30, duration: 1 });
  load(p.doc, p.manifest, '/api/projects/p/files/document.tramme.json', '"e1"');
  S.save.value = 'dirty';
}

afterEach(() => { vi.restoreAllMocks(); saveHeld.value = null; });

describe('saves that cannot go through', () => {
  it('hold on a version written elsewhere, and "keep this one" writes over it without a condition', async () => {
    open();
    const write = vi.spyOn(api, 'write').mockRejectedValueOnce(new ApiError(412, 'precondition failed')).mockResolvedValue(answer);
    await expect(saveNow()).rejects.toThrow();
    expect(saveHeld.value).toBe('conflict');
    expect(write.mock.calls[0][3]?.ifMatch).toBe('"e1"');
    await keepThisVersion();
    expect(saveHeld.value).toBeNull();
    expect(S.save.value).toBe('saved');
    expect(write.mock.calls[1][3]?.ifMatch).toBeUndefined();
  });

  it('hold when the session ended, keep the document, and go through once signed in again', async () => {
    open();
    const doc = S.doc.peek();
    const write = vi.spyOn(api, 'write').mockRejectedValueOnce(new ApiError(401, 'signed_out')).mockResolvedValue(answer);
    await expect(saveNow()).rejects.toThrow();
    expect(saveHeld.value).toBe('signedOut');
    expect(S.doc.peek()).toBe(doc);
    await resumeSaving();
    expect(S.save.value).toBe('saved');
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][3]?.ifMatch).toBe('"e1"');
  });
});
