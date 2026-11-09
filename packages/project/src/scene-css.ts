// What a web scene is given besides its own files: the project's tokens as CSS variables, its
// fonts as @font-face rules, and the style placed first in its head. Pure, so the export (which
// serves files) and the editor's preview (which inlines them) say the same thing.

// Structural types, not the core's: this package also builds for the worker, which has no DOM types.
type Tokens = Record<string, { type: string; value: unknown }>;
type Assets = Record<string, { type: string; src: string; family?: string; weight?: string; style?: string }>;

const NUMBER = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const SAFE_CSS = /^[^;{}<>\\\n]{1,200}$/;

/** the project's tokens as CSS custom properties (--name), so a scene draws with the project's palette, curves and numbers; a value that is not plain data is left out */
export function tokenCss(tokens: Tokens | undefined): string {
  const lines: string[] = [];
  for (const [name, token] of Object.entries(tokens ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(name)) continue;
    const v = token.value;
    let css: string | null = null;
    if (token.type === 'color' && typeof v === 'string' && SAFE_CSS.test(v)) css = v;
    else if (token.type === 'number' && NUMBER(v)) css = String(v);
    else if (token.type === 'string' && typeof v === 'string' && v.length <= 200) css = JSON.stringify(v).replaceAll('<', '\\3c ');
    else if (token.type === 'ease' && Array.isArray(v) && v.length === 4 && v.every(NUMBER)) css = `cubic-bezier(${v.join(', ')})`;
    else if (token.type === 'vec2' && Array.isArray(v) && v.length === 2 && v.every(NUMBER)) css = v.join(' ');
    if (css !== null) lines.push(`  --${name}: ${css};`);
  }
  return lines.length ? `:root {\n${lines.join('\n')}\n}` : '';
}

/** the scene's HTML with the token style first in its head (or at its start), so the scene's own styles can read and override it */
export function injectCss(html: string, css: string): string {
  if (!css) return html;
  const style = `<style id="tramme-tokens">${css}</style>`;
  const head = /<head[^>]*>/i.exec(html);
  return head ? html.slice(0, head.index + head[0].length) + style + html.slice(head.index + head[0].length) : style + html;
}

export const isAssetFile = (file: string) => file.startsWith('assets/') && !file.split('/').some((part) => part === '' || part === '.' || part === '..') && !/[\\:]/.test(file);

/** @font-face rules for the document's font assets; `urlOf` says where a font is read from (the project's /assets/ by default) */
export function fontFaceCss(assets: Assets | undefined, urlOf: (src: string) => string | null = (src) => `/${encodeURI(src)}`): string {
  const rules: string[] = [];
  for (const asset of Object.values(assets ?? {})) {
    if (asset.type !== 'font' || !asset.family || !/^[\w .-]{1,64}$/.test(asset.family) || !isAssetFile(asset.src)) continue;
    const weight = asset.weight && /^\d{1,4}( \d{1,4})?$/.test(asset.weight) ? asset.weight : '400';
    const style = asset.style === 'italic' ? 'italic' : 'normal';
    const url = urlOf(asset.src);
    if (url) rules.push(`@font-face { font-family: "${asset.family}"; src: url("${url}"); font-weight: ${weight}; font-style: ${style}; font-display: block; }`);
  }
  return rules.join('\n');
}

