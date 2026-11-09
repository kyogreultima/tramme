// Clips lined up by their sound, from the timeline's menu: the plan is
// sync-plan.ts; this runs it on the open composition and tells what it could not do.

import { commit, S, toast } from './state.ts';
import { syncPlan } from './sync-plan.ts';
import { t } from './i18n/index.ts';
import { projectAssetUrl } from './project-asset-url.ts';

/** the other clips of the selection moved so that their sound agrees with the first one's; says what it could not do */
export async function syncClips(ids: string[]): Promise<boolean> {
  const doc = S.doc.peek(), compId = S.compId.peek(), docUrl = S.docUrl.peek();
  toast(t('timeline.syncing'), 'info', 1500);
  const { ops, notes } = await syncPlan(doc, compId, ids, (asset) => projectAssetUrl(doc.assets[asset].src, docUrl));
  for (const n of notes) toast(n.kind === 'few' ? t('timeline.syncNeedsTwo') : n.kind === 'nosound' ? t('timeline.syncNoSound', { name: n.clip }) : t('timeline.syncNoMatch', { a: n.a, b: n.b }), 'error');
  return ops.length > 0 && commit(t('timeline.syncBySound'), ops);
}
