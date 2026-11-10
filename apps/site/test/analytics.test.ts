import { describe, expect, it } from 'vitest';
import { CONSENT_KEY, MEASURED_HOSTS, MEASUREMENT_ID, consentPending, isMeasured, readConsent, setConsent, startAnalytics, trackEvent, trackPage, type Place } from '../../../brand/analytics';
import { ENVIRONMENTS } from '../../../brand/environments';

/** a page, with its storage and the scripts it was given */
function page(hostname: string, stored?: string) {
  const store = new Map<string, string>(stored === undefined ? [] : [[CONSENT_KEY, stored]]);
  const scripts: { src: string; async: boolean }[] = [];
  const place: Place = {
    location: { hostname },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    document: { head: { appendChild: (n) => scripts.push(n as { src: string; async: boolean }) }, createElement: () => ({ async: false, src: '' }) },
    dispatchEvent: () => true,
  };
  return { place, scripts, store };
}
const sent = (place: Place) => (place.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));

describe('audience measurement', () => {
  it('measures the production site and app, and nothing else', () => {
    expect(MEASURED_HOSTS).toEqual(['tramme.dev', 'www.tramme.dev', 'app.tramme.dev', 'www.app.tramme.dev']);
    for (const host of ['localhost', '127.0.0.1', 'tramme-site.workers.dev', 'tauri.localhost']) expect(isMeasured(host), host).toBe(false);
    expect(isMeasured(new URL(ENVIRONMENTS.beta.site).hostname)).toBe(false);
    expect(isMeasured(new URL(ENVIRONMENTS.beta.app).hostname)).toBe(false);
    expect(isMeasured(new URL(ENVIRONMENTS.local.app).hostname)).toBe(false);
  });

  it('asks locally, so the banner can be seen, but loads and counts nothing', () => {
    const { place, scripts, store } = page('localhost');
    expect(startAnalytics(place)).toBe(false);
    expect(consentPending(place)).toBe(true);
    setConsent(place, true);
    expect(consentPending(place)).toBe(false);
    expect(JSON.parse(store.get(CONSENT_KEY)!).analytics).toBe(true);
    expect(trackEvent(place, 'x')).toBe(false);
    expect(trackPage(place, '/', 'Tramme')).toBe(false);
    expect(place.gtag).toBeUndefined();
    expect(scripts).toEqual([]);
  });

  it('asks, and loads nothing of Google, until the visitor says yes', () => {
    const { place, scripts } = page('tramme.dev');
    expect(consentPending(place)).toBe(true);
    expect(startAnalytics(place)).toBe(true);
    expect(scripts).toEqual([]);
    expect(sent(place)[0]).toEqual(['consent', 'default', expect.objectContaining({ analytics_storage: 'denied' })]);
    expect(trackPage(place, '/', 'Tramme')).toBe(false);
  });

  it('loads the tag and counts after a yes, never advertising', () => {
    const { place, scripts, store } = page('tramme.dev');
    startAnalytics(place);
    setConsent(place, true);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`);
    expect(JSON.parse(store.get(CONSENT_KEY)!).analytics).toBe(true);
    expect(trackPage(place, '/pricing/', 'Pricing')).toBe(true);
    const calls = sent(place);
    expect(calls).toContainEqual(['consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
    expect(calls.at(-1)).toEqual(['event', 'page_view', { page_path: '/pricing/', page_title: 'Pricing' }]);
    expect(consentPending(place)).toBe(false);
  });

  it('stops counting after a no, and remembers it', () => {
    const { place } = page('app.tramme.dev', JSON.stringify({ analytics: true }));
    startAnalytics(place);
    setConsent(place, false);
    expect(readConsent(place)).toBe(false);
    expect(trackEvent(place, 'export')).toBe(false);
    expect(sent(place).at(-1)).toEqual(['consent', 'update', expect.objectContaining({ analytics_storage: 'denied' })]);
  });

  it('reads a damaged choice as no choice', () => {
    for (const raw of ['{', '"yes"', '{"analytics":"yes"}', '']) expect(readConsent(page('tramme.dev', raw).place), raw).toBeUndefined();
  });
});
