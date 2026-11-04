// Your space (/space): the account's own page. Who you are, your plan and
// credits, how you sign in, the sessions, your data, and the way out. The same
// sections and rows as the settings, on a page of their own.

import { useEffect, useState } from 'preact/hooks';
import {
  account, billing, changePassword, checkout, deleteAccount, exportData, linkUrl, manageSubscription, messageFor, plans, PROVIDERS, providerName, refreshAccount,
  resendVerification, revokeOtherSessions, signOut, unlinkProvider, updateProfile, type Billing, type PlanTerms, type Provider, type Reply, type UserJson,
} from '../accounts.ts';
import { saveBlob } from '../download.ts';
import { locale, m, t } from '../i18n/index.ts';
import { go } from '../nav.ts';
import { toast } from '../state.ts';
import { Modal, Seg } from './controls.tsx';
import { Icon } from './icons.tsx';
import { Brand } from './Logo.tsx';
import { Overlays } from './shell.tsx';
import { Row, Section } from './SettingsRows.tsx';

const eur = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const day = (iso?: string) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso)) : '');
const planName = (id: PlanTerms['id']) => t(id === 'pro' ? m('account.space.planPro') : id === 'plus' ? m('account.space.planPlus') : m('account.space.planBasic'));

/** what to say after a call: its error, or `done` */
function report(r: Reply, done?: string): boolean {
  if (r.ok) { if (done) toast(done); return true; }
  toast(messageFor(r.error), 'error');
  return false;
}

function Profile({ user }: { user: UserJson }) {
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    report(await updateProfile({ name: name.trim() }), t('account.space.saved'));
    setBusy(false);
  };
  return (
    <Section title={t('account.space.profile')} hint={t('account.space.profileHint')}>
      <Row label={t('account.name')} hint={t('account.space.nameHint')}>
        <div class="space-inline">
          <span class="field"><input value={name} maxLength={100} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} /></span>
          <button class="btn sm" disabled={busy || !name.trim() || name.trim() === user.name} onClick={save}>{t('account.space.save')}</button>
        </div>
      </Row>
      <Row label={t('account.email')} hint={t('account.space.emailHint')}>
        <div class="space-inline">
          <span class="mono">{user.email}</span>
          <span class={`tag${user.emailVerified ? '' : ' warn'}`}>{user.emailVerified ? t('account.space.verified') : t('account.space.unverified')}</span>
          {!user.emailVerified && <button class="btn sm" onClick={async () => report(await resendVerification(), t('account.verify.sent'))}>{t('account.verify.resend')}</button>}
        </div>
      </Row>
      <Row label={t('account.space.mailLanguage')}>
        <Seg size="sm" value={user.locale === 'fr' ? 'fr' : 'en'} options={[['fr', 'Français'], ['en', 'English']]}
          onChange={async (v) => report(await updateProfile({ locale: v }), t('account.space.saved'))} />
      </Row>
    </Section>
  );
}

function PlanSection({ user }: { user: UserJson }) {
  const [info, setInfo] = useState<Billing | null>(null);
  const [offers, setOffers] = useState<PlanTerms[]>([]);
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [busy, setBusy] = useState(false);
  useEffect(() => { billing().then((r) => { if (r.ok) setInfo(r.data); }); plans().then((r) => { if (r.ok) setOffers(r.data.filter((p) => p.id !== 'basic')); }); }, [user.id]);
  if (!info) return null;

  const go_ = async (start: Promise<Reply<{ url?: string }>>) => {
    setBusy(true);
    const r = await start;
    setBusy(false);
    if (r.ok && r.data.url) location.assign(r.data.url); else report(r);
  };
  const status = {
    free: t('account.space.statusFree'),
    active: t('account.space.statusActive', { date: day(info.periodEnd) }),
    past_due: t('account.space.statusPastDue', { date: day(info.periodEnd) }),
    canceled: t('account.space.statusCanceled', { date: day(info.endsAt ?? info.periodEnd) }),
  }[info.status];

  return (
    <Section title={t('account.space.plan')} hint={t('account.space.planHint')}>
      <Row label={t('account.space.currentPlan')} hint={status}><b>{planName(info.plan)}</b></Row>
      <Row label={t('account.space.credits')} hint={t('account.space.creditsHint')}><span class="mono">{t('account.space.creditsValue', { n: info.credits.toLocaleString(locale) })}</span></Row>
      {info.status === 'free' || info.status === 'canceled' ? (
        <>
          <Row label={t('account.space.billingPeriod')}>
            <Seg size="sm" value={interval} options={[['month', t('account.space.monthly')], ['year', t('account.space.yearly')]]} onChange={(v) => setInterval(v as 'month' | 'year')} />
          </Row>
          {offers.map((p) => (
            <Row key={p.id} label={planName(p.id)} hint={`${interval === 'year' ? t('account.space.perMonthYearly', { price: eur(p.price[interval]) }) : t('account.space.perMonth', { price: eur(p.price[interval]) })} · ${t('account.space.includes', { n: p.credits.toLocaleString(locale) })}`}>
              <button class="btn sm primary" disabled={busy} onClick={() => go_(checkout(p.id as 'plus' | 'pro', interval))}>{t('account.space.choose', { plan: planName(p.id) })}</button>
            </Row>
          ))}
        </>
      ) : (
        <Row label={t('account.space.manage')} hint={t('account.space.manageHint')}>
          <button class="btn sm" disabled={busy} onClick={() => go_(manageSubscription())}>{t('account.space.manage')}</button>
        </Row>
      )}
    </Section>
  );
}

function PasswordForm({ user, onDone }: { user: UserJson; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (next.length < 12) { toast(messageFor('password_short'), 'error'); return; }
    setBusy(true);
    const r = await changePassword(next, user.hasPassword ? current : undefined);
    setBusy(false);
    if (report(r, t('account.space.passwordChanged'))) { await refreshAccount(); onDone(); }
  };
  return (
    <form class="space-form" onSubmit={submit}>
      {user.hasPassword && <span class="field"><input type="password" autocomplete="current-password" placeholder={t('account.currentPassword')} aria-label={t('account.currentPassword')} value={current} onInput={(e) => setCurrent((e.target as HTMLInputElement).value)} /></span>}
      <span class="field"><input type="password" autocomplete="new-password" placeholder={t('account.newPassword')} aria-label={t('account.newPassword')} value={next} onInput={(e) => setNext((e.target as HTMLInputElement).value)} /></span>
      <span class="faint">{t('account.passwordHint')}</span>
      <div class="space-inline"><button class="btn sm primary" type="submit" disabled={busy}>{t('account.space.savePassword')}</button><button class="btn sm ghost" type="button" onClick={onDone}>{t('common.cancel')}</button></div>
    </form>
  );
}

function SignInMethods({ user }: { user: UserJson }) {
  const [editing, setEditing] = useState(false);
  const unlink = async (p: Provider) => { report(await unlinkProvider(p), t('account.space.unlinked')); };
  return (
    <Section title={t('account.space.signInMethods')} hint={t('account.space.signInMethodsHint')}>
      <Row label={t('account.space.passwordRow')} hint={user.hasPassword ? t('account.space.passwordSet') : t('account.space.passwordNone')} stack={editing} below={editing ? <div class="set-row stack"><PasswordForm user={user} onDone={() => setEditing(false)} /></div> : undefined}>
        {!editing && <button class="btn sm" onClick={() => setEditing(true)}>{user.hasPassword ? t('account.space.change') : t('account.space.setPassword')}</button>}
      </Row>
      {PROVIDERS.map((p) => {
        const linked = user.providers.includes(p);
        return (
          <Row key={p} label={providerName(p)} hint={linked ? t('account.space.linked') : t('account.space.notLinked')}>
            {linked ? <button class="btn sm" onClick={() => unlink(p)}>{t('account.space.unlink')}</button> : <a class="btn sm" href={linkUrl(p)}>{t('account.space.link')}</a>}
          </Row>
        );
      })}
    </Section>
  );
}

function DeleteDialog({ user, onClose }: { user: UserJson; onClose: () => void }) {
  const [proof, setProof] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!proof || busy) return;
    setBusy(true);
    // an address is typed, a password is not: either proves it is them
    const r = await deleteAccount(proof.includes('@') ? { email: proof } : { password: proof });
    setBusy(false);
    if (r.ok) go('/'); else toast(messageFor(r.error), 'error');
  };
  return (
    <Modal title={t('account.space.deleteTitle')} onClose={onClose}>
      <form class="modal-body" onSubmit={submit}>
        <p>{t('account.space.deleteLead', { email: user.email })}</p>
        <span class="field"><input type="text" autocomplete="off" placeholder={t('account.space.deleteConfirm')} aria-label={t('account.space.deleteConfirm')} value={proof} onInput={(e) => setProof((e.target as HTMLInputElement).value)} autofocus /></span>
        <div class="modal-foot">
          <button class="btn ghost" type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button class="btn danger solid" type="submit" disabled={!proof || busy}>{t('account.space.deleteSubmit')}</button>
        </div>
      </form>
    </Modal>
  );
}

function Data({ user }: { user: UserJson }) {
  const [deleting, setDeleting] = useState(false);
  const download = async () => {
    const blob = await exportData();
    if (!blob) { toast(messageFor('generic'), 'error'); return; }
    await saveBlob(blob, 'tramme-account.json');
  };
  return (
    <>
      <Section title={t('account.space.sessions')} hint={t('account.space.sessionsHint')}>
        <Row label={t('account.space.revoke')} hint={t('account.space.revokeHint')}>
          <button class="btn sm" onClick={async () => report(await revokeOtherSessions(), t('account.space.revoked'))}>{t('account.space.revokeButton')}</button>
        </Row>
      </Section>
      <Section title={t('account.space.data')} hint={t('account.space.dataHint')}>
        <Row label={t('account.space.export')} hint={t('account.space.exportHint')}>
          <button class="btn sm" onClick={download}><Icon name="download" />{t('account.space.exportButton')}</button>
        </Row>
        <Row label={t('account.space.delete')} hint={t('account.space.deleteHint')}>
          <button class="btn sm danger" onClick={() => setDeleting(true)}><Icon name="trash" />{t('account.space.deleteButton')}</button>
        </Row>
      </Section>
      {deleting && <DeleteDialog user={user} onClose={() => setDeleting(false)} />}
    </>
  );
}

export function SpacePage() {
  useEffect(() => { refreshAccount().then((a) => { if (a.status === 'out') go('/login'); }); }, []);
  const state = account.value;
  const user = state.status === 'in' ? state.user : null;
  return (
    <div class="space">
      <header class="home-top">
        <a class="brand" href="/" aria-label="Tramme"><Brand size={20} /></a>
        <span class="grow" />
        <a class="btn outline sm" href="/"><Icon name="home" /><span class="label">{t('account.projects')}</span></a>
        {user && <button class="btn ghost sm" onClick={async () => { await signOut(); go('/'); }}>{t('account.signOut')}</button>}
      </header>
      <main class="space-main">
        <div class="space-title"><h1>{t('account.space.title')}</h1><p class="faint">{t('account.space.lead')}</p></div>
        {state.status === 'unavailable' && <p class="home-note"><Icon name="info" /><span>{t('account.space.unavailable')}</span></p>}
        {state.status === 'unknown' && <p class="faint">{t('account.working')}</p>}
        {user && (
          <>
            {!user.emailVerified && (
              <div class="home-note"><Icon name="info" /><span>{t('account.verify.banner', { email: user.email })}</span>
                <button class="btn sm" onClick={async () => report(await resendVerification(), t('account.verify.sent'))}>{t('account.verify.resend')}</button></div>
            )}
            <Profile user={user} />
            <PlanSection user={user} />
            <SignInMethods user={user} />
            <Data user={user} />
          </>
        )}
      </main>
      <Overlays />
    </div>
  );
}
