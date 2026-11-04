// The account's button in the top bar of the home page: "Sign in" for a
// visitor, the person's initial for someone signed in (a menu: their space, sign
// out). Nothing at all on a server without accounts.

import { useEffect } from 'preact/hooks';
import { account, refreshAccount, signOut } from '../accounts.ts';
import { t } from '../i18n/index.ts';
import { go } from '../nav.ts';
import { openMenu } from './controls.tsx';

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

export function AccountMenu() {
  useEffect(() => { void refreshAccount(); }, []);
  const state = account.value;
  if (state.status === 'unknown' || state.status === 'unavailable') return null;
  if (state.status === 'out') return <a class="btn outline sm" href="/login">{t('account.signIn')}</a>;
  const { user } = state;
  return (
    <button class="avatar-btn" title={t('account.signedInAs', { email: user.email })} aria-haspopup="menu"
      onClick={(e) => openMenu((e.currentTarget as HTMLElement).getBoundingClientRect(), [
        { label: user.name, detail: user.email, icon: 'home', disabled: true, onClick: () => {} },
        'sep',
        { label: t('account.yourSpace'), icon: 'gear', onClick: () => go('/space') },
        { label: t('account.signOut'), icon: 'unlock', onClick: async () => { await signOut(); go('/'); } },
      ])}>
      <span aria-hidden="true">{initial(user.name)}</span>
    </button>
  );
}
