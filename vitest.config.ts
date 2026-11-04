import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // the editor bundles .md and .svg files as text (build.ts): the tests read them the same way
  plugins: [{ name: 'md-as-text', enforce: 'pre', load: (id) => /\.(md|svg)$/.test(id) ? `export default ${JSON.stringify(readFileSync(id, 'utf8'))}` : null }],
  // the container class needs the Workers runtime: the tests get a stand-in (apps/worker/test/stubs)
  resolve: { alias: { '@cloudflare/containers': fileURLToPath(new URL('./apps/worker/test/stubs/containers.ts', import.meta.url)) } },
  test: { include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'bench/**/*.test.ts'] },
});
