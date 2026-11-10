// Audience measurement (Google Analytics 4), written once for the website and
// the web app. It is opt-in and only counts where Tramme really is:
//
//   - only on the production addresses (brand/environments.ts) is anything
//     loaded or sent. Locally, in beta, on a preview or an unknown address the
//     choice can still be made and is kept (the banner and the setting look
//     the same everywhere), but nothing of Google's is fetched and nothing is
//     counted: a test must never count as a visitor;
//   - nothing from Google is fetched before the visitor accepts. Google's
//     "consent mode" is set to denied at the start, granted by a yes, denied
//     again by a no or by a withdrawn choice;
//   - the choice is kept in the browser of the address it was made on (the
//     site and the app are two origins: each asks once).
//
// The desktop app has its own, apps/desktop/src-tauri/src/analytics.rs.

import { ENVIRONMENTS } from './environments.ts';

export const MEASUREMENT_ID = 'G-PKYW052XVH';
export const CONSENT_KEY = 'tramme-analytics-consent';
/** dispatched on the window when the choice changes; `detail.granted` says which way */
export const CONSENT_EVENT = 'tramme:analytics-consent';

/** the hostnames that are measured: the production site and app, with and without www */
const hostOf = (url: string) => new URL(url).hostname;
export const MEASURED_HOSTS: readonly string[] = [ENVIRONMENTS.production.site, ENVIRONMENTS.production.app].flatMap((url) => [hostOf(url), `www.${hostOf(url)}`]);

export const isMeasured = (hostname: string): boolean => MEASURED_HOSTS.includes(hostname);

/** the part of the browser this module touches, so that it runs (and is tested) without one */
export interface Place {
  location: { hostname: string };
  localStorage?: Pick<Storage, 'getItem' | 'setItem'>;
  document?: {
    head: { appendChild: (node: unknown) => unknown };
    createElement: (tag: string) => { async: boolean; src: string };
  };
  dispatchEvent?: (event: Event) => boolean;
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

/** what the visitor chose: true, false, or undefined while they have not */
export function readConsent(place: Place): boolean | undefined {
  try {
    const raw = place.localStorage?.getItem(CONSENT_KEY);
    if (!raw) return undefined;
    const choice = (JSON.parse(raw) as { analytics?: unknown } | null)?.analytics;
    return typeof choice === 'boolean' ? choice : undefined;
  } catch {
    return undefined;
  }
}

/** a choice is to be asked for: the visitor has not chosen (wherever the site runs, so that its banner can be seen) */
export const consentPending = (place: Place): boolean => readConsent(place) === undefined;

let loaded = false;

function load(place: Place) {
  if (loaded || !place.document) return;
  loaded = true;
  const script = place.document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  place.document.head.appendChild(script);
}

const consentState = (granted: boolean) => ({
  analytics_storage: granted ? 'granted' : 'denied',
  // no advertising, ever: only the audience is measured
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
});

/** call once per page load: sets the consent mode and, if the visitor already said yes, loads Google's script. False where nothing is measured. */
export function startAnalytics(place: Place): boolean {
  if (!isMeasured(place.location.hostname)) return false;
  place.dataLayer = place.dataLayer || [];
  // Google's tag reads `arguments` objects from the data layer, not arrays
  place.gtag = function gtag() { place.dataLayer!.push(arguments); };
  const granted = readConsent(place) === true;
  place.gtag('consent', 'default', consentState(granted));
  place.gtag('js', new Date());
  // the pages are counted by `trackPage`, also on the changes that do not reload
  place.gtag('config', MEASUREMENT_ID, { send_page_view: false });
  if (granted) load(place);
  return true;
}

/** the visitor's yes or no: kept, applied to Google's consent mode (started on a measured address only), and announced */
export function setConsent(place: Place, granted: boolean): void {
  try {
    place.localStorage?.setItem(CONSENT_KEY, JSON.stringify({ analytics: granted, at: new Date().toISOString() }));
  } catch { /* storage blocked: the choice holds for this page only */ }
  place.gtag?.('consent', 'update', consentState(granted));
  if (granted && place.gtag) load(place);
  place.dispatchEvent?.(new CustomEvent(CONSENT_EVENT, { detail: { granted } }));
}

/** an event, if the visitor said yes (consent mode would drop it otherwise) */
export function trackEvent(place: Place, name: string, params: Record<string, string | number | boolean> = {}): boolean {
  if (!isMeasured(place.location.hostname) || readConsent(place) !== true || typeof place.gtag !== 'function') return false;
  place.gtag('event', name, params);
  return true;
}

/** a page seen: the address and title, for a page that changed without a reload as for a loaded one */
export const trackPage = (place: Place, path: string, title: string): boolean => trackEvent(place, 'page_view', { page_path: path, page_title: title });
