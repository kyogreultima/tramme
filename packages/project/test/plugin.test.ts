import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { asksMore, compareVersions, manifestOf, metaOfText, packInstalled, permissionsAdded, readPluginPackage, unpackInstalled, writePluginPackage } from '../src/index.ts';

const charts = `// a chart pack
export const meta = {
  id: 'ada/charts', name: 'Charts', version: '1.2.0', api: 1, licence: 'MIT', author: "Ada", // who
  description: 'Bars, lines and pies',
  permissions: { network: ['https://data.example.com'], providers: [] },
};
export const nodes = [];
export const tools = [];
`;

describe('an installed plugin, read without running it', () => {
  it('has its manifest from the meta literal and what it brings from its exports', () => {
    const m = manifestOf(charts, 'charts.js');
    expect(m).toEqual({ id: 'ada/charts', name: 'Charts', version: '1.2.0', api: 1, licence: 'MIT', author: 'Ada', description: 'Bars, lines and pies', permissions: { network: ['https://data.example.com'], providers: [], files: [] }, kinds: ['nodes', 'tools'] });
  });

  it('keeps today\'s plugins valid: an id from the name, version 0.0.0, no permission', () => {
    expect(manifestOf('export const nodes = [];', 'My Stars.js')).toMatchObject({ id: 'local/my-stars', name: 'My Stars', version: '0.0.0', api: 1, permissions: { network: [], providers: [], files: [] } });
    // a meta that is not plain data is left to the sandbox: nothing runs here
    expect(metaOfText('export const meta = { name: "x" + y };')).toEqual({});
    expect(metaOfText('export const meta = { name: `a${b}` };')).toEqual({});
  });

  it('says what an update asks more', () => {
    const a = manifestOf(charts, 'charts.js').permissions;
    const b = { ...a, network: [...a.network, 'https://cdn.example.com'], files: ['renders/'] };
    expect(permissionsAdded(a, b)).toEqual({ network: ['https://cdn.example.com'], providers: [], files: ['renders/'] });
    expect(asksMore(permissionsAdded(a, a))).toBe(false);
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
  });
});

describe('the package and the backup', () => {
  it('carries the module and its own files, refusing unsafe paths', () => {
    const files = new Map([['fonts/brand.woff2', new Uint8Array([1, 2, 3])], ['messages/fr.json', new TextEncoder().encode('{}')]]);
    const back = readPluginPackage(writePluginPackage({ module: charts, files }));
    expect(back.module).toBe(charts);
    expect([...back.files.keys()].sort()).toEqual(['fonts/brand.woff2', 'messages/fr.json']);
    expect(() => readPluginPackage(new Uint8Array([1, 2, 3]))).toThrow(/not a .trammeplugin/);
  });

  it('keeps every installed plugin and which are off in one file', () => {
    const zip = packInstalled(new Map([['charts.js', new TextEncoder().encode(charts)], ['stars.js', new Uint8Array([1])]]), { version: 1, disabled: ['stars.js'] });
    const { files, state } = unpackInstalled(zip);
    expect([...files.keys()].sort()).toEqual(['charts.js', 'stars.js']);
    expect(state.disabled).toEqual(['stars.js']);
  });

  it('refuses a backup that advertises an oversized expanded entry before inflating it', () => {
    const zip = packInstalled(new Map([['stars.js', new Uint8Array([1])]]), { version: 1, disabled: [] });
    const edited = zip.slice();
    const view = new DataView(edited.buffer);
    let changed = false;
    for (let i = 0; i < edited.length - 46; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      view.setUint32(i + 24, 129 * 1024 * 1024, true);
      changed = true;
      break;
    }
    expect(changed).toBe(true);
    expect(() => unpackInstalled(edited)).toThrow(/entry too large/);
  });

  it('bounds package module size and archive entry counts before inflation', () => {
    const large = zipSync({ 'plugin.js': new TextEncoder().encode('x'.repeat(1024 * 1024 + 1)) });
    expect(() => readPluginPackage(large)).toThrow('plugin module too large');
    const entries = new Map(Array.from({ length: 2000 }, (_, i) => [`data/${i}.txt`, new Uint8Array([i % 256])] as const));
    const rawPackage = Object.fromEntries(entries);
    rawPackage['plugin.js'] = new TextEncoder().encode(charts);
    expect(() => readPluginPackage(zipSync(rawPackage))).toThrow('plugin package has too many entries');
    expect(() => writePluginPackage({ module: charts, files: entries })).toThrow('plugin package has too many entries');
    const backupEntries = new Map(Array.from({ length: 2000 }, (_, i) => [`plugin${i}.js`, new Uint8Array([i % 256])] as const));
    const rawBackup = Object.fromEntries([...backupEntries].map(([name, bytes]) => [`plugins/${name}`, bytes]));
    rawBackup['installed.json'] = new TextEncoder().encode('{"version":1,"disabled":[]}');
    expect(() => unpackInstalled(zipSync(rawBackup))).toThrow('plugin backup has too many entries');
    expect(() => packInstalled(backupEntries, { version: 1, disabled: [] })).toThrow('plugin backup has too many entries');
  });

  it('refuses oversized backup input before compressing it', () => {
    const large = new Uint8Array(65 * 1024 * 1024);
    expect(() => packInstalled(new Map([['a.js', large], ['b.js', large]]), { version: 1, disabled: [] })).toThrow('plugin backup expanded data too large');
  });

  it('refuses unsafe installed-plugin names before backup compression', () => {
    for (const name of ['../private.js', 'folder/plugin.js', 'plugin%2ejs', 'plugin#one.js'])
      expect(() => packInstalled(new Map([[name, new Uint8Array([1])]]), { version: 1, disabled: [] })).toThrow('invalid plugin backup name');
  });

  it('refuses oversized or unsafe package input before compression', () => {
    expect(() => writePluginPackage({ module: 'x'.repeat(1024 * 1024 + 1), files: new Map() })).toThrow('plugin module too large');
    expect(() => writePluginPackage({ module: charts, files: new Map([['../private', new Uint8Array([1])]]) })).toThrow('unsafe path');
    for (const path of ['%2e%2e/private', 'data/./file', 'data#fragment', 'data?query']) {
      expect(() => writePluginPackage({ module: charts, files: new Map([[path, new Uint8Array([1])]]) })).toThrow('unsafe path');
      expect(() => readPluginPackage(zipSync({ 'plugin.js': new TextEncoder().encode(charts), [path]: new Uint8Array([1]) }))).toThrow('unsafe path');
    }
    const large = new Uint8Array(65 * 1024 * 1024);
    expect(() => writePluginPackage({ module: charts, files: new Map([['a.bin', large], ['b.bin', large]]) })).toThrow('plugin package expanded data too large');
  });
});
