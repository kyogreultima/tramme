// Audience measurement in the editor (Google Analytics 4), an option of the
// settings, off until the user turns it on: the app asks nothing by itself.
// On the web it is the page's own tag, loaded only on the production address
// and only after a yes (brand/analytics.ts, shared with the website); locally
// or in beta the option works and is kept, and nothing is counted. In the
// desktop app the page loads nothing of Google's: its Rust side sends the
// events itself (apps/desktop/src-tauri/src/analytics.rs) and keeps the choice.
//
// Only the use of the app is counted: the page seen, never its address's
// details (a project's name, what the home page was given), never a project's
// content, a key or what is said to the assistant.

import { signal } from '@preact/signals';
import { readConsent, setConsent, startAnalytics, trackEvent, type Place } from '../../../brand/analytics.ts';
import { tauri } from './tauri.ts';

/** the choice: false until the user turns the option on */
export const consent = signal(false);

const place = (): Place => window as unknown as Place;

/** call once at the start: sets up the web tag, or reads the desktop app's choice */
export async function startMeasuring(): Promise<void> {
  if (tauri) {
    try {
      const state = await tauri.core.invoke('analytics_state') as { choice: boolean | null };
      consent.value = state.choice === true;
      // the page the app opened on was seen before this answer came
      trackPage(location.pathname);
    } catch { /* an older shell without the command: nothing is measured */ }
    return;
  }
  startAnalytics(place());
  consent.value = readConsent(place()) === true;
}

/** the option, turned on or off */
export async function answerConsent(granted: boolean): Promise<void> {
  if (tauri) await tauri.core.invoke('analytics_set', { granted });
  else setConsent(place(), granted);
  consent.value = granted;
  if (granted) trackPage(location.pathname);
}

export function track(name: string, params: Record<string, string | number | boolean> = {}): void {
  // peek: an effect that counts a page must not run again when the choice changes
  if (!consent.peek()) return;
  if (tauri) void tauri.core.invoke('analytics_event', { name, params }).catch(() => {});
  else trackEvent(place(), name, params);
}

/** a project's page is one page, whatever the project: its address holds its name */
export const pathOnly = (pathname: string): string => (/^\/p\/[^/]+/.test(pathname) ? '/p' : pathname.replace(/\/+$/, '') || '/');

/** a page seen (the title is the app's, never a project's name) */
export const trackPage = (pathname: string): void => track('page_view', { page_path: pathOnly(pathname), page_title: 'Tramme' });
