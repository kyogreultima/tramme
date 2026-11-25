// The projects of this browser, offered to the account: shown once after
// signing in where some wait (bring.ts), and from the space at any time. The
// copy runs behind once asked; BringStatus follows it in the top bars.

import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { Manifest } from '@tramme/project';
import { account } from '../accounts.ts';
import { bring, inAccount, localProjects, markOffered, moveHere, stillThere, wasOffered } from '../bring.ts';
import { t } from '../i18n/index.ts';
import { cloud } from '../mode.ts';
import { go } from '../nav.ts';
import { notify } from '../notify.ts';
import { S, saveNow, toast } from '../state.ts';
import { tauri } from '../tauri.ts';
import { Modal } from './controls.tsx';
import { Icon } from './icons.tsx';

/** the copy under way, followed from the top bars (BringStatus): where it is, and what the last one could not bring (and why, in words) */
export interface Bringing { at: { done: number; total: number; name: string } | null; failed: Manifest[]; said?: string }
export const bringing = signal<Bringing>({ at: null, failed: [] });
/** what shows the account's projects again once a copy is over */
let refresh: (() => void) | undefined;
/** the projects of the copy under way */
let under: Manifest[] = [];

/** the home page is up: its list is read again after each copy, even one another page began */
export const onMoved = (f: () => void) => { refresh = f; return () => { if (refresh === f) refresh = undefined; }; };

/** whether a project is being moved now: it is not opened meanwhile, what it would be edited to could not follow */
export const isMoving = (id: string) => !!bringing.value.at && under.some((p) => p.id === id);

// opening a project loads a page: what is being moved is kept for that page to take up (resumeMoves)
const KEY = 'tramme.moving';
const keep = (projects: Manifest[]) => {
  try { if (projects.length) sessionStorage.setItem(KEY, JSON.stringify(projects)); else sessionStorage.removeItem(KEY); } catch { /* not resumed */ }
};

/** to a moved project, what the open one holds saved first (a save that cannot go through keeps the person here) */
const show = (id: string) => async () => {
  try { if (S.ready.peek()) await saveNow(); } catch { return; }
  go(`/p/${encodeURIComponent(id)}`);
};

/** the copy over: told, with what to do next; those that failed stay at hand in the top bars */
function over(failed: Manifest[], said: string, then: (() => void) | undefined) {
  keep([]);
  under = [];
  bringing.value = { at: null, failed, ...(failed.length ? { said } : {}) };
  const action = failed.length ? { label: t('account.bring.retry'), run: () => retry() } : then && { label: t('common.open'), run: then };
  notify(t('account.bring.title'), said, failed.length ? 'error' : 'info', { action: action || undefined });
  refresh?.();
}

/** the last copy's failures, tried again */
const retry = () => { const { failed } = bringing.peek(); if (failed.length) begin(failed); };

function begin(projects: Manifest[], resume = false) {
  if (bringing.peek().at) { toast(t('home.moveBusy')); return; }
  if (!projects.length) return;
  under = projects;
  keep(projects);
  bringing.value = { at: { done: 0, total: projects.length, name: projects[0].name }, failed: [] };
  const lone = projects.length === 1 ? projects[0] : undefined;
  const couldNot = (error: string) => t('home.couldNotMove', { name: lone!.name, error });
  if (lone && inAccount(lone)) {
    void moveHere(lone, resume).then(
      (made) => over([], t('home.movedHere', { name: lone.name }), show(made.id)),
      (e: unknown) => over([lone], couldNot((e as Error).message), undefined),
    );
    return;
  }
  const step = (done: number, total: number, name: string) => { if (done < total) bringing.value = { ...bringing.peek(), at: { done, total, name } }; };
  void bring(projects, step, resume).then((r) => {
    const failed = projects.filter((p) => r.failed.some((f) => f.id === p.id));
    const made = r.brought[0];
    if (failed.length) over(failed, lone ? couldNot(r.failed[0].error) : t('account.bring.failed', { names: r.failed.map((f) => f.name).join(', ') }), undefined);
    else if (lone && made) over([], t('home.moved', { name: lone.name }), show(made.id));
    else over([], r.brought.length ? t('account.bring.done', { count: r.brought.length }) : t('account.bring.already'), undefined);
  }, (e: unknown) => over(projects, lone ? couldNot((e as Error).message) : t('account.bring.failed', { names: projects.map((p) => p.name).join(', ') }), undefined));
}

/**
 * The chosen projects copied while the person goes on: the dialog closes at once,
 * the top bars show where it is, the end is told (a notification of the system
 * when the app is in the background). Those that fail stay at hand, to try again.
 */
export function bringInBackground(projects: Manifest[], onDone?: () => void) {
  // what shows the account's projects again at the end; a retry from the top bars keeps the last one
  if (onDone) refresh = onDone;
  begin(projects);
}

/** Move one desktop project in either direction while the rest of the app stays usable. */
export function moveInBackground(project: Manifest, onDone?: () => void) {
  if (onDone) refresh = onDone;
  begin([project]);
}

/** what the last page of this window was moving when it went, taken up where it stopped; a project open here waits for its page to be left */
export async function resumeMoves() {
  let kept: Manifest[] = [];
  try { kept = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as Manifest[]; } catch { /* nothing kept */ }
  if (!Array.isArray(kept) || !kept.length || kept.some((p) => location.pathname.startsWith(`/p/${p.id}`))) return;
  const left: Manifest[] = [];
  for (const p of kept) if (await stillThere(p)) left.push(p);
  if (bringing.peek().at) return;
  if (left.length) begin(left, true); else { keep([]); refresh?.(); }
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
  const { at, failed, said: why } = bringing.value;
  if (at) {
    const said = t('account.bring.at', { done: at.done, total: at.total, name: at.name });
    return (
      <span class="bring-status" role="status" title={said} aria-label={said}>
        <Icon name="spinner" class="spin" /><span>{at.done}/{at.total}</span>
      </span>
    );
  }
  if (!failed.length) return null;
  const said = why ?? t('account.bring.failed', { names: failed.map((p) => p.name).join(', ') });
  return (
    <button class="btn outline sm bring-status failed" type="button" title={said} aria-label={`${said}. ${t('account.bring.retry')}`} onClick={retry}>
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
