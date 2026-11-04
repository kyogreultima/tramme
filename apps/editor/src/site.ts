// The website that goes with this editor, for the links from the app to it: the
// terms, where a page of the site is the answer.
//
// It is read from the address the editor is served at (an environment's app has
// that environment's site, any localhost has the local one), so a built editor
// links right wherever it runs. Only an address nobody knows (a branch
// deployment) falls back on what the editor was built for (build.ts, from
// brand/environments.ts); the tests, which are not built, get the public site.

import { siteOfApp } from '../../../brand/environments.ts';

declare const __TRAMME_SITE__: string | undefined;

const built = typeof __TRAMME_SITE__ === 'string' ? __TRAMME_SITE__ : 'https://tramme.dev';

export const SITE_URL: string = (typeof location !== 'undefined' && siteOfApp(location.origin)) || built;
