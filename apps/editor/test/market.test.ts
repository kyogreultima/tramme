// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { download, newer, updateOf, checkRevoked } = await import('../src/market.ts');
const { installed } = await import('../src/installed.ts');

const hex = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
const plugin = (sha256: string, version = '1.2.0') => ({
  id: 'ada/glow', name: 'Glow', author: { name: 'Ada', handle: 'ada' }, versions: [version],
  version: { version, permissions: { network: [], providers: [], files: [] }, kinds: [], size: 3, sha256 },
});
const mine = (version: string, enabled = true) => ({ file: 'glow.js', manifest: { id: 'ada/glow', name: 'Glow', version } as never, size: 1, modified: '', code: '', files: new Map(), enabled });

afterEach(() => { vi.unstubAllGlobals(); installed.value = []; });

describe('the marketplace from the editor', () => {
  it('installs a package only when its bytes are the ones the catalogue lists', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal('fetch', async () => new Response(bytes));
    const file = await download(plugin(await hex(bytes)));
    expect(file.name).toBe('glow.trammeplugin');
    await expect(download(plugin('0'.repeat(64)))).rejects.toThrow();
  });

  it('offers a newer version of an installed plugin, never an older one', () => {
    expect(updateOf(mine('1.1.0'), [plugin('x')])?.version.version).toBe('1.2.0');
    expect(updateOf(mine('1.2.0'), [plugin('x')])).toBeNull();
    expect(updateOf(mine('2.0.0'), [plugin('x')])).toBeNull();
    expect(newer('1.10.0', '1.9.9')).toBe(true);
  });

  it('turns off an installed version the marketplace revoked', async () => {
    installed.value = [mine('1.0.0')];
    vi.stubGlobal('fetch', async () => Response.json([{ id: 'ada/glow', version: '1.0.0' }]));
    expect(await checkRevoked()).toEqual(['ada/glow']);
    expect(installed.value[0].enabled).toBe(false);
  });
});
