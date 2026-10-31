// Run in the page's head before it paints (build.ts inlines it): puts the saved
// theme on the page, so the cover and the first paint are in the colours the
// editor will have, not the default's. settings.ts keeps it from then on.

import { DEFAULT_VIEW, FORMER_PREFERENCES_KEY, PREFERENCES_KEY, savedTheme, showTheme, VIEWS, type View } from './pref.ts';

try {
  const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? localStorage.getItem(FORMER_PREFERENCES_KEY) ?? '{}') as Parameters<typeof savedTheme>[0] & { view?: unknown };
  const view = VIEWS.includes(saved.view as View) ? saved.view as View : DEFAULT_VIEW;
  showTheme(document, savedTheme(saved), view, matchMedia('(prefers-color-scheme: light)').matches);
} catch { /* no storage, no preferences: the default theme, as the stylesheet has it */ }
