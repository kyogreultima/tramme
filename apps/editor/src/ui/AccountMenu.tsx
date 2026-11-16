// The account's button in the top bars: on the home page "Sign in" for a
// visitor, the person's initial for someone signed in (a menu: their space, sign
// out); in a project, the initial only, the project saved before leaving it.
// Nothing at all on a server without accounts.

import { useEffect } from 'preact/hooks';
import { account, landAt, refreshAccount, signOut } from '../accounts.ts';
import { t } from '../i18n/index.ts';
import { go } from '../nav.ts';
import { saveNow } from '../state.ts';
import { openMenu } from './controls.tsx';

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

export function AccountMenu({ inProject }: { inProject?: boolean } = {}) {
  useEffect(() => { void refreshAccount(); }, []);
  const state = account.value;
  if (state.status === 'unknown' || state.status === 'unavailable') return null;
  if (state.status === 'out') return inProject ? null : <a class="btn outline sm" href="/login">{t('account.signIn')}</a>;
  const { user } = state;
  /** a project's changes saved first; a save that cannot go through keeps the person here (SaveHeld asks) */
  const leaving = async () => { if (!inProject) return true; try { await saveNow(); return true; } catch { return false; } };
  return (
    <button class="avatar-btn" title={t('account.signedInAs', { email: user.email })} aria-haspopup="menu"
      onClick={(e) => openMenu((e.currentTarget as HTMLElement).getBoundingClientRect(), [
        { label: user.name, detail: user.email, icon: 'home', disabled: true, onClick: () => {} },
        'sep',
        { label: t('account.yourSpace'), icon: 'gear', onClick: async () => { if (await leaving()) go('/space'); } },
        ...(user.isAdmin ? [{ label: t('admin.title'), icon: 'key' as const, onClick: async () => { if (await leaving()) go('/admin'); } }] : []),
        { label: t('account.signOut'), icon: 'unlock', onClick: async () => { if (!(await leaving())) return; await signOut(); await landAt('/'); } },
      ])}>
      <span aria-hidden="true">{initial(user.name)}</span>
    </button>
  );
}
