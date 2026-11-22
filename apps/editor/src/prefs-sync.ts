// The preferences kept with the account. Signed in, the account's preferences
// (GET /api/account/preferences, the accounts backend) are the ones the editor
// uses, on the web as in the apps (which send /api/account to the backend,
// account.rs): a device that signs in finds the theme, the view and the language
// chosen on another one. An account that has none yet takes this device's. Each
// change after that is sent back, a moment later. Signed out, they stay in this
// browser only (settings.ts). The keys of the providers are never among them.

import { effect } from '@preact/signals';
import { account, call } from './accounts.ts';
import { checked, prefs, setPrefs, type Preferences } from './settings.ts';

/** what belongs to this device and stays on it: when it last looked for an update, its launcher, its dictation's source */
const OWN: (keyof Preferences)[] = ['lastUpdateCheck', 'updateNotified', 'checkUpdates', 'quickLauncher', 'dictation', 'dictationPicked'];
/** how long a change waits before it is sent: the sliders send one change, not fifty */
const WAIT = 1500;

/** the preferences as the account keeps them: without what belongs to this device */
export function shared(p: Preferences): Partial<Preferences> {
  const out: Partial<Preferences> = { ...p };
  for (const k of OWN) delete out[k];
  return out;
}

/** the account's preferences over this device's: this device keeps what is its own */
export function merged(here: Preferences, theirs: Partial<Preferences>): Preferences {
  const fromAccount: Partial<Preferences> = { ...theirs };
  for (const k of OWN) delete fromAccount[k];
  return checked({ ...here, ...fromAccount });
}

let syncedFor: string | null = null;
let lastSent = '';
let timer: ReturnType<typeof setTimeout> | null = null;

async function send(p: Preferences) {
  const body = shared(p), text = JSON.stringify(body);
  if (text === lastSent) return;
  const r = await call('PUT', '/api/account/preferences', { preferences: body });
  if (r.ok) lastSent = text;
}

/** signed in: the account's preferences taken once, then every change sent back */
async function syncWith(userId: string) {
  const r = await call<{ preferences: Partial<Preferences> | null }>('GET', '/api/account/preferences');
  // a backend without the route, or out of reach: this device's stay, nothing is sent
  if (!r.ok || syncedFor !== userId) { if (syncedFor === userId) syncedFor = null; return; }
  const theirs = r.data.preferences;
  if (!theirs) { await send(prefs.peek()); return; }
  lastSent = JSON.stringify(shared(checked(theirs)));
  const before = prefs.peek(), next = merged(before, theirs);
  if (JSON.stringify(next) === JSON.stringify(before)) return;
  setPrefs(next);
  // another language: every text follows after a load, as when it is chosen (settings.ts, setLanguage)
  if (next.language !== before.language) location.reload();
}

/** once, at the start of the app */
export function startPrefsSync() {
  effect(() => {
    const state = account.value;
    const id = state.status === 'in' ? state.user.id : null;
    if (id === syncedFor) return;
    syncedFor = id;
    lastSent = '';
    if (id) void syncWith(id);
  });
  effect(() => {
    const p = prefs.value;
    if (!syncedFor || !lastSent) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void send(p); }, WAIT);
  });
}
