// What the preview says when drawing fails. The engine's own sentences name
// limits, sizes and files: they are for the log and the tooltip, never the
// first thing a user reads. A limit being reached gets a calm sentence, the
// rest is shown as it is.

import { t } from './i18n/index.ts';

const LIMIT = /exceed|too large|retained|more pictures|budget|out of memory|MB/i;

/** the sentence to show for an engine message */
export function plainRenderMessage(raw: string): string {
  return LIMIT.test(raw) ? t('viewport.heavyProject') : raw;
}
