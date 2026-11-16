// What the preview says when drawing fails. The engine's own sentences name
// limits, sizes and files: they are for the log and the tooltip, never the
// first thing a user reads. A limit being reached gets a calm sentence, the
// rest is shown as it is.

import { t } from './i18n/index.ts';
import { preview } from './preview.ts';

const LIMIT = /exceed|too large|retained|more pictures|budget|out of memory|MB/i;

/** the preview's renderer for a reading the user asked for; while it loads, a plain sentence to show instead */
export function readyRenderer() {
  const r = preview.renderer;
  if (!r) throw new Error(t('viewport.previewLoading'));
  return r;
}

/** the sentence to show for an engine message */
export function plainRenderMessage(raw: string): string {
  return LIMIT.test(raw) ? t('viewport.heavyProject') : raw;
}
