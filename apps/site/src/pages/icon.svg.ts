// The site's icon: the logo's mark in the app's accent, in the studio theme's
// on a dark tab (lib/logo.ts)

import type { APIRoute } from 'astro';
import { markAdaptive } from '../lib/logo';

export const GET: APIRoute = () => new Response(markAdaptive, { headers: { 'content-type': 'image/svg+xml' } });
