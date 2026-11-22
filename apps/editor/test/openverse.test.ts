import { describe, expect, it, vi } from 'vitest';
import { licenceOf, openverse } from '../src/openverse.ts';

describe('anonymous Openverse', () => {
  it.each([
    ['cc0', '1.0', 'CC0'], ['by', '4.0', 'CC BY 4.0'], ['BY', '3.0', 'CC BY 3.0'], ['pdm', '1.0', 'PDM'],
  ])('credits %s %s as %s', (license, license_version, expected) => {
    expect(licenceOf({ license, license_version })).toBe(expected);
  });

  it.each(['by-nc', 'BY-ND', 'by-sa', 'sampling+', ''])('refuses %s', (license) => {
    expect(licenceOf({ license })).toBeNull();
  });

  it('searches without a credential', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ results: [{ id: 'one' }] }));
    vi.stubGlobal('fetch', fetcher);
    try {
      expect(await openverse('audio', { q: 'whoosh' }, new AbortController().signal)).toEqual([{ id: 'one' }]);
      expect(String(fetcher.mock.calls[0][0])).toContain('/v1/audio/?q=whoosh');
      expect(fetcher.mock.calls[0][1]).toEqual({ signal: expect.any(AbortSignal) });
    } finally { vi.unstubAllGlobals(); }
  });
});
