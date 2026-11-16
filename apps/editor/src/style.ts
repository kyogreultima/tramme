// A style kept to start the next projects with: the palette, the typefaces,
// the tone and the rules of a project's direction, saved in the library's
// styles (/api/styles: on the server, in the account when signed in, in the
// browser or on the device otherwise). A new project is offered it on the home
// screen: the assistant is told to follow it from its first turn.

import type { TrammeDoc } from '@tramme/core';
import type { Brief } from './brief.ts';
import { resolveColor } from './ui/controls.tsx';

export interface Style {
  version: 1;
  kind: 'style';
  name: string;
  /** the palette: token name, colour */
  colors: [string, string][];
  /** the families of the typefaces */
  fonts: string[];
  tone?: string;
  rules?: string[];
}

export const isStyle = (x: unknown): x is Style => !!x && typeof x === 'object' && (x as Style).kind === 'style' && Array.isArray((x as Style).colors);

/** the file a style is kept in: its name made a file name */
export const styleFile = (name: string) => `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'style'}.json`;

/** a project's direction as a style: its colour tokens, its typefaces, its brief's tone and rules */
export function styleOf(name: string, doc: TrammeDoc, brief: Pick<Brief, 'tone' | 'rules'> | null): Style {
  const colors = Object.entries(doc.tokens ?? {}).filter(([, tk]) => tk.type === 'color').map(([k, tk]) => [k, resolveColor(String(tk.value), doc.tokens)] as [string, string]);
  const fonts = [...new Set(Object.values(doc.assets).filter((a) => a.type === 'font').map((a) => String((a as { family?: string }).family ?? a.name ?? '')).filter(Boolean))];
  return { version: 1, kind: 'style', name, colors, fonts, ...(brief?.tone ? { tone: brief.tone } : {}), ...(brief?.rules?.length ? { rules: brief.rules } : {}) };
}

/** what the assistant is told to follow, written into the first message of a project */
export function styleWords(s: Style): string {
  const parts = [`Follow my style "${s.name}" from the start`];
  if (s.colors.length) parts.push(`palette: ${s.colors.map(([k, v]) => `${k} ${v}`).join(', ')} (set them as the project's colour tokens)`);
  if (s.fonts.length) parts.push(`typefaces: ${s.fonts.join(', ')}`);
  if (s.tone) parts.push(`tone: ${s.tone}`);
  if (s.rules?.length) parts.push(`rules: ${s.rules.join('; ')}`);
  return `${parts.join('. ')}.`;
}

export async function saveStyle(s: Style): Promise<void> {
  const r = await fetch(`/api/styles/${encodeURIComponent(styleFile(s.name))}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s) });
  if (!r.ok) throw new Error(`the style could not be kept (HTTP ${r.status})`);
}

/** the styles kept, by file; none when this place keeps no styles */
export async function listStyles(): Promise<string[]> {
  try {
    const r = await fetch('/api/styles', { cache: 'no-store' });
    return r.ok ? ((await r.json()) as { name: string }[]).map((x) => x.name) : [];
  } catch { return []; }
}

export async function readStyle(file: string): Promise<Style | null> {
  try {
    const r = await fetch(`/api/styles/${encodeURIComponent(file)}`, { cache: 'no-store' });
    const s: unknown = r.ok ? await r.json() : null;
    return isStyle(s) ? s : null;
  } catch { return null; }
}
