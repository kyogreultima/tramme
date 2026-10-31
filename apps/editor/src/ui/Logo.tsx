// The Tramme logo, drawn from the brand files (brand/svg, the one place it is
// drawn): the mark alone, or the mark and the name. The mark takes the accent of
// the theme, the name the colour of the text around it.

import mark from '../../../../brand/svg/mark-teal.svg';
import logo from '../../../../brand/svg/logo-on-light.svg';

/** the paths of an SVG file, of the class given (the mark) or of every other (the name) */
const pathsOf = (svg: string, cls: string, same: boolean): string =>
  [...svg.matchAll(/<path\b[^>]*?class="([^"]+)"[^>]*?d="([^"]+)"/g)].filter((m) => (m[1] === cls) === same).map((m) => `<path d="${m[2]}"/>`).join('');

const box = (svg: string): string => /viewBox="([\d. ]+)"/.exec(svg)?.[1] ?? '';

// the brand files paint the mark with cls-1 and the name with the others
export const MARK_BOX = box(mark);
export const MARK_PATHS = pathsOf(mark, 'cls-1', true);
const MARK_SHAPES = MARK_PATHS.split('/>').filter(Boolean).map((p) => `${p}/>`);
const LOGO_BOX = box(logo);
const LOGO_PATHS = `<g style="fill:var(--accent)">${pathsOf(logo, 'cls-1', true)}</g>${pathsOf(logo, 'cls-1', false)}`;

export function LogoMark({ size = 18 }: { size?: number }) {
  return <svg class="brand-mark" width={size} height={size} viewBox={MARK_BOX} fill="currentColor" aria-hidden="true" dangerouslySetInnerHTML={{ __html: MARK_PATHS }} />;
}

/** the mark and the name, `size` tall; the name is in the text colour, the mark in the accent */
export function LogoFull({ size = 18 }: { size?: number }) {
  const [, , w, h] = LOGO_BOX.split(' ').map(Number);
  return <svg class="brand-logo" width={size * w / h} height={size} viewBox={LOGO_BOX} fill="currentColor" role="img" aria-label="Tramme" dangerouslySetInnerHTML={{ __html: LOGO_PATHS }} />;
}

/** the top bars' brand: the logo, only its mark where the bar is narrow (atelier.css) */
export function Brand({ size = 18 }: { size?: number }) {
  return <><LogoFull size={size} /><LogoMark size={size} /></>;
}

/** the mark's two shapes coming in one after the other, again and again: what shows while something loads (atelier.css) */
export function Loader({ size = 44 }: { size?: number }) {
  return <svg class="loader" width={size} height={size} viewBox={MARK_BOX} aria-hidden="true" dangerouslySetInnerHTML={{ __html: MARK_SHAPES.join('') }} />;
}
