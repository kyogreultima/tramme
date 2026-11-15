// Projects in the cloud: what a signed-in person gets from a deployment with
// accounts. Their projects, libraries and conversations live in the one R2
// bucket under their workspace (w/<workspace>/, prefixed.ts of @tramme/api),
// their provider keys there too, sealed; the editor behaves as on a private
// server. A visitor who is not signed in keeps the personal mode as it is.
//
// Who is calling comes from the edge token the backend signs (edge.ts of
// @tramme/api), checked here without asking it; an expired token with a live
// session is renewed through the backend's /internal/edge, on any request,
// a part of a long upload or a ranged read included, and the new one is set
// on the answer.

import {
  EDGE_COOKIE, SESSION_COOKIE, PROVIDER_ROUTES, cookieOf, edgeCookie, failure, HttpError, json, keysRoute, loadKeys,
  prefixedBucket, providerRoute, providersConfig, purgePrefix, readJson, sealedKeyStore, STORAGE, storageRoute, verifyEdge, workspacePrefix, type Edge,
} from '@tramme/api';
import { LIMITS, PROJECT_FORMAT } from '@tramme/project';
import { hasAccounts, internal } from './accounts.ts';
import { pageAsset, rewrittenHeaders, type Env } from './http.ts';
import { limitsOn, withinPlan } from './limits.ts';
import { myGalleryRoute, unpublish } from './gallery.ts';

/** whether this deployment keeps signed-in people's projects: accounts, the bucket and the secrets */
export const cloudOn = (env: Env): boolean => hasAccounts(env) && !!(env.FILES && env.EDGE_SECRET && env.KEYS_SECRET && env.INTERNAL_SECRET);

/** who is signed in, and the cookie of a renewed edge token to give back */
export interface Signed { edge: Edge; renewed?: string }

export async function signedIn(req: Request, env: Env): Promise<Signed | null> {
  if (!cloudOn(env)) return null;
  const token = cookieOf(req, EDGE_COOKIE);
  const edge = token ? await verifyEdge(token, env.EDGE_SECRET!) : null;
  if (edge) return { edge };
  // expired or missing: the session, if it is still alive, buys a new one
  if (!cookieOf(req, SESSION_COOKIE)) return null;
  const res = await internal(env, '/internal/edge', { cookie: req.headers.get('cookie') });
  if (res.status !== 200) return null;
  const fresh = ((await res.json()) as { token?: string }).token;
  const renewed = fresh ? await verifyEdge(fresh, env.EDGE_SECRET!) : null;
  return renewed ? { edge: renewed, renewed: edgeCookie(fresh!) } : null;
}

/** the cookies that end a signed-in visit in this browser */
const ENDED = [`${EDGE_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`, `${SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`];

/** a signed-in person's request: their files, their keys, the editor's page marked as theirs */
export async function cloud(req: Request, env: Env, signed: Signed, ctx?: ExecutionContext): Promise<Response> {
  const answer = await cloudRoute(req, env, signed.edge, ctx).catch(failure);
  if (!signed.renewed) return answer;
  const headers = new Headers(answer.headers);
  headers.append('set-cookie', signed.renewed);
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers });
}

async function cloudRoute(req: Request, env: Env, edge: Edge, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/')) return accountPage(await pageAsset(env, req));
  const files = prefixedBucket(env.FILES!, workspacePrefix(edge.workspaceId));
  const keys = sealedKeyStore(files, env.KEYS_SECRET!, edge.workspaceId);
  const parts = url.pathname.slice('/api/'.length).split('/');
  const m = req.method;
  if (parts[0] === 'config' && m === 'GET') {
    // the keys of this person only: never the Worker's own (what the platform pays for comes with credits)
    return json({ mode: 'cloud', format: PROJECT_FORMAT, limits: LIMITS, ...providersConfig(await loadKeys(keys)) });
  }
  if (parts[0] === 'account' && parts.length === 1 && m === 'DELETE') return deleteAccount(req, env, edge, ctx);
  if (parts[0] === 'keys') return keysRoute(req, keys, parts.slice(1).map(decodeURIComponent));
  if (parts[0] === 'gallery') {
    const res = await myGalleryRoute(req, env, edge, env.FILES!, files);
    if (res) return res;
  }
  if (PROVIDER_ROUTES.includes(parts[0])) {
    const res = await providerRoute(req, { keys: await loadKeys(keys), fetch: (input, init) => fetch(input, init) }, parts);
    if (res) return res;
  }
  if (limitsOn(env)) {
    const held = await withinPlan(req, url, files, edge.plan);
    if (held) return held;
  }
  const res = await storageRoute(req, files, url);
  if (res) return res;
  throw new HttpError(404, `unknown route: ${m} ${url.pathname}`);
}

/** the account goes, then its files: the backend confirms and deletes the person, the bucket is purged after the answer */
async function deleteAccount(req: Request, env: Env, edge: Edge, ctx?: ExecutionContext): Promise<Response> {
  const proof = (await readJson(req)) as { password?: unknown; email?: unknown };
  const body = { userId: edge.userId, ...(typeof proof.password === 'string' && { password: proof.password }), ...(typeof proof.email === 'string' && { email: proof.email }) };
  const res = await internal(env, '/internal/account/delete', { body });
  if (res.status !== 200) return new Response(res.body, res);
  const { workspaces = [] } = (await res.json()) as { workspaces?: string[] };
  const purge = Promise.all(workspaces.map(async (ws) => {
    // the films it published leave the gallery with it
    const mine = await env.FILES!.get(`${workspacePrefix(ws)}gallery.json`);
    const published = mine ? Object.values(await mine.json<Record<string, string>>()) : [];
    await Promise.all(published.map((id) => unpublish(env.FILES!, id)));
    await purgePrefix(env.FILES!, workspacePrefix(ws));
  }));
  if (ctx) ctx.waitUntil(purge); else await purge;
  const headers = new Headers();
  for (const c of ENDED) headers.append('set-cookie', c);
  return new Response(null, { status: 204, headers });
}

/** the editor's page, told that its projects are in the account (mode.ts reads the meta) */
async function accountPage(res: Response): Promise<Response> {
  if (!(res.headers.get('content-type') ?? '').startsWith('text/html')) return res;
  const html = (await res.text()).replace('<head>', '<head><meta name="tramme-account" content="1">');
  const headers = rewrittenHeaders(res.headers);
  // the personal mode's service worker never keeps this page for a visitor who is signed out (sw.ts)
  headers.set('x-tramme-account', '1');
  return new Response(html, { status: res.status, headers });
}

/** the routes a signed-in person's page sends to the server: the ones a signed-out request is told to sign in for */
export const CLOUD_ROUTES = [...STORAGE, 'keys', ...PROVIDER_ROUTES];

/** what /api/config of the personal mode adds: whether signing in brings the projects to the cloud */
export const cloudConfig = (env: Env) => ({ cloud: cloudOn(env) });
