/** A small moving reflection, only on glass controls. No render loop, canvas
 * reads or persistent work while idle; preference/theme changes dispose it. */
export function installGlassLight(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win?.matchMedia) return () => {};
  const queries = [win.matchMedia('(pointer: fine)'), win.matchMedia('(prefers-reduced-motion: reduce)'), win.matchMedia('(prefers-reduced-transparency: reduce)')];
  const selector = '.btn:not(.primary, .danger, .danger-solid, .ghost, .outline), .pill, .viewport .toolbar, .direct .composer, .brief-box, .seg button.on';
  let frame = 0, active: HTMLElement | null = null;
  let pending: { element: HTMLElement; x: number; y: number } | null = null;
  const clear = () => {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
    active?.style.removeProperty('--glass-x');
    active?.style.removeProperty('--glass-y');
    active = null;
  };
  const enabled = () => queries[0].matches && !queries[1].matches && !queries[2].matches;
  const move = (event: PointerEvent) => {
    if (!enabled() || event.pointerType !== 'mouse' || event.buttons) { clear(); return; }
    const target = event.target as Element | null;
    const element = target?.closest?.<HTMLElement>(selector);
    if (!element || element.closest(':disabled, [aria-disabled="true"]')) { clear(); return; }
    pending = { element, x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      if (!pending || !pending.element.isConnected) { clear(); return; }
      const { element, x, y } = pending;
      if (active !== element) { active?.style.removeProperty('--glass-x'); active?.style.removeProperty('--glass-y'); }
      active = element;
      const rect = element.getBoundingClientRect();
      const percent = (point: number, origin: number, size: number) => `${Math.round(Math.max(0, Math.min(100, (point - origin) / Math.max(1, size) * 100)))}%`;
      element.style.setProperty('--glass-x', percent(x, rect.left, rect.width));
      element.style.setProperty('--glass-y', percent(y, rect.top, rect.height));
    });
  };
  doc.addEventListener('pointermove', move, { passive: true });
  doc.addEventListener('pointerleave', clear);
  win.addEventListener('blur', clear);
  for (const query of queries) query.addEventListener('change', clear);
  return () => {
    clear();
    doc.removeEventListener('pointermove', move);
    doc.removeEventListener('pointerleave', clear);
    win.removeEventListener('blur', clear);
    for (const query of queries) query.removeEventListener('change', clear);
  };
}
