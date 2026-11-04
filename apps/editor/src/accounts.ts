// The account of the person using the editor: who they are, and the calls the
// sign-in, space and account menu pages make. The server is the accounts
// backend (apps/server), reached through the Worker at the same address, so the
// session cookie rides along by itself.
//
// An editor on a server without accounts (personal mode, a private server)
// gets a 404 from /api/auth/me: `account` says "unavailable" and no page,
// button or menu of accounts shows.

import { signal } from '@preact/signals';
import { locale, m, t } from './i18n/index.ts';

export interface UserJson {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  hasPassword: boolean;
  providers: Provider[];
  locale: string;
  workspace: { id: string; name: string };
}

export type Provider = 'google' | 'github';
export const PROVIDERS: Provider[] = ['github', 'google'];
/** the name of each, as the buttons say it */
export const providerName = (p: Provider): string => t(p === 'google' ? m('account.google') : m('account.github'));

export type AccountState =
  | { status: 'unknown' }
  | { status: 'unavailable' }
  | { status: 'out' }
  | { status: 'in'; user: UserJson };

export const account = signal<AccountState>({ status: 'unknown' });

/** what the server answered: its status, its JSON body (when it had one), and the code of what went wrong */
export interface Reply<T = Record<string, unknown>> { ok: boolean; status: number; data: T; error?: ErrorCode }

/** the reasons the pages know how to say, each with its sentence (m() marks a key that t() translates where it is shown) */
const SAYINGS: Record<string, string> = {
  invalid_credentials: m('account.err.invalid_credentials'),
  too_many_attempts: m('account.err.too_many_attempts'),
  email_taken: m('account.err.email_taken'),
  password_short: m('account.err.password_short'),
  name_missing: m('account.err.name_missing'),
  email_invalid: m('account.err.email_invalid'),
  origin: m('account.err.origin'),
  token: m('account.err.token'),
  current_password: m('account.err.current_password'),
  confirm: m('account.err.confirm'),
  last_method: m('account.err.last_method'),
  signed_out: m('account.err.signed_out'),
  'unknown-provider': m('account.err.unknown-provider'),
  plan: m('account.err.plan'),
  'no-customer': m('account.err.no-customer'),
  network: m('account.err.network'),
  generic: m('account.err.generic'),
  cancelled: m('account.err.cancelled'),
  failed: m('account.err.failed'),
  disabled: m('account.err.disabled'),
  no_email: m('account.err.no_email'),
  identity_taken: m('account.err.identity_taken'),
};
export type ErrorCode = string;

/** the code of a failed answer: the server's own, or what its validation says, or what its status says */
export function errorCode(status: number, data: unknown): ErrorCode {
  const body = (data ?? {}) as { error?: unknown; errors?: { field?: string }[] };
  if (typeof body.error === 'string') return body.error;
  const field = body.errors?.[0]?.field;
  if (status === 422 && field) return field === 'password' || field === 'next' ? 'password_short' : field === 'name' ? 'name_missing' : field === 'email' ? 'email_invalid' : 'generic';
  if (status === 401) return 'signed_out';
  if (status === 429) return 'too_many_attempts';
  if (status === 403) return 'origin';
  return 'generic';
}

/** the sentence for a code, in the interface's language */
export const messageFor = (code: ErrorCode | undefined): string => t((code && SAYINGS[code]) || SAYINGS.generic);

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
  let res: Response;
  try {
    res = await fetch(path, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, status: 0, data: {} as T, error: 'network' };
  }
  let data = {} as T;
  try { data = (await res.json()) as T; } catch { /* an empty answer (204) */ }
  return res.ok ? { ok: true, status: res.status, data } : { ok: false, status: res.status, data, error: errorCode(res.status, data) };
}

// ── who is here ──────────────────────────────────────────────

/** asks the server who this is, and sets `account` */
export async function refreshAccount(): Promise<AccountState> {
  const me = await call<{ user?: UserJson; error?: string }>('GET', '/api/auth/me');
  account.value = me.ok && me.data.user ? { status: 'in', user: me.data.user }
    // 401 with the backend's own word: accounts exist, nobody is signed in; anything else: this server has none
    : me.status === 401 && me.data.error === 'signed_out' ? { status: 'out' } : { status: 'unavailable' };
  return account.value;
}

/** which buttons the sign-in pages show (a provider is on when the server holds its keys) */
export async function providersOn(): Promise<Record<Provider, boolean>> {
  const r = await call<Record<Provider, boolean>>('GET', '/api/auth/providers');
  return r.ok ? { google: !!r.data.google, github: !!r.data.github } : { google: false, github: false };
}

const take = (r: Reply<{ user?: UserJson }>) => { if (r.ok && r.data.user) account.value = { status: 'in', user: r.data.user }; return r; };

export const signIn = async (email: string, password: string) => take(await call<{ user?: UserJson }>('POST', '/api/auth/login', { email, password }));
export const signUp = async (name: string, email: string, password: string) => take(await call<{ user?: UserJson }>('POST', '/api/auth/signup', { name, email, password, locale }));
export async function signOut() {
  const r = await call('POST', '/api/auth/logout');
  if (r.ok) account.value = { status: 'out' };
  return r;
}

// ── the links of the mails ───────────────────────────────────

export const forgotPassword = (email: string) => call('POST', '/api/auth/password/forgot', { email });
export const resetPassword = (token: string, password: string) => call('POST', '/api/auth/password/reset', { token, password });
export const verifyEmail = (token: string) => call('POST', '/api/auth/verify', { token });
export const resendVerification = () => call('POST', '/api/auth/verify/resend');

// ── the space ────────────────────────────────────────────────

export const updateProfile = async (changes: { name?: string; locale?: string }) => take(await call<{ user?: UserJson }>('PATCH', '/api/account', changes));
export const changePassword = (next: string, current?: string) => call('PUT', '/api/account/password', { next, ...(current ? { current } : {}) });
export const revokeOtherSessions = () => call('POST', '/api/account/sessions/revoke');
export async function unlinkProvider(provider: Provider) {
  const r = await call('DELETE', `/api/account/identities/${provider}`);
  if (r.ok) await refreshAccount();
  return r;
}
export const deleteAccount = async (proof: { password?: string; email?: string }) => {
  const r = await call('DELETE', '/api/account', proof);
  if (r.ok) account.value = { status: 'out' };
  return r;
};

/** the whole account as the server holds it, as a JSON file's content */
export async function exportData(): Promise<Blob | null> {
  try {
    const res = await fetch('/api/account/export');
    return res.ok ? await res.blob() : null;
  } catch { return null; }
}

/** where the browser goes to link a provider (it returns to the space) */
export const linkUrl = (provider: Provider) => `/api/auth/${provider}/redirect`;

// ── plan and credits ─────────────────────────────────────────

export interface PlanTerms { id: 'basic' | 'plus' | 'pro'; price: { month: number; year: number }; credits: number }
export interface Billing {
  plan: PlanTerms['id'];
  status: 'free' | 'active' | 'past_due' | 'canceled';
  interval?: 'month' | 'year';
  periodEnd?: string;
  endsAt?: string;
  credits: number;
}

export const billing = () => call<Billing>('GET', '/api/billing');
export const plans = () => call<PlanTerms[]>('GET', '/api/billing/plans');
export const checkout = (plan: 'plus' | 'pro', interval: 'month' | 'year') => call<{ url?: string }>('POST', '/api/billing/checkout', { plan, interval, locale });
export const manageSubscription = () => call<{ url?: string }>('POST', '/api/billing/portal');
