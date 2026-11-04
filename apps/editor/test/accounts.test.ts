import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { account, errorCode, exportData, messageFor, providersOn, refreshAccount, signIn, signOut, unlinkProvider } from '../src/accounts.ts';
import { t } from '../src/i18n/index.ts';

const answer = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const user = { id: 'u1', email: 'ada@example.com', name: 'Ada', emailVerified: true, hasPassword: true, providers: [], locale: 'en', workspace: { id: 'abcdefghijkl', name: 'Ada' } };

let calls: { url: string; init?: RequestInit }[];
const serve = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => { calls.push({ url, init }); return handler(url, init); });
};

beforeEach(() => { account.value = { status: 'unknown' }; });
afterEach(() => vi.unstubAllGlobals());

describe('the code of a failed answer', () => {
  it('is the server\'s own word when it gave one', () => {
    expect(errorCode(401, { error: 'invalid_credentials' })).toBe('invalid_credentials');
    expect(errorCode(422, { error: 'email_taken' })).toBe('email_taken');
    expect(errorCode(409, { error: 'last_method' })).toBe('last_method');
  });

  it('reads what a validation says of the field', () => {
    expect(errorCode(422, { errors: [{ field: 'password' }] })).toBe('password_short');
    expect(errorCode(422, { errors: [{ field: 'next' }] })).toBe('password_short');
    expect(errorCode(422, { errors: [{ field: 'email' }] })).toBe('email_invalid');
    expect(errorCode(422, { errors: [{ field: 'name' }] })).toBe('name_missing');
  });

  it('falls back on the status, and on a generic one', () => {
    expect(errorCode(401, {})).toBe('signed_out');
    expect(errorCode(429, null)).toBe('too_many_attempts');
    expect(errorCode(403, undefined)).toBe('origin');
    expect(errorCode(500, {})).toBe('generic');
  });

  it('has a sentence for every code the server can send, and a generic one for the rest', () => {
    for (const code of ['invalid_credentials', 'too_many_attempts', 'email_taken', 'token', 'last_method', 'cancelled', 'identity_taken', 'unknown-provider']) {
      expect(messageFor(code)).not.toBe(code);
      expect(messageFor(code).startsWith('account.err.')).toBe(false);
    }
    expect(messageFor('something_new')).toBe(t('account.err.generic'));
    expect(messageFor(undefined)).toBe(t('account.err.generic'));
  });
});

describe('who is here', () => {
  it('is in, with the user, when the server knows the session', async () => {
    serve(() => answer(200, { user }));
    expect(await refreshAccount()).toEqual({ status: 'in', user });
    expect(account.value.status).toBe('in');
  });

  it('is out when accounts exist and nobody is signed in', async () => {
    serve(() => answer(401, { error: 'signed_out' }));
    expect((await refreshAccount()).status).toBe('out');
  });

  it('has no accounts on a server that does not answer them: a 404, a network failure, someone else\'s 401', async () => {
    serve(() => answer(404, { error: 'unknown route: GET /api/auth/me' }));
    expect((await refreshAccount()).status).toBe('unavailable');
    serve(() => { throw new Error('offline'); });
    expect((await refreshAccount()).status).toBe('unavailable');
    serve(() => answer(401, { message: 'Access denied' }));
    expect((await refreshAccount()).status).toBe('unavailable');
  });
});

describe('the calls', () => {
  it('signs in with the JSON the server wants, and keeps the user it answers', async () => {
    serve(() => answer(200, { user }));
    const r = await signIn('ada@example.com', 'secret');
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('/api/auth/login');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ email: 'ada@example.com', password: 'secret' });
    expect(account.value).toEqual({ status: 'in', user });
  });

  it('leaves the account as it was when sign-in fails, and says why', async () => {
    serve(() => answer(401, { error: 'invalid_credentials' }));
    const r = await signIn('ada@example.com', 'nope');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_credentials');
    expect(account.value.status).toBe('unknown');
  });

  it('reports a server that does not answer as a network error', async () => {
    serve(() => { throw new Error('offline'); });
    expect((await signIn('a@b.c', 'x')).error).toBe('network');
  });

  it('is out after signing out', async () => {
    account.value = { status: 'in', user };
    serve(() => new Response(null, { status: 204 }));
    await signOut();
    expect(account.value.status).toBe('out');
  });

  it('refreshes who is here after a provider is unlinked', async () => {
    serve((url) => (url.includes('/identities/') ? new Response(null, { status: 204 }) : answer(200, { user: { ...user, providers: [] } })));
    await unlinkProvider('github');
    expect(calls.map((c) => `${c.init?.method} ${c.url}`)).toEqual(['DELETE /api/account/identities/github', 'GET /api/auth/me']);
  });

  it('lists the providers that are on, none when the server cannot say', async () => {
    serve(() => answer(200, { google: false, github: true }));
    expect(await providersOn()).toEqual({ google: false, github: true });
    serve(() => answer(404, {}));
    expect(await providersOn()).toEqual({ google: false, github: false });
  });

  it('gives the data export as a file, nothing when it fails', async () => {
    serve(() => new Response('{"user":{}}', { status: 200 }));
    expect(await (await exportData())!.text()).toBe('{"user":{}}');
    serve(() => answer(401, {}));
    expect(await exportData()).toBeNull();
  });
});
