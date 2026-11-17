// The end-to-end checks run before a deploy (pnpm test:cloud): slow, they need
// Chrome and ffmpeg, and stay out of `pnpm test`. The base config's plugins and
// aliases, its list of tests replaced (merged, the two lists would add up).
import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['apps/*/test/**/*.e2e.ts'], testTimeout: 45 * 60_000, hookTimeout: 120_000, fileParallelism: false },
});
