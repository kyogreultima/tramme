// The site for language models (llmstxt.org): what Tramme is, where to use
// it, and the docs pages in the sidebar's order, each with its description

import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';
import { DOCS, docHref, docId } from '../lib/docs';
import { APP, REPO } from '../lib/links';
import { SITE } from '../lib/site';

// the site's own pages, besides the docs
const PAGES = [
  ['/features/', 'Features', 'The studio, the atelier, the assistant, the packs and the export'],
  ['/examples/', 'Examples', 'Films made with Tramme, each one in the repository'],
  ['/pricing/', 'Pricing', 'Free to use; only the AI provider you choose can cost money'],
  ['/download/', 'Download', 'The desktop app for Windows, macOS and Linux'],
  ['/about/', 'About', 'What Tramme is, its licence, how to take part'],
  ['/privacy/', 'Privacy', 'What is kept where'],
];

export const GET: APIRoute = async ({ site }) => {
  const sections = await Promise.all(DOCS.map(async (group) => {
    const lines = await Promise.all(group.pages.map(async (p) => {
      const entry = await getEntry('docs', docId(p.slug));
      const about = entry?.data.description;
      return `- [${entry?.data.title ?? p.label}](${new URL(docHref(p.slug), site)})${about ? `: ${about}` : ''}`;
    }));
    return `## ${group.label}\n\n${lines.join('\n')}`;
  }));
  const pages = PAGES.map(([path, name, about]) => `- [${name}](${new URL(path, site)}): ${about}`).join('\n');
  const text = `# ${SITE.name}\n\n> ${SITE.description}\n\n- [The editor, online](${APP}): projects and keys stay in the browser\n- [Source code](${REPO}): Functional Source License, Apache-2.0 after two years\n${pages}\n\n${sections.join('\n\n')}\n`;
  return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
