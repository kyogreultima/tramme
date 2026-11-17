// What the preview says when drawing fails. The engine's own sentences name
// limits, sizes and files: they are for the log and the tooltip, never the
// first thing a user reads. A limit being reached gets a calm sentence, the
// project's sandbox stopping gets one too, the rest is shown as it is.

import { t } from './i18n/index.ts';
import { preview } from './preview.ts';

const LIMIT = /exceed|too large|retained|more pictures|budget|out of memory|\bMB\b/i;
/** the project's sandbox stopped (a deadline, a crash, a refused message) or never started */
const STOPPED = /sandbox stopped|sandbox is closed|worker did not start|isolated worker failed|timed out after/i;

/** the preview's renderer for a reading the user asked for; while it loads, a plain sentence to show instead */
export function readyRenderer() {
  const r = preview.renderer;
  if (!r) throw new Error(t('viewport.previewLoading'));
  return r;
}

/** the sentence to show for an engine message */
export function plainRenderMessage(raw: string): string {
  if (STOPPED.test(raw)) return t('viewport.sandboxStopped');
  return LIMIT.test(raw) ? t('viewport.heavyProject') : raw;
}
