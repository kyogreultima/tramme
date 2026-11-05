// The project's site: a static Astro build. The landing page (src/pages)
// runs no engine: the examples are videos (src/videos, see
// components/Media.astro), loaded only near the screen. The docs (/docs/) are
// Starlight, over the repository's own Markdown (src/lib/docs.ts). With the
// site's address, Starlight writes the sitemap of every page.

import { defineConfig, fontProviders } from 'astro/config';
import { copyFile } from 'node:fs/promises';
import starlight from '@astrojs/starlight';
import cloudflare from '@astrojs/cloudflare';
import { sidebar } from './src/lib/docs.ts';
import { latestRelease } from './src/lib/download.ts';
import { ORIGINS, REPO } from './src/lib/links.ts';
import { SITE } from './src/lib/site.ts';

// the desktop app's installers, from GitHub's latest release, or the beta's latest build (src/lib/download.ts)
const release = await latestRelease(console.log, ORIGINS.env === 'beta' ? 'beta' : 'stable');

export default defineConfig({
  // the address of this environment (local, beta, production: brand/environments.ts), for the canonical links, the sitemap and the preview image
  site: SITE.url,
  // every page is prerendered today; the adapter lets /explore/ and /p/<id>/ switch to
  // server rendering (export const prerender = false) once the gallery API exists
  adapter: cloudflare({ imageService: 'compile', prerenderEnvironment: 'node' }),
  // the gallery moved from /examples/ to /explore/
  redirects: { '/examples': '/explore/', '/fr/examples': '/fr/explore/' },
  vite: { define: { __RELEASE__: JSON.stringify(release) } },
  fonts: [
    { provider: fontProviders.fontsource(), name: 'Geist', cssVariable: '--font-sans', weights: ['300 700'], styles: ['normal'] },
    { provider: fontProviders.fontsource(), name: 'Bricolage Grotesque', cssVariable: '--font-display', weights: ['300 800'], styles: ['normal'] },
    { provider: fontProviders.fontsource(), name: 'Geist Mono', cssVariable: '--font-mono', weights: ['400 500'], styles: ['normal'] },
  ],
  integrations: [
    {
      name: 'tramme-localized-not-found',
      hooks: {
        // Cloudflare resolves the nearest 404.html for an unknown asset path.
        'astro:build:done': async ({ dir }) => {
          await copyFile(new URL('fr/404/index.html', dir), new URL('fr/404.html', dir));
        },
      },
    },
    starlight({
      title: 'Tramme',
      // The bilingual website owns the branded 404 page.
      disable404Route: true,
      description: SITE.docs,
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      sidebar,
      customCss: ['./src/styles/docs.css'],
      // the landing page's brand, theme script and toggle, so both sides look and choose alike
      components: {
        Head: './src/components/docs/Head.astro',
        SiteTitle: './src/components/docs/SiteTitle.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeToggle.astro',
      },
      // the pages come from the repository's root (docs/, README.md): Starlight's
      // Markdown transforms (heading anchors, asides) apply there too
      markdown: { processedDirs: ['../..'] },
    }),
  ],
});
