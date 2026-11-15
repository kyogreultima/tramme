// The projects of this browser, offered to the account: shown once after
// signing in where some wait (bring.ts), and from the space at any time.

import { useEffect, useState } from 'preact/hooks';
import type { Manifest } from '@tramme/project';
import { account } from '../accounts.ts';
import { bring, localProjects, markOffered, wasOffered } from '../bring.ts';
import { t } from '../i18n/index.ts';
import { cloud } from '../mode.ts';
import { tauri } from '../tauri.ts';
import { toast } from '../state.ts';
import { Modal } from './controls.tsx';

export function BringDialog({ projects, onClose, onDone }: { projects: Manifest[]; onClose: () => void; onDone: () => void }) {
  const [chosen, setChosen] = useState(() => new Set(projects.map((p) => p.id)));
  const [at, setAt] = useState<{ done: number; total: number; name: string } | null>(null);
  const flip = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const go = async () => {
    const picked = projects.filter((p) => chosen.has(p.id));
    const r = await bring(picked, (done, total, name) => setAt({ done, total, name }));
    if (r.failed.length) toast(t('account.bring.failed', { names: r.failed.map((f) => f.name).join(', ') }), 'error');
    else toast(t('account.bring.done', { count: r.brought.length }));
    onDone();
    onClose();
  };
  return (
    <Modal title={t('account.bring.title')} onClose={() => { if (!at) onClose(); }}>
      <div class="modal-body">
        <p>{t('account.bring.lead', { count: projects.length })}</p>
        <ul class="bring-list" role="list">
          {projects.map((p) => (
            <li key={p.id}>
              <label><input type="checkbox" checked={chosen.has(p.id)} disabled={!!at} onChange={() => flip(p.id)} /><span>{p.name}</span></label>
            </li>
          ))}
        </ul>
        {at && (
          <div class="bring-at">
            <div class="progress"><i style={{ width: `${(at.done / Math.max(1, at.total)) * 100}%` }} /></div>
            <span class="faint">{t('account.bring.at', { done: at.done, total: at.total, name: at.name })}</span>
          </div>
        )}
        <p class="faint">{t('account.bring.kept')}</p>
        <div class="modal-foot">
          <button class="btn ghost" type="button" disabled={!!at} onClick={onClose}>{t('account.bring.later')}</button>
          <button class="btn solid" type="button" disabled={!chosen.size || !!at} onClick={go}>{t('account.bring.submit', { count: chosen.size })}</button>
        </div>
      </div>
    </Modal>
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
