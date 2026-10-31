// The theme and the view chosen, read and put on the page. Shared by the
// settings (which keep and change them) and by boot.ts, a script of a few lines
// the page runs before it paints, so a light theme never starts dark. No import
// but types: boot.ts carries what this file does.

/** a theme is one palette; all are dark but the three lights, and system follows the computer */
export type ThemeId = 'system' | 'studio' | 'obsidian' | 'carbon' | 'dusk' | 'paper' | 'linen' | 'porcelain';
/** the studio: the film in front, directed by notes the assistant carries out; the atelier: the layers, the timeline and the inspector, for the detail */
export type View = 'studio' | 'atelier';

export const THEME_IDS: ThemeId[] = ['system', 'studio', 'obsidian', 'carbon', 'dusk', 'paper', 'linen', 'porcelain'];
/** the views, in the order they are offered */
export const VIEWS: View[] = ['studio', 'atelier'];
const DARK_LEGACY: string[] = ['studio', 'obsidian', 'carbon', 'dusk'], LIGHT_LEGACY: string[] = ['paper', 'linen', 'porcelain'];
/** the themes the meta colour-scheme and the system mode resolve to */
export const LIGHT_THEMES: ThemeId[] = ['paper', 'linen', 'porcelain'];
/** the window bar's colour, per theme (system resolves to one of the two) */
export const BAR: Record<string, string> = { studio: '#090f13', obsidian: '#050708', carbon: '#101010', dusk: '#150f0a', paper: '#f0f4f7', linen: '#f7f3ec', porcelain: '#eef2f6' };

/** where the preferences are kept in the browser */
export const PREFERENCES_KEY = 'tramme.preferences';
/** and where they were kept under the tool's earlier name */
export const FORMER_PREFERENCES_KEY = 'emotion.preferences';

export const DEFAULT_THEME: ThemeId = 'studio';
export const DEFAULT_VIEW: View = 'studio';

/** the theme in saved preferences: the one chosen, or what the former mode and per-mode themes mean, else the default */
export function savedTheme(saved: { theme?: unknown; mode?: unknown; lightTheme?: unknown; darkTheme?: unknown }): ThemeId {
  const { theme, mode } = saved;
  if (typeof theme === 'string' && THEME_IDS.includes(theme as ThemeId)) return theme as ThemeId;
  if (mode === 'light') return LIGHT_LEGACY.includes(String(saved.lightTheme)) ? saved.lightTheme as ThemeId : 'paper';
  if (mode === 'dark') return DARK_LEGACY.includes(String(saved.darkTheme)) ? saved.darkTheme as ThemeId : 'studio';
  if (theme === 'dark') return 'studio';
  if (theme === 'light') return 'paper';
  return DEFAULT_THEME;
}

/** the theme and the view on the page: data-theme and data-view on <html>, read by the stylesheet's tokens, and the colours the browser draws (its bar, its scrollbars) */
export function showTheme(doc: Document, chosen: ThemeId, view: View, systemLight: boolean): ThemeId {
  const theme = chosen === 'system' ? (systemLight ? 'paper' : 'studio') : chosen;
  doc.documentElement.dataset.theme = theme;
  doc.documentElement.dataset.view = view;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme] ?? BAR.studio);
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', LIGHT_THEMES.includes(theme) ? 'light' : 'dark');
  return theme;
}
