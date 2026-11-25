// The desktop app checks a project's paths with its own copy of the format's
// table (format.rs): both accept the same files.
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
const rust = read('apps/desktop/src-tauri/src/format.rs').match(/const EXT[^=]*= \[([\s\S]*?)\n\];/)![1];
const ts = read('packages/project/src/format.ts').match(/const EXT[^=]*= \{([\s\S]*?)\n\};/)![1];
const tableOf = (source: string, entry: RegExp) => Object.fromEntries([...source.matchAll(entry)].map((m) => [m[1], [...m[2].matchAll(/["']([a-z0-9]+)["']/g)].map((x) => x[1]).sort()]));

it('lists the same places and extensions as the format', () => {
  const web = tableOf(ts, /(\w+): \[([^\]]*)\]/g);
  expect(Object.keys(web)).toContain('versions');
  expect(tableOf(rust, /"(\w+)",\s*&\[([^\]]*)\]/g)).toEqual(web);
});
