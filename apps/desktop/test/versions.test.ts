// One version for the whole project (scripts/version.ts writes it): every package,
// the desktop app's Tauri config, its crates and their lockfile entries.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const version = (JSON.parse(read('package.json')) as { version: string }).version;

describe('the project\'s version', () => {
  it('is every package\'s', () => {
    const manifests = ['apps', 'packages'].flatMap((d) => fs.readdirSync(path.join(root, d)).map((p) => `${d}/${p}/package.json`))
      .filter((f) => fs.existsSync(path.join(root, f)));
    for (const f of manifests) expect([f, (JSON.parse(read(f)) as { version?: string }).version]).toEqual([f, version]);
  });

  it('is the desktop app\'s, in its Tauri config, its two crates and the lockfile', () => {
    expect((JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')) as { version: string }).version).toBe(version);
    for (const f of ['apps/desktop/src-tauri/Cargo.toml', 'apps/desktop/plugin-device/Cargo.toml']) {
      expect([f, /^version = "([^"]+)"/m.exec(read(f))?.[1]]).toEqual([f, version]);
    }
    const lock = read('apps/desktop/src-tauri/Cargo.lock');
    for (const name of ['tramme-desktop', 'tauri-plugin-tramme-device']) {
      expect([name, new RegExp(`name = "${name}"\\r?\\nversion = "([^"]+)"`).exec(lock)?.[1]]).toEqual([name, version]);
    }
  });
});
