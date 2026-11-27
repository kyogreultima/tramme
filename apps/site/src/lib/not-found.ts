// The site's 404 page for a page rendered when asked (/p/<id>/ of a film that is
// not, or no longer, in the gallery): the prerendered 404 of its language, read
// from the site's own files (the Worker's ASSETS binding), with a 404 status.
// Astro.rewrite cannot do it: a page rendered when asked may not rewrite to a
// prerendered one.
import { env } from 'cloudflare:workers';
import { pathIn, type Locale } from './i18n';

interface Assets { fetch(url: URL): Promise<Response> }

export async function notFound(locale: Locale, url: URL): Promise<Response> {
  const page = await (env as unknown as { ASSETS: Assets }).ASSETS.fetch(new URL(pathIn(locale, '/404.html'), url));
  return new Response(page.body, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
