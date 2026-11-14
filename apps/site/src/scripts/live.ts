// The landing's moving pieces play only while they are on screen: each one
// marked [data-live] gets [data-on] as it comes into view and loses it as it
// leaves, and its CSS animations pause without it (landing.css). A piece that
// runs a script of its own listens for the `live` event ({ on: boolean }).
// Loaded once by every piece that needs it (Astro bundles a script once).

const io = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    const el = target as HTMLElement;
    if (isIntersecting === el.hasAttribute('data-on')) continue;
    el.toggleAttribute('data-on', isIntersecting);
    el.dispatchEvent(new CustomEvent('live', { detail: { on: isIntersecting } }));
  }
}, { rootMargin: '80px 0px' });

// at each page (the router keeps this script loaded)
document.addEventListener('astro:page-load', () => {
  for (const el of document.querySelectorAll<HTMLElement>('[data-live]')) io.observe(el);
});
