// The routes of accounts, handed to the accounts backend (the private platform repository).
//
// The Worker serves the editor, the projects and the providers; who someone is,
// their account, their plan and their sign-in with Google or GitHub are the
// backend's. The browser talks to one address (the Worker's), so the session
// cookie and the Origin of its requests are the app's own; this passes the
// request on as it came and gives the answer back, cookies and redirects
// included.
//
// The backend is reached one of two ways:
// - `ACCOUNTS`, a container behind the Worker (container.ts): it has no
//   address, nothing but this Worker can reach it. What a deployment uses.
// - `ACCOUNTS_URL`, an address: a backend started on this machine
//   (`npm run server:dev` of the platform repository), for development.
// With neither, none of these routes exist (the private and personal modes
// have no accounts).

import type { Env } from './http.ts';

/** what the backend answers: sign-in, the account, billing and its providers' notices, the back-office */
const ACCOUNT_ROUTES = /^\/api\/(auth|account|billing|admin)(\/|$)/;

/** the name of the one container instance that serves everyone */
const INSTANCE = 'accounts';

export async function accountRoute(req: Request, env: Env): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (!ACCOUNT_ROUTES.test(url.pathname) || !hasAccounts(env)) return undefined;

  // What the visitor sends is not what the backend believes. It trusts these two, and only the Worker
  // can set them: the secret of the routes that are the Worker's own, and the address that Cloudflare saw.
  const headers = new Headers(req.headers);
  headers.delete('x-tramme-internal');
  headers.delete('x-forwarded-for');
  const seen = req.headers.get('cf-connecting-ip');
  if (seen) headers.set('x-forwarded-for', seen);

  // redirect: 'manual': a sign-in with Google ends in a redirect that is the browser's to follow
  const answer = await toBackend(env, new Request(new Request(url, req), { headers, redirect: 'manual' }));
  return new Response(answer.body, answer);
}

/** whether this deployment has the accounts backend */
export const hasAccounts = (env: Env): boolean => !!(env.ACCOUNTS || env.ACCOUNTS_URL);

/** a request to the backend, at its path: through the container, or at the address of a backend started on this machine */
export function toBackend(env: Env, req: Request): Promise<Response> {
  if (env.ACCOUNTS) return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(INSTANCE)).fetch(req);
  if (!env.ACCOUNTS_URL) throw new Error('no accounts backend');
  const url = new URL(req.url);
  return fetch(new Request(new URL(url.pathname + url.search, env.ACCOUNTS_URL), req));
}

/** a route of the backend that is the Worker's own (/internal), with its secret */
export function internal(env: Env, path: string, init: { cookie?: string | null; body?: unknown }): Promise<Response> {
  const headers = new Headers({ 'x-tramme-internal': env.INTERNAL_SECRET ?? '' });
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return toBackend(env, new Request(`https://backend${path}`, { method: 'POST', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }));
}
