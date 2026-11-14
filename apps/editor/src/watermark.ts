// Whether an exported film carries the watermark (the Tramme logo in a
// corner, watermark-draw.ts): always on the Basic plan and without an account
// (a server without accounts, the desktop app before it signs in); on Plus and
// Pro it is on by default and a setting turns it off. The first export that
// carries it says so, once.

import { account, billing } from './accounts.ts';
import { t } from './i18n/index.ts';
import { notify } from './notify.ts';
import { prefs, setPrefs } from './settings.ts';

/** whether the plan lets the watermark be turned off: an account signed in on Plus or Pro */
export async function planFreesWatermark(): Promise<boolean> {
  if (account.peek().status !== 'in') return false;
  const r = await billing().catch(() => null);
  return !!r?.ok && (r.data.plan === 'plus' || r.data.plan === 'pro');
}

/** the rule itself: off only when the plan allows it and the setting turned it off */
export const watermarkOn = (freed: boolean, setting: boolean): boolean => !freed || setting;

/** whether this export carries the watermark; the first one that does tells the user why, once */
export async function watermarkForExport(): Promise<boolean> {
  const freed = await planFreesWatermark(), on = watermarkOn(freed, prefs.peek().watermark);
  if (on && !prefs.peek().watermarkTold) {
    setPrefs({ watermarkTold: true });
    notify(t('export.watermarkTitle'), freed ? t('export.watermarkPaid') : t('export.watermarkBasic'));
  }
  return on;
}
