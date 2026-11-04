// The pages of coming in: /login, /signup, and the two of the mails (the link of
// a forgotten password, /?reset=<token>). One card on a quiet page, the same
// fields and buttons as the rest of the editor.
//
// After signing in the visitor goes to the home page; after signing up, to the
// home page with the sentence they wrote on the site still in the direction box
// (/signup?prompt=…).

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { account, forgotPassword, messageFor, PROVIDERS, providerName, providersOn, refreshAccount, resetPassword, signIn, signUp, type Provider } from '../accounts.ts';
import { t } from '../i18n/index.ts';
import { go } from '../nav.ts';
import { SITE_URL } from '../site.ts';
import { toast } from '../state.ts';
import { Icon } from './icons.tsx';
import { AuthScene } from './AuthScene.tsx';
import { Brand } from './Logo.tsx';
import { Overlays } from './shell.tsx';

export type AuthMode = 'login' | 'signup' | 'forgot' | 'reset';

const TERMS = `${SITE_URL}/terms/`;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** where to go once in: home, with the words carried from the site */
const homeWith = (prompt?: string) => (prompt ? `/?prompt=${encodeURIComponent(prompt)}` : '/');

function Field({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <label class="auth-field">
      <span class="auth-label">{label}</span>
      <span class="field">{children}</span>
      {hint && <span class="faint auth-hint">{hint}</span>}
    </label>
  );
}

export function AuthPage({ mode: first, token, prompt }: { mode: AuthMode; token?: string; prompt?: string }) {
  const [mode] = useState(first);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [providers, setProviders] = useState<Record<Provider, boolean>>({ google: false, github: false });

  // someone already in has nothing to do here; a server without accounts has no page of them
  useEffect(() => {
    refreshAccount().then((a) => { if (a.status === 'in' && mode !== 'reset') go(homeWith(prompt)); });
    providersOn().then(setProviders);
  }, []);

  const state = account.value;
  const check = (): string | null => {
    if ((mode === 'signup') && !name.trim()) return messageFor('name_missing');
    if (mode !== 'reset' && !EMAIL.test(email.trim())) return messageFor('email_invalid');
    if ((mode === 'signup' || mode === 'reset') && password.length < 12) return messageFor('password_short');
    return null;
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    const problem = check();
    if (problem) { setError(problem); return; }
    setError('');
    setBusy(true);
    const clean = email.trim();
    try {
      if (mode === 'login') {
        const r = await signIn(clean, password);
        if (r.ok) return go(homeWith(prompt));
        setError(messageFor(r.error));
      } else if (mode === 'signup') {
        const r = await signUp(name.trim(), clean, password);
        if (r.ok) return go(homeWith(prompt));
        setError(messageFor(r.error));
      } else if (mode === 'forgot') {
        const r = await forgotPassword(clean);
        if (r.ok) setSent(true); else setError(messageFor(r.error));
      } else {
        const r = await resetPassword(token ?? '', password);
        if (r.ok) { toast(t('account.reset.done')); return go('/login'); }
        setError(r.error === 'token' ? t('account.reset.badLink') : messageFor(r.error));
      }
    } finally { setBusy(false); }
  };

  const head = {
    login: [t('account.login.title'), t('account.login.lead')],
    signup: [t('account.signup.title'), t('account.signup.lead')],
    forgot: [t('account.forgot.title'), t('account.forgot.lead')],
    reset: [t('account.reset.title'), t('account.reset.lead')],
  }[mode];
  const submitLabel = { login: t('account.login.submit'), signup: t('account.signup.submit'), forgot: t('account.forgot.submit'), reset: t('account.reset.submit') }[mode];
  const withProviders = (mode === 'login' || mode === 'signup') && PROVIDERS.some((p) => providers[p]);
  const query = prompt ? `?prompt=${encodeURIComponent(prompt)}` : '';

  return (
    <div class="auth">
      <AuthScene />
      <header class="home-top">
        <a class="brand" href="/" aria-label="Tramme"><Brand size={20} /></a>
      </header>
      <main class="auth-main">
        {state.status === 'unavailable' ? (
          <div class="auth-card">
            <p>{t('account.space.unavailable')}</p>
            <a class="btn outline" href="/">{t('account.projects')}</a>
          </div>
        ) : (
          <form class="auth-card" onSubmit={submit} noValidate>
            <h1>{head[0]}</h1>
            <p class="auth-lead">{head[1]}</p>

            {withProviders && (
              <>
                <div class="auth-providers">
                  {PROVIDERS.filter((p) => providers[p]).map((p) => (
                    <a key={p} class="btn outline lg" href={`/api/auth/${p}/redirect`}>{t('account.continueWith', { provider: providerName(p) })}</a>
                  ))}
                </div>
                <div class="auth-or" role="separator"><span>{t('account.or')}</span></div>
              </>
            )}

            {sent ? (
              <p class="auth-note" role="status"><Icon name="check" /><span>{t('account.forgot.sent')}</span></p>
            ) : (
              <>
                {mode === 'signup' && (
                  <Field label={t('account.name')}>
                    <input type="text" autocomplete="name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autofocus />
                  </Field>
                )}
                {mode !== 'reset' && (
                  <Field label={t('account.email')}>
                    <input type="email" autocomplete="email" inputMode="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} autofocus={mode !== 'signup'} />
                  </Field>
                )}
                {mode !== 'forgot' && (
                  <Field label={mode === 'reset' ? t('account.newPassword') : t('account.password')} hint={mode === 'login' ? undefined : t('account.passwordHint')}>
                    <input type="password" autocomplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} autofocus={mode === 'reset'} />
                  </Field>
                )}
                {error && <p class="auth-error" role="alert"><Icon name="alert" /><span>{error}</span></p>}
                <button class="btn primary lg" type="submit" disabled={busy}>{busy ? <><Icon name="spinner" />{t('account.working')}</> : submitLabel}</button>
              </>
            )}

            <div class="auth-links">
              {mode === 'login' && <a href="/forgot">{t('account.login.forgot')}</a>}
              {mode === 'login' && <span>{t('account.login.noAccount')} <a href={`/signup${query}`}>{t('account.login.create')}</a></span>}
              {mode === 'signup' && <span>{t('account.signup.haveAccount')} <a href={`/login${query}`}>{t('account.signIn')}</a></span>}
              {(mode === 'forgot' || mode === 'reset') && <a href="/login">{t('account.forgot.back')}</a>}
              {mode === 'reset' && error === t('account.reset.badLink') && <a href="/forgot">{t('account.forgot.title')}</a>}
            </div>
            {mode === 'signup' && (
              <p class="faint auth-fine">{t('account.signup.agree')} <a href={TERMS} target="_blank" rel="noopener">{t('account.signup.terms')}</a>.</p>
            )}
          </form>
        )}
      </main>
      <Overlays />
    </div>
  );
}
