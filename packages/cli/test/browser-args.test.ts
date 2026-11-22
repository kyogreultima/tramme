import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { CHROME, chromeArgs, launch, OFFLINE_ARGS } from '../src/browser.ts';

describe('Chromium launch options', () => {
  it('allows Chromium to start as root in the renderer container', () => {
    expect(chromeArgs(true)).toContain('--no-sandbox');
    expect(chromeArgs(false)).not.toContain('--no-sandbox');
  });

  it('cuts the render page off the network only when asked (the renderer of the exports in the cloud)', () => {
    expect(chromeArgs(false, true)).toEqual(expect.arrayContaining(OFFLINE_ARGS));
    expect(chromeArgs(false, false).some((a) => a.startsWith('--proxy-server'))).toBe(false);
  });

  it.skipIf(!CHROME)('offline, a page reaches the local render server and nothing else', async () => {
    const local = http.createServer((_req, res) => res.writeHead(200, { 'access-control-allow-origin': '*' }).end('local'));
    await new Promise<void>((r) => local.listen(0, '127.0.0.1', r));
    const port = (local.address() as AddressInfo).port;
    const before = process.env.TRAMME_OFFLINE;
    process.env.TRAMME_OFFLINE = '1';
    const { browser, page } = await launch();
    try {
      await page.goto(`http://127.0.0.1:${port}/`);
      const reach = (url: string) => page.evaluate((u) => fetch(u).then((r) => r.text()).catch(() => 'blocked'), url);
      expect(await reach(`http://127.0.0.1:${port}/`)).toBe('local');
      expect(await reach('https://example.com/')).toBe('blocked');
      expect(await reach('http://169.254.169.254/latest/meta-data/')).toBe('blocked');
      expect(await reach('http://metadata/')).toBe('blocked');
    } finally {
      await browser.close();
      local.close();
      if (before === undefined) delete process.env.TRAMME_OFFLINE; else process.env.TRAMME_OFFLINE = before;
    }
  }, 60_000);
});
