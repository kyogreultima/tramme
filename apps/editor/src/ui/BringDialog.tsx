// The projects of this browser, offered to the account: shown once after
// signing in where some wait (bring.ts), and from the space at any time. The
// copy runs behind once asked; BringStatus follows it in the top bars.

import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { Manifest } from '@tramme/project';
import { account } from '../accounts.ts';
import { bring, localProjects, markOffered, wasOffered } from '../bring.ts';
import { t } from '../i18n/index.ts';
import { cloud } from '../mode.ts';
import { notify } from '../notify.ts';
import { tauri } from '../tauri.ts';
import { Modal } from './controls.tsx';
import { Icon } from './icons.tsx';

/** the copy under way, followed from the top bars (BringStatus): where it is, and what the last one could not bring */
export interface Bringing { at: { done: number; total: number; name: string } | null; failed: Manifest[] }
export const bringing = signal<Bringing>({ at: null, failed: [] });
/** what shows the account's projects again once a copy is over */
let refresh: (() => void) | undefined;

/**
 * The chosen projects copied while the person goes on: the dialog closes at once,
 * the top bars show where it is, the end is told (a notification of the system
 * when the app is in the background). Those that fail stay at hand, to try again.
 */
export function bringInBackground(projects: Manifest[], onDone?: () => void) {
  if (bringing.peek().at || !projects.length) return;
  // what shows the account's projects again at the end; a retry from the top bars keeps the last one
  if (onDone) refresh = onDone;
  bringing.value = { at: { done: 0, total: projects.length, name: projects[0].name }, failed: [] };
  void bring(projects, (done, total, name) => { if (done < total) bringing.value = { ...bringing.peek(), at: { done, total, name } }; }).then((r) => {
    const failed = projects.filter((p) => r.failed.some((f) => f.id === p.id));
    bringing.value = { at: null, failed };
    if (r.failed.length) notify(t('account.bring.title'), t('account.bring.failed', { names: r.failed.map((f) => f.name).join(', ') }), 'error');
    else notify(t('account.bring.title'), t('account.bring.done', { count: r.brought.length }));
    refresh?.();
  });
}

export function BringDialog({ projects, onClose, onDone }: { projects: Manifest[]; onClose: () => void; onDone: () => void }) {
  const [chosen, setChosen] = useState(() => new Set(projects.map((p) => p.id)));
  const busy = !!bringing.value.at;
  const flip = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // the copy goes on behind: the dialog closes, the top bars follow it (BringStatus)
  const go = () => { bringInBackground(projects.filter((p) => chosen.has(p.id)), onDone); onClose(); };
  return (
    <Modal title={t('account.bring.title')} onClose={onClose}>
      <div class="modal-body">
        <p>{t('account.bring.lead', { count: projects.length })}</p>
        <ul class="bring-list" role="list">
          {projects.map((p) => (
            <li key={p.id}>
              <label><input type="checkbox" checked={chosen.has(p.id)} onChange={() => flip(p.id)} /><span>{p.name}</span></label>
            </li>
          ))}
        </ul>
        <p class="faint">{busy ? t('account.bring.busy') : t('account.bring.kept')}</p>
        <div class="modal-foot">
          <button class="btn ghost" type="button" onClick={onClose}>{t('account.bring.later')}</button>
          <button class="btn solid" type="button" disabled={!chosen.size || busy} onClick={go}>{t('account.bring.submit', { count: chosen.size })}</button>
        </div>
      </div>
    </Modal>
  );
}

/** in the top bars, beside the account: the copy under way, then what it could not bring, to try again */
export function BringStatus() {
  const { at, failed } = bringing.value;
  if (at) {
    const said = t('account.bring.at', { done: at.done, total: at.total, name: at.name });
    return (
      <span class="bring-status" role="status" title={said} aria-label={said}>
        <Icon name="spinner" class="spin" /><span>{at.done}/{at.total}</span>
      </span>
    );
  }
  if (!failed.length) return null;
  const said = t('account.bring.failed', { names: failed.map((p) => p.name).join(', ') });
  return (
    <button class="btn outline sm bring-status failed" type="button" title={said} aria-label={`${said}. ${t('account.bring.retry')}`} onClick={() => bringInBackground(failed)}>
      <Icon name="alert" /><span class="label">{t('account.bring.retry')}</span>
    </button>
  );
}

/** on the home page of an account: the offer, once, when this browser keeps projects of its own */
export function BringOffer({ onDone }: { onDone: () => void }) {
  const [projects, setProjects] = useState<Manifest[] | null>(null);
  const state = account.value;
  const userId = state.status === 'in' ? state.user.id : null;
  useEffect(() => {
    // the browser's projects on a page of the cloud, the computer's in the desktop app
    if (!(cloud || tauri) || !userId || wasOffered(userId)) return;
    void localProjects().then((list) => { if (list.length) setProjects(list); else markOffered(userId); });
  }, [userId]);
  if (!projects || !userId) return null;
  return <BringDialog projects={projects} onDone={onDone} onClose={() => { markOffered(userId); setProjects(null); }} />;
}
