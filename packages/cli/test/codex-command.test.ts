import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { codexOnPath } from '../src/codex-command.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function install(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-codex-command-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

describe('Codex installed through npm on Windows', () => {
  it.each(['bin', 'codex'])('bypasses the console-opening npm wrapper (%s layout)', (folder) => {
    const root = install({
      'codex.cmd': '@node "%dp0%/node_modules/@openai/codex/bin/codex.js" %*',
      'node_modules/@openai/codex/package.json': '{"name":"@openai/codex"}',
      'node_modules/@openai/codex-win32-x64/package.json': '{"name":"@openai/codex-win32-x64"}',
      [`node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/${folder}/codex.exe`]: '',
    });
    expect(codexOnPath({ platform: 'win32', arch: 'x64', env: { PATH: root, PATHEXT: '.COM;.EXE;.BAT;.CMD' } }))
      .toBe(path.join(root, `node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/${folder}/codex.exe`));
  });

  it('finds a bundled ARM64 executable in older npm installs', () => {
    const root = install({
      'codex.cmd': '@node "%dp0%/node_modules/@openai/codex/bin/codex.js" %*',
      'node_modules/@openai/codex/package.json': '{"name":"@openai/codex"}',
      'node_modules/@openai/codex/vendor/aarch64-pc-windows-msvc/codex/codex.exe': '',
    });
    expect(codexOnPath({ platform: 'win32', arch: 'arm64', env: { Path: root } }))
      .toBe(path.join(root, 'node_modules/@openai/codex/vendor/aarch64-pc-windows-msvc/codex/codex.exe'));
  });

  it('keeps a native executable earlier on PATH ahead of a later npm install', () => {
    const root = install({
      'native/codex.exe': '',
      'npm/codex.cmd': '@echo off',
      'npm/node_modules/@openai/codex/package.json': '{"name":"@openai/codex"}',
      'npm/node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe': '',
    });
    expect(codexOnPath({ platform: 'win32', arch: 'x64', env: { PATH: `${path.join(root, 'native')};${path.join(root, 'npm')}` } }))
      .toBe(path.join(root, 'native/codex.exe'));
  });

  it('preserves a custom wrapper when no npm binary can be resolved', () => {
    const root = install({ 'codex.cmd': '@custom-codex' });
    expect(codexOnPath({ platform: 'win32', arch: 'x64', env: { PATH: root } })).toBe(path.join(root, 'codex.cmd'));
  });

  it('does not bypass a custom wrapper merely because npm Codex is installed beside it', () => {
    const root = install({
      'codex.cmd': '@custom-codex',
      'node_modules/@openai/codex/package.json': '{"name":"@openai/codex"}',
      'node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe': '',
    });
    expect(codexOnPath({ platform: 'win32', arch: 'x64', env: { PATH: root } })).toBe(path.join(root, 'codex.cmd'));
  });

  it('leaves command lookup unchanged off Windows or when nothing is installed', () => {
    expect(codexOnPath({ platform: 'linux', env: {} })).toBe('codex');
    expect(codexOnPath({ platform: 'win32', env: {} })).toBe('codex');
  });
});
