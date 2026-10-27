import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // the editor bundles .md files as text (build.ts): the tests read them the same way
  plugins: [{ name: 'md-as-text', enforce: 'pre', load: (id) => id.endsWith('.md') ? `export default ${JSON.stringify(readFileSync(id, 'utf8'))}` : null }],
  test: { include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'] },
});
