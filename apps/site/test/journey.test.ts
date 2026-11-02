// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupJourney } from '../src/lib/journey';

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

function fixture(reduced = false) {
  document.body.innerHTML = `<section data-journey><div data-track><div data-sticky>
    <nav>${['studio', 'editor', 'assistant'].map((id) => `<a data-step="${id}" href="#film-${id}">${id}</a>`).join('')}</nav>
    ${['studio', 'editor', 'assistant'].map((id) => `<article id="film-${id}" data-panel="${id}"><a href="/features/#${id}">More</a></article>`).join('')}
    </div><div data-waypoints>${['studio', 'editor', 'assistant'].map((id) => `<div data-waypoint="${id}"></div>`).join('')}</div></div></section>`;
  let notify: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe = vi.fn(); disconnect = disconnect;
  });
  const media = Object.assign(new EventTarget(), { matches: reduced });
  vi.stubGlobal('matchMedia', () => media);
  const root = document.querySelector<HTMLElement>('[data-journey]')!;
  return { root, media, disconnect, enter: (id: string) => notify!([{ target: root.querySelector(`[data-waypoint="${id}"]`)!, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) };
}

describe('the film journey', () => {
  it('shows the matching picture and marks the current step when scrolling in either direction', () => {
    const f = fixture();
    const cleanup = setupJourney(f.root);
    for (const id of ['studio', 'editor', 'assistant', 'editor', 'studio']) {
      f.enter(id);
      expect([...f.root.querySelectorAll<HTMLElement>('[data-panel]')].filter((p) => !p.hidden).map((p) => p.dataset.panel)).toEqual([id]);
      expect(f.root.querySelector('[aria-current="step"]')?.getAttribute('data-step')).toBe(id);
    }
    cleanup();
    expect(f.disconnect).toHaveBeenCalled();
    expect(f.root.querySelectorAll('[hidden]')).toHaveLength(0);
  });

  it('direct selection scrolls to the corresponding waypoint', () => {
    const f = fixture();
    const scroll = vi.fn();
    f.root.querySelector('[data-waypoint="assistant"]')!.scrollIntoView = scroll;
    const cleanup = setupJourney(f.root);
    f.root.querySelector<HTMLAnchorElement>('[data-step="assistant"]')!.click();
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(f.root.querySelector('[aria-current="step"]')?.getAttribute('data-step')).toBe('assistant');
    cleanup();
  });

  it('keeps the current step when resizing and continues observing the next step', () => {
    const f = fixture();
    const cleanup = setupJourney(f.root);
    f.enter('editor');
    window.dispatchEvent(new Event('resize'));
    expect(f.root.querySelector('[aria-current="step"]')?.getAttribute('data-step')).toBe('editor');
    f.enter('assistant');
    expect(f.root.querySelector('[aria-current="step"]')?.getAttribute('data-step')).toBe('assistant');
    cleanup();
  });

  it('leaves the linear content readable when IntersectionObserver is unavailable', () => {
    const f = fixture();
    vi.stubGlobal('IntersectionObserver', undefined);
    const cleanup = setupJourney(f.root);
    expect(f.root.classList.contains('is-enhanced')).toBe(false);
    expect(f.root.querySelectorAll('[hidden]')).toHaveLength(0);
    cleanup();
  });

  it('keeps every picture readable with reduced motion, including a preference changed during the visit', () => {
    const f = fixture(true);
    const cleanup = setupJourney(f.root);
    expect(f.root.classList.contains('is-enhanced')).toBe(false);
    expect(f.root.querySelectorAll('[hidden]')).toHaveLength(0);
    f.media.matches = false; f.media.dispatchEvent(new Event('change'));
    expect(f.root.classList.contains('is-enhanced')).toBe(true);
    f.media.matches = true; f.media.dispatchEvent(new Event('change'));
    expect(f.root.querySelectorAll('[hidden]')).toHaveLength(0);
    expect(f.root.classList.contains('is-enhanced')).toBe(false);
    cleanup();
  });
});
