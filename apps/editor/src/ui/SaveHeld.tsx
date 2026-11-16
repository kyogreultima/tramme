// When the saves wait (state.ts, saveHeld): the project was written elsewhere
// since this page read it, or the account's session ended. Nothing is lost
// while this asks: the changes stay in the page.
//
// - Another version: keep this one (written over the other) or take the other
//   (the project read again, after a confirmation: this page's changes go).
// - Signed out: sign in again here, with a password, or in another tab (a
//   Google or GitHub account); the waiting changes then go through.

import { useState } from 'preact/hooks';
import { messageFor, signIn } from '../accounts.ts';
import { t } from '../i18n/index.ts';
import { keepThisVersion, resumeSaving, saveHeld, takeTheOtherVersion, toast } from '../state.ts';
import { Modal } from './controls.tsx';

export function SaveHeldDialog() {
  const why = saveHeld.value;
  if (why === 'conflict') return <Conflict />;
  if (why === 'signedOut') return <SignedOut />;
  return null;
}

/** closing a question leaves the saves waiting: it comes back with the next change's try */
const later = () => {};

function Conflict() {
  const [taking, setTaking] = useState(false);
  const keep = () => keepThisVersion().catch((e) => toast(t('common.couldNotSaveError', { error: (e as Error).message }), 'error'));
  return (
    <Modal title={t('saveHeld.conflictTitle')} onClose={later}>
      <div class="modal-body">
        <p>{t('saveHeld.conflictLead')}</p>
        {taking && <p class="err">{t('saveHeld.takeConfirm')}</p>}
        <div class="modal-foot">
          {taking
            ? <><button class="btn ghost" onClick={() => setTaking(false)}>{t('common.cancel')}</button><button class="btn danger solid" onClick={takeTheOtherVersion}>{t('saveHeld.take')}</button></>
            : <><button class="btn ghost" onClick={() => setTaking(true)}>{t('saveHeld.take')}</button><button class="btn solid" onClick={keep}>{t('saveHeld.keep')}</button></>}
        </div>
      </div>
    </Modal>
  );
}

function SignedOut() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const resume = () => resumeSaving().catch((e) => toast((e as Error).message, 'error'));
  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const r = await signIn(email.trim(), password);
    setBusy(false);
    if (r.ok) await resume(); else toast(messageFor(r.error), 'error');
  };
  return (
    <Modal title={t('saveHeld.signedOutTitle')} onClose={later}>
      <form class="modal-body" onSubmit={submit}>
        <p>{t('saveHeld.signedOutLead')}</p>
        <span class="field"><input type="email" autocomplete="email" placeholder={t('account.email')} aria-label={t('account.email')} value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} autofocus /></span>
        <span class="field"><input type="password" autocomplete="current-password" placeholder={t('account.password')} aria-label={t('account.password')} value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} /></span>
        <p class="faint">{t('saveHeld.otherTab')} <a href="/login" target="_blank" rel="noopener">{t('saveHeld.openSignIn')}</a></p>
        <div class="modal-foot">
          <button class="btn ghost" type="button" onClick={resume}>{t('saveHeld.retry')}</button>
          <button class="btn solid" type="submit" disabled={!email || !password || busy}>{t('account.signIn')}</button>
        </div>
      </form>
    </Modal>
  );
}
