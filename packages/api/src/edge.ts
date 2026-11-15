// The edge token: who is calling, checked by the Worker without asking the
// accounts backend. The backend signs it (HS256 with EDGE_SECRET, the private
// platform repository's apps/server/app/services/edge_token.ts) and sets it as
// a cookie for ten minutes; the Worker checks it with the same secret, in Web
// Crypto, and asks the backend for a new one when it has expired and the
// session is still alive.

import type { PlanId } from '@tramme/plans';

/** the cookie that carries it, as the backend sets it */
export const EDGE_COOKIE = '__Host-tramme-edge';
/** the backend's session cookie, which buys a new edge token */
export const SESSION_COOKIE = '__Host-tramme-session';

export interface Edge {
  userId: string;
  /** the workspace whose files the caller may touch (12 lowercase letters or digits) */
  workspaceId: string;
  sessionVersion: number;
  /** the account's plan when the token was signed (Basic when the token says none) */
  plan: PlanId;
  /** when it expires, seconds since 1970 */
  exp: number;
}

const PLAN_IDS: readonly PlanId[] = ['basic', 'plus', 'pro'];

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const keyOf = (secret: string, usage: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

/** the token's edge when its signature, its algorithm and its fields hold and it has not expired; null otherwise */
export async function verifyEdge(token: string, secret: string, now = Date.now()): Promise<Edge | null> {
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    if (header?.alg !== 'HS256') return null;
    const signed = await crypto.subtle.verify('HMAC', await keyOf(secret, 'verify'), fromBase64Url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!signed) return null;
    const p = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
    if (typeof p?.sub !== 'string' || !p.sub || typeof p.ws !== 'string' || !/^[a-z0-9]{12}$/.test(p.ws)) return null;
    if (typeof p.sv !== 'number' || typeof p.exp !== 'number' || p.exp * 1000 <= now) return null;
    return { userId: p.sub, workspaceId: p.ws, sessionVersion: p.sv, plan: PLAN_IDS.includes(p.pl) ? p.pl : 'basic', exp: p.exp };
  } catch {
    return null;
  }
}

/** lifetime of a token, seconds (the backend's EDGE_LIFETIME) */
export const EDGE_LIFETIME = 600;

/** a token as the backend signs it: for the tests and the local tools, never the Worker's own word */
export async function signEdge(edge: Omit<Edge, 'exp' | 'plan'> & { plan?: PlanId }, secret: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const part = (v: object) => toBase64Url(encoder.encode(JSON.stringify(v)));
  const unsigned = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: edge.userId, ws: edge.workspaceId, sv: edge.sessionVersion, pl: edge.plan ?? 'basic', iat, exp: iat + EDGE_LIFETIME })}`;
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await keyOf(secret, 'sign'), encoder.encode(unsigned)));
  return `${unsigned}.${toBase64Url(signature)}`;
}

/** the Set-Cookie value that carries a token to the browser, as the backend writes it */
export const edgeCookie = (token: string): string => `${EDGE_COOKIE}=${token}; Path=/; Max-Age=${EDGE_LIFETIME}; Secure; HttpOnly; SameSite=Lax`;

/** a cookie of a request */
export function cookieOf(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}
