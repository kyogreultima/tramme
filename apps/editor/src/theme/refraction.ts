/** Liquid Glass bends what is behind it. Chromium lets `backdrop-filter` take an
 * SVG filter, so each floating surface gets a displacement map sized to itself:
 * at the rim the backdrop is read from further inside, per colour channel by a
 * slightly different amount (the rainbow fringe of a thick lens). The middle of
 * the surface is left untouched. Other engines keep the frosted look, which the
 * theme's stylesheet already carries. Nothing runs while idle: maps are drawn
 * when a surface appears or changes size, then cached by size. */

/** the surfaces that refract: floating ones, a handful on screen at once */
export const LENS_SELECTOR = '.pill, .viewport .toolbar, .direct .composer, .brief-box, .graph-side, .graph-presets, .command-menu, .menu, .popover, .toast';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** the widest the bend reaches inward from the rim, in px */
const BEZEL = 44;
/** the farthest a backdrop pixel is read from, relative to the rim's width */
const REACH = 1.1;
/** how much less the green and blue channels bend than the red one */
const FRINGE = [1, 0.93, 0.86];
const MAX_LENSES = 48;

/** the width of the bend for a surface of this size */
export const bezelOf = (width: number, height: number) => Math.max(0, Math.min(BEZEL, Math.min(width, height) * 0.42));

/** Displacement map of a rounded rectangle: R and G hold the inward direction
 * scaled by the bend, 128 meaning no move; B stays 128, A is opaque. The bend
 * is strongest on the rim and eases to nothing at the bezel's inner edge. */
export function refractionMap(width: number, height: number, radius: number, bezel = bezelOf(width, height)): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  const cx = width / 2, cy = height / 2, r = Math.max(0, Math.min(radius, cx, cy));
  const hx = cx - r, hy = cy - r;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const px = x + 0.5 - cx, py = y + 0.5 - cy;
      const qx = Math.abs(px) - hx, qy = Math.abs(py) - hy;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), len = Math.hypot(ox, oy);
      const inside = r - (len + Math.min(Math.max(qx, qy), 0));
      let dx = 0, dy = 0;
      if (bezel > 0 && inside > 0 && inside < bezel) {
        const t = 1 - inside / bezel;
        const bend = Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
        // outward normal of the shape, then flipped to read from the inside
        let nx: number, ny: number;
        if (len > 0) { nx = ox / len; ny = oy / len; } else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
        dx = -Math.sign(px || 1) * nx * bend;
        dy = -Math.sign(py || 1) * ny * bend;
      }
      out[i] = Math.round(128 + dx * 127);
      out[i + 1] = Math.round(128 + dy * 127);
      out[i + 2] = 128;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** The filter element of one lens size: the map, three channel displacements, put back together. */
function lensFilter(doc: Document, id: string, width: number, height: number, href: string, bezel: number): SVGFilterElement {
  const make = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) => {
    const node = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  const filter = make('filter', { id, x: 0, y: 0, width, height, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
  const image = make('feImage', { href, x: 0, y: 0, width, height, preserveAspectRatio: 'none', result: 'map' });
  filter.append(image);
  const peak = bezel * REACH * 2;
  const keep = ['1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'];
  FRINGE.forEach((amount, channel) => {
    filter.append(
      make('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: (peak * amount).toFixed(2), xChannelSelector: 'R', yChannelSelector: 'G', result: `d${channel}` }),
      make('feColorMatrix', { in: `d${channel}`, type: 'matrix', values: keep[channel], result: `c${channel}` }),
    );
  });
  filter.append(
    make('feBlend', { in: 'c0', in2: 'c1', mode: 'screen', result: 'rg' }),
    make('feBlend', { in: 'rg', in2: 'c2', mode: 'screen' }),
  );
  return filter;
}

/** Chromium alone draws SVG filters in backdrop-filter, and says so. */
export function canRefract(win: Window & typeof globalThis): boolean {
  const brands = (win.navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  return !!brands?.some((b) => b.brand === 'Chromium') && typeof win.ResizeObserver === 'function';
}

/** Start refracting the surfaces; the returned function stops it and takes everything it added away. */
export function installRefraction(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win || !canRefract(win)) return () => {};
  const canvas = doc.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return () => {};

  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
  const defs = doc.createElementNS(SVG_NS, 'defs');
  svg.append(defs);
  doc.body.append(svg);
  doc.documentElement.dataset.refraction = '';

  const maps = new Map<string, string>();
  const watched = new Set<HTMLElement>();

  const mapUrl = (width: number, height: number, radius: number) => {
    // a big surface needs no pixel-sharp map: the filter stretches it
    const shrink = Math.max(1, Math.ceil(Math.max(width, height) / 360));
    const w = Math.max(1, Math.round(width / shrink)), h = Math.max(1, Math.round(height / shrink));
    canvas.width = w;
    canvas.height = h;
    const pixels = refractionMap(w, h, radius / shrink, bezelOf(width, height) / shrink);
    context.putImageData(new ImageData(pixels, w, h), 0, 0);
    return canvas.toDataURL('image/png');
  };

  const prune = () => {
    if (defs.childElementCount <= MAX_LENSES) return;
    const used = new Set(Array.from(doc.querySelectorAll<HTMLElement>('[data-glass-lens]'), (el) => el.dataset.glassLens));
    for (const filter of Array.from(defs.children)) if (!used.has(filter.id)) { maps.delete(filter.id); filter.remove(); }
  };

  const fit = (element: HTMLElement) => {
    if (!element.isConnected) { watched.delete(element); observer.unobserve(element); return; }
    const rect = element.getBoundingClientRect();
    const width = Math.round(element.offsetWidth || rect.width), height = Math.round(element.offsetHeight || rect.height);
    if (width < 8 || height < 8) return;
    const radius = Math.round(parseFloat(win.getComputedStyle(element).borderTopLeftRadius) || 0);
    const id = `lg-${width}x${height}r${radius}`;
    if (!maps.has(id)) {
      const href = mapUrl(width, height, radius);
      maps.set(id, href);
      defs.append(lensFilter(doc, id, width, height, href, bezelOf(width, height)));
    }
    if (element.dataset.glassLens !== id) {
      element.dataset.glassLens = id;
      element.style.setProperty('--glass-refract', `url(#${id})`);
      prune();
    }
  };

  const observer = new win.ResizeObserver((entries) => { for (const entry of entries) fit(entry.target as HTMLElement); });
  let frame = 0;
  const scan = () => {
    frame = 0;
    for (const element of doc.querySelectorAll<HTMLElement>(LENS_SELECTOR)) {
      if (watched.has(element)) continue;
      watched.add(element);
      observer.observe(element);
    }
  };
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(scan); };
  const mutations = new win.MutationObserver(schedule);
  mutations.observe(doc.body, { childList: true, subtree: true });
  scan();

  return () => {
    if (frame) win.cancelAnimationFrame(frame);
    mutations.disconnect();
    observer.disconnect();
    for (const element of watched) { delete element.dataset.glassLens; element.style.removeProperty('--glass-refract'); }
    watched.clear();
    svg.remove();
    delete doc.documentElement.dataset.refraction;
  };
}
