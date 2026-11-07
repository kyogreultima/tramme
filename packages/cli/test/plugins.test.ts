import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validate, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { CHROME, launch } from '../src/browser.ts';
import { compareFiles } from '../src/compare.ts';
import { docRegistry, filesRegistry } from '../src/plugins.ts';
import { readConfig, Server } from '../src/server.ts';

/** a project folder as the files of an archive */
function read(dir: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p); else files.set(p, new Uint8Array(fs.readFileSync(path.join(dir, p))));
    }
  };
  walk('');
  return files;
}

// a project with its own plugin (a node, a tool, a workflow)
const NIGHT_SKY = path.resolve(import.meta.dirname, 'fixtures/night-sky');

describe('a project in memory (pack, unpack)', () => {
  it.skipIf(!CHROME)('is checked with its own plugins, not the built-in vocabulary alone', async () => {
    const files = read(NIGHT_SKY);
    const doc = JSON.parse(new TextDecoder().decode(files.get('document.tramme.json'))) as TrammeDoc;
    expect(validate(doc, builtinRegistry()).some((i) => /unknown node type/.test(i.message))).toBe(true);
    expect(validate(doc, await filesRegistry(doc, files))).toEqual([]);
  }, 30_000);

  it.skipIf(!CHROME)('names a plugin that is missing or does not load', async () => {
    const files = read(NIGHT_SKY);
    const doc = JSON.parse(new TextDecoder().decode(files.get('document.tramme.json'))) as TrammeDoc;
    const id = doc.plugins![0], file = doc.assets[id].src;
    const missing = new Map(files); missing.delete(file);
    await expect(filesRegistry(doc, missing)).rejects.toThrow(`plugin "${id}" not found`);
    const broken = new Map(files); broken.set(file, new TextEncoder().encode('export const nodes = [ {'));
    await expect(filesRegistry(doc, broken)).rejects.toThrow(`plugin "${id}" unreadable`);
  }, 30_000);

  it.skipIf(!CHROME)('loads declarations without running archive code in Node', async () => {
    const files = read(NIGHT_SKY);
    const doc = JSON.parse(new TextDecoder().decode(files.get('document.tramme.json'))) as TrammeDoc;
    const file = doc.assets[doc.plugins![0]].src;
    const source = new TextDecoder().decode(files.get(file));
    files.set(file, new TextEncoder().encode("if (typeof process !== 'undefined') throw new Error('native Node access');\n" + source));
    expect(validate(doc, await filesRegistry(doc, files))).toEqual([]);
  }, 30_000);

  it.skipIf(!CHROME)('stops an archive plugin that loops at module load', async () => {
    const files = read(NIGHT_SKY);
    const doc = JSON.parse(new TextDecoder().decode(files.get('document.tramme.json'))) as TrammeDoc;
    files.set(doc.assets[doc.plugins![0]].src, new TextEncoder().encode('while (true) {}'));
    await expect(filesRegistry(doc, files)).rejects.toThrow('plugin declaration timed out');
  }, 30_000);

  it.skipIf(!CHROME)('loads a folder plugin without giving it the Node process', async () => {
    const files = read(NIGHT_SKY);
    const doc = JSON.parse(new TextDecoder().decode(files.get('document.tramme.json'))) as TrammeDoc;
    const file = doc.assets[doc.plugins![0]].src;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-isolated-registry-'));
    try {
      fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), "if (typeof process !== 'undefined') throw new Error('native Node access');\n" + new TextDecoder().decode(files.get(file)));
      expect(validate(doc, await docRegistry(doc, dir))).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);

  it('rejects a folder plugin path outside its project before reading it', async () => {
    const files = read(NIGHT_SKY);
    const doc = JSON.parse(new TextDecoder().decode(files.get('document.tramme.json'))) as TrammeDoc;
    const id = doc.plugins![0];
    doc.assets[id].src = '..\\secret.js';
    await expect(docRegistry(doc, NIGHT_SKY)).rejects.toThrow('invalid path');
  });

  it('rejects a plugin reached through a link outside the project', async () => {
    const files = read(NIGHT_SKY);
    const doc = JSON.parse(new TextDecoder().decode(files.get('document.tramme.json'))) as TrammeDoc;
    const id = doc.plugins![0];
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-plugin-link-'));
    try {
      const project = path.join(temp, 'project'), privateDir = path.join(temp, 'private');
      fs.mkdirSync(path.join(project, 'plugins'), { recursive: true });
      fs.mkdirSync(privateDir);
      fs.writeFileSync(path.join(privateDir, 'secret.js'), 'export const nodes = []');
      fs.symlinkSync(privateDir, path.join(project, 'plugins', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      doc.assets[id].src = 'plugins/linked/secret.js';
      await expect(docRegistry(doc, project)).rejects.toThrow(`plugin "${id}" leaves its project`);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
});

// The CLI draws a project with plugins in the sandbox's worker: its plugins
// must be loaded there, and the frame it hands back (an ImageBitmap) must land
// the right way up. The page, sandbox off, is the reference.
describe.skipIf(!CHROME)('a project with a plugin, rendered by the CLI', () => {
  let dir = '', server: Server, close: () => Promise<void>, page: import('puppeteer-core').Page, port = 0;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-plugin-still-'));
    server = new Server(readConfig(path.join(NIGHT_SKY, 'document.tramme.json')));
    port = await server.start();
    const b = await launch();
    page = b.page;
    close = async () => { await b.browser.close(); server.close(); };
  }, 120_000);
  afterAll(async () => { await close?.(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); }, 60_000);

  const still = async (sandbox: boolean) => {
    const q = new URLSearchParams({ doc: '/project/document.tramme.json', ...(sandbox ? {} : { sandbox: '0' }) });
    await page.goto(`http://127.0.0.1:${port}/__tramme/?${q}`);
    await page.evaluate(() => (window as any).TRAMME.ready);
    const url: string = await page.evaluate(() => (window as any).TRAMME.still(1, {}));
    const file = path.join(dir, `${sandbox ? 'sandbox' : 'page'}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    return file;
  };

  it('draws its plugin nodes in the sandbox as the page draws them, the right way up', async () => {
    const d = compareFiles(await still(false), await still(true));
    // the moon's antialiasing differs by a few pixels; a frame upside down differs nearly everywhere
    expect(d.over).toBeLessThan(0.005);
  }, 120_000);
});
