// Whether an exported film carries the watermark (the Tramme logo in the top
// left corner, watermark-draw.ts): on by default, a setting turns it off.
// Once accounts open, PLANS_ENFORCE_WATERMARK makes it mandatory on the Basic
// plan and without an account; Plus and Pro keep the setting. The first
// export that carries it says so, once.

import { account, billing } from './accounts.ts';
import { t } from './i18n/index.ts';
import { notify } from './notify.ts';
import { prefs, setPrefs } from './settings.ts';

/** whether the plans decide: false until accounts are open to everyone, and then anyone can turn the watermark off */
export const PLANS_ENFORCE_WATERMARK = false;

/** whether the watermark can be turned off: always while the plans do not decide, then only an account signed in on Plus or Pro */
export async function planFreesWatermark(): Promise<boolean> {
  if (!PLANS_ENFORCE_WATERMARK) return true;
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
