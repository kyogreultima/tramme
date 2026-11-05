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

/** what the backend answers: sign-in, the account, billing and its providers' notices */
const ACCOUNT_ROUTES = /^\/api\/(auth|account|billing)(\/|$)/;

/** the name of the one container instance that serves everyone */
const INSTANCE = 'accounts';

export async function accountRoute(req: Request, env: Env): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (!ACCOUNT_ROUTES.test(url.pathname) || !(env.ACCOUNTS || env.ACCOUNTS_URL)) return undefined;

  // What the visitor sends is not what the backend believes. It trusts these two, and only the Worker
  // can set them: the secret of the routes that are the Worker's own, and the address that Cloudflare saw.
  const headers = new Headers(req.headers);
  headers.delete('x-tramme-internal');
  headers.delete('x-forwarded-for');
  const seen = req.headers.get('cf-connecting-ip');
  if (seen) headers.set('x-forwarded-for', seen);

  let answer: Response;
  if (env.ACCOUNTS) {
    // redirect: 'manual': a sign-in with Google ends in a redirect that is the browser's to follow
    const forwarded = new Request(new Request(url, req), { headers, redirect: 'manual' });
    answer = await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(INSTANCE)).fetch(forwarded);
  } else {
    const target = new URL(url.pathname + url.search, env.ACCOUNTS_URL);
    answer = await fetch(new Request(new Request(target, req), { headers, redirect: 'manual' }));
  }
  return new Response(answer.body, answer);
}
