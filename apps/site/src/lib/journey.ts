/** Progressive enhancement of the film's linear feature sequence. */
export function setupJourney(root: HTMLElement): () => void {
  const panels = [...root.querySelectorAll<HTMLElement>('[data-panel]')];
  const links = [...root.querySelectorAll<HTMLAnchorElement>('[data-step]')];
  const waypoints = [...root.querySelectorAll<HTMLElement>('[data-waypoint]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // A short viewport needs the normal document flow to keep all content reachable.
  const short = matchMedia('(max-height: 620px)');
  let observer: IntersectionObserver | undefined;
  let current = panels[0]?.dataset.panel;
  const activate = (id: string) => {
    if (!panels.some((panel) => panel.dataset.panel === id)) return;
    current = id;
    for (const panel of panels) panel.hidden = panel.dataset.panel !== id;
    for (const link of links) {
      if (link.dataset.step === id) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    }
  };
  const reset = () => {
    observer?.disconnect();
    observer = undefined;
    root.classList.remove('is-enhanced');
    for (const panel of panels) panel.hidden = false;
    for (const link of links) link.removeAttribute('aria-current');
  };
  const sync = () => {
    reset();
    if (reduced.matches || short.matches || typeof IntersectionObserver === 'undefined' || !panels.length) return;
    root.classList.add('is-enhanced');
    activate(current!);
    // Use the viewport height explicitly: percentage root margins can be
    // interpreted against the width by IntersectionObserver implementations.
    const inset = Math.round(window.innerHeight * 0.48);
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) activate((entry.target as HTMLElement).dataset.waypoint!);
      }
    }, { rootMargin: `-${inset}px 0px -${inset}px 0px`, threshold: 0 });
    for (const waypoint of waypoints) observer.observe(waypoint);
  };
  const select = (event: MouseEvent) => {
    if (!observer || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#film-"]');
    const id = target?.hash.slice('#film-'.length);
    const waypoint = waypoints.find((point) => point.dataset.waypoint === id);
    if (!waypoint) return;
    event.preventDefault();
    // Scroll naturally to the waypoint. The observer owns the visible state so
    // crossing intermediate steps during the smooth movement remains consistent.
    activate(id!);
    waypoint.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  // Hero links and the local step links share the same real panel anchors.
  document.addEventListener('click', select);
  reduced.addEventListener('change', sync);
  short.addEventListener('change', sync);
  window.addEventListener('resize', sync);
  sync();
  // A direct URL to a feature should work after the enhancement hides its panel.
  const fromHash = () => {
    if (!observer || !location.hash.startsWith('#film-')) return;
    const id = location.hash.slice('#film-'.length);
    const waypoint = waypoints.find((point) => point.dataset.waypoint === id);
    if (waypoint) {
      activate(id);
      waypoint.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  };
  window.addEventListener('hashchange', fromHash);
  fromHash();
  return () => {
    reset();
    document.removeEventListener('click', select);
    window.removeEventListener('hashchange', fromHash);
    reduced.removeEventListener('change', sync);
    short.removeEventListener('change', sync);
    window.removeEventListener('resize', sync);
  };
}
