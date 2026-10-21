import { describe, expect, it } from 'vitest';
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
});
