// The back-office (/admin), for the people who run the platform: find an
// account, see its plan, end its sessions, give it a plan by hand, close it;
// read the gallery's reports, take a film down or put it back. The backend
// answers /api/admin (accounts), the Worker /api/moderation (the gallery).
// For anyone else these routes do not exist, and the page says so.

import { useEffect, useState } from 'preact/hooks';
import { account, call, refreshAccount, type Reply } from '../accounts.ts';
import { locale, t } from '../i18n/index.ts';
import { go } from '../nav.ts';
import { filmUrl } from '../gallery.ts';
import { Modal } from './controls.tsx';
import { Icon } from './icons.tsx';
import { Brand } from './Logo.tsx';
import { Overlays } from './shell.tsx';
import { Row, Section } from './SettingsRows.tsx';
import { planName, report } from './Space.tsx';

interface Person { id: string; email: string; name: string; handle: string | null; emailVerified: boolean; isAdmin: boolean; createdAt: string | null; plan: 'basic' | 'plus' | 'pro'; status: string }
interface PersonDetail extends Person { workspace: string; providers: string[]; billing: { periodEnd?: string; credits: number } }
interface Reported { id: string; title: string; author: { name: string; handle: string }; visibility: string; reports: { reason: string; at: string }[] }

const day = (iso?: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)) : '');

function People() {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Person[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const search = async () => { const r = await call<Person[]>('GET', `/api/admin/users?q=${encodeURIComponent(q.trim())}`); if (report(r)) setList(r.data); };
  useEffect(() => { void search(); }, []);
  return (
    <Section title={t('admin.people')} hint={t('admin.peopleHint')}>
      <div class="space-inline">
        <span class="field"><input value={q} placeholder={t('admin.search')} aria-label={t('admin.search')} onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} /></span>
        <button class="btn sm" onClick={search}><Icon name="search" />{t('admin.find')}</button>
      </div>
      {list?.length === 0 && <p class="faint">{t('admin.nobody')}</p>}
      {list?.map((p) => (
        <Row key={p.id} label={`${p.name} · ${p.email}`} hint={[planName(p.plan), p.handle ? `@${p.handle}` : '', day(p.createdAt), p.isAdmin ? t('admin.isAdmin') : ''].filter(Boolean).join(' · ')}>
          <button class="btn sm" onClick={() => setOpen(p.id)}>{t('admin.open')}</button>
        </Row>
      ))}
      {open && <PersonDialog id={open} onClose={() => setOpen(null)} onChanged={search} />}
    </Section>
  );
}

function PersonDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [p, setP] = useState<PersonDetail | null>(null);
  const [plan, setPlan] = useState<'plus' | 'pro'>('plus');
  const [until, setUntil] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [closing, setClosing] = useState('');
  const load = async () => { const r = await call<PersonDetail>('GET', `/api/admin/users/${id}`); if (report(r)) setP(r.data); };
  useEffect(() => { void load(); }, [id]);
  if (!p) return null;
  const act = async (r: Promise<Pick<Reply, 'ok' | 'error'>>, done: string) => { if (report(await r, done)) { await load(); onChanged(); } };
  return (
    <Modal title={p.name} onClose={onClose} wide>
      <div class="modal-body">
        <p class="mono">{p.email} · {p.emailVerified ? t('account.space.verified') : t('account.space.unverified')}</p>
        <p class="faint">{[planName(p.plan), p.billing.periodEnd ? t('admin.until', { date: day(p.billing.periodEnd) }) : '', p.providers.join(', '), `w/${p.workspace}`].filter(Boolean).join(' · ')}</p>
        <div class="space-inline">
          <span class="field"><select value={plan} aria-label={t('admin.planLabel')} onChange={(e) => setPlan((e.target as HTMLSelectElement).value as 'plus' | 'pro')}>
            <option value="plus">{planName('plus')}</option><option value="pro">{planName('pro')}</option>
          </select></span>
          <span class="field"><input type="date" value={until} onInput={(e) => setUntil((e.target as HTMLInputElement).value)} aria-label={t('admin.untilLabel')} /></span>
          <button class="btn sm" onClick={() => act(call('POST', `/api/admin/users/${id}/plan`, { plan, until: new Date(`${until}T23:59:59Z`).toISOString() }), t('admin.planGiven'))}>{t('admin.givePlan')}</button>
          {p.plan !== 'basic' && <button class="btn sm ghost" onClick={() => act(call('POST', `/api/admin/users/${id}/plan`, { plan: 'basic' }), t('admin.planGiven'))}>{t('admin.backToBasic')}</button>}
        </div>
        <div class="space-inline">
          <button class="btn sm" onClick={() => act(call('POST', `/api/admin/users/${id}/sessions/revoke`), t('admin.sessionsEnded'))}>{t('admin.endSessions')}</button>
        </div>
        <p class="faint">{t('admin.closeLead')}</p>
        <div class="space-inline">
          <span class="field"><input value={closing} placeholder={p.email} aria-label={t('admin.closeConfirm')} onInput={(e) => setClosing((e.target as HTMLInputElement).value)} /></span>
          <button class="btn sm danger" disabled={closing.trim().toLowerCase() !== p.email.toLowerCase()} onClick={async () => { if (report(await call('DELETE', `/api/admin/users/${id}`), t('admin.closed'))) { onChanged(); onClose(); } }}>
            <Icon name="trash" />{t('admin.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Reports() {
  const [list, setList] = useState<Reported[] | null>(null);
  const load = async () => { const r = await call<Reported[]>('GET', '/api/moderation/reports'); if (report(r)) setList(r.data); };
  useEffect(() => { void load(); }, []);
  const act = async (r: Promise<Pick<Reply, 'ok' | 'error'>>, done: string) => { if (report(await r, done)) await load(); };
  return (
    <Section title={t('admin.reports')} hint={t('admin.reportsHint')}>
      {list?.length === 0 && <p class="faint">{t('admin.noReports')}</p>}
      {list?.map((f) => (
        <Row key={f.id} stack label={`${f.title} · @${f.author.handle}`} hint={t('admin.reportCount', { n: f.reports.length })}
          below={<ul class="admin-reasons">{f.reports.slice(0, 5).map((r) => <li key={r.at}><span class="faint">{day(r.at)}</span> {r.reason || '—'}</li>)}</ul>}>
          <div class="space-inline">
            <a class="btn sm ghost" href={filmUrl(f.id)} target="_blank" rel="noopener">{t('admin.see')}</a>
            {f.visibility === 'removed'
              ? <button class="btn sm" onClick={() => act(call('POST', `/api/moderation/films/${f.id}/restore`), t('admin.restored'))}>{t('admin.restore')}</button>
              : <button class="btn sm danger" onClick={() => act(call('POST', `/api/moderation/films/${f.id}/takedown`), t('admin.takenDown'))}>{t('admin.takeDown')}</button>}
            <button class="btn sm ghost" onClick={() => act(call('DELETE', `/api/moderation/films/${f.id}/reports`), t('admin.setAside'))}>{t('admin.dismiss')}</button>
          </div>
        </Row>
      ))}
    </Section>
  );
}

export function AdminPage() {
  useEffect(() => { refreshAccount().then((a) => { if (a.status === 'out') go('/login'); }); }, []);
  const state = account.value;
  const admin = state.status === 'in' && state.user.isAdmin;
  return (
    <div class="space">
      <header class="home-top">
        <a class="brand" href="/" aria-label="Tramme"><Brand size={20} /></a>
        <span class="grow" />
        <a class="btn outline sm" href="/space"><Icon name="gear" /><span class="label">{t('account.yourSpace')}</span></a>
      </header>
      <main class="space-main">
        <div class="space-title"><h1>{t('admin.title')}</h1><p class="faint">{t('admin.lead')}</p></div>
        {state.status === 'in' && !admin && <p class="home-note"><Icon name="info" /><span>{t('admin.notYours')}</span></p>}
        {admin && <><People /><Reports /></>}
      </main>
      <Overlays />
    </div>
  );
}
