// The routes of accounts, handed to the accounts backend (apps/server).
//
// The Worker serves the editor, the projects and the providers; who someone is,
// their account, their plan and their sign-in with Google or GitHub are the
// backend's. The browser talks to one address (the Worker's), so the session
// cookie and the Origin of its requests are the app's own; this passes the
// request on as it came and gives the answer back, cookies and redirects
// included. `ACCOUNTS_URL` is the backend's address; without it, none of these
// routes exist (the private and personal modes have no accounts).

import type { Env } from './http.ts';

/** what the backend answers: sign-in, the account, billing and its providers' notices */
const ACCOUNT_ROUTES = /^\/api\/(auth|account|billing)(\/|$)/;

export async function accountRoute(req: Request, env: Env): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (!env.ACCOUNTS_URL || !ACCOUNT_ROUTES.test(url.pathname)) return undefined;
  const target = new URL(url.pathname + url.search, env.ACCOUNTS_URL);
  // redirect: 'manual': a sign-in with Google ends in a redirect that is the browser's to follow
  const answer = await fetch(new Request(new Request(target, req), { redirect: 'manual' }));
  return new Response(answer.body, answer);
}
