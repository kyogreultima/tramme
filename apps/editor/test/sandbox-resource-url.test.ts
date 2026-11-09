import { expect, it } from 'vitest';
import { approvedProjectResource } from '../src/plugins/host.ts';

const origin = 'https://tramme.test';
const approved = (path: string) => approvedProjectResource(new URL(path, origin), '/projects/one/', origin, 'https:');

it('accepts only project resources after repeated URL decoding', () => {
  expect(approved('/projects/one/fonts/my%20font.woff')).toBe(true);
  expect(approved('blob:https://tramme.test/owned')).toBe(true);
  expect(approved('blob:https://other.test/foreign')).toBe(false);
  expect(approved('https://other.test/projects/one/plugin.js')).toBe(false);
  expect(approved('/projects/one/assets/safe%2f..%2f..%2f..%2ftwo/key.js')).toBe(false);
  expect(approved('/projects/one/assets/%252e%252e/%252e%252e/two/key.js')).toBe(false);
  expect(approved('/projects/one/fonts/bad%5c..%5csecret.woff')).toBe(false);
  expect(approved('/projects/one/assets/bad%25ZZ.js')).toBe(false);
});
