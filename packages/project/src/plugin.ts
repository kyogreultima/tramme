// An installed plugin read without running it (docs/installed-plugins-roadmap.md,
// steps 2 and 7): its manifest from the `meta` literal of its text (a small
// parser of plain data: no code is evaluated), what it brings from its
// exports, its permissions and what changed in them; the package that
// carries more than code (`.trammeplugin`: a zip of the module and its own
// files); and the one file every installed plugin is backed up in.

import { unzipSync, zipSync, type Zippable } from 'fflate';

/** what an installed plugin may reach (the core's PluginPermissions, kept here so the Worker's build needs no DOM types) */
interface PluginPermissions { network?: string[]; providers?: string[]; files?: string[] }
/** the fields of a plugin's meta this file reads */
interface PluginMeta { id?: string; name?: string; version?: string; description?: string; api?: number; licence?: string; author?: string; homepage?: string; permissions?: PluginPermissions }
import { kindsOf } from './code.ts';

/** what an installed plugin is, as the settings show it and the install question asks */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  api: number;
  description?: string;
  licence?: string;
  author?: string;
  homepage?: string;
  permissions: Required<PluginPermissions>;
  /** what it brings: nodes, effects, modifiers, tools, prompts, checks, kits, presets, tours */
  kinds: string[];
}

/** the parse of a literal of plain data (strings, numbers, booleans, null, arrays, objects with plain keys), or undefined */
function literal(src: string, at: number): { value: unknown; end: number } | undefined {
  let i = at;
  const ws = () => { for (;;) { while (/\s/.test(src[i] ?? '')) i++; if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; } if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; } break; } };
  const value = (): unknown => {
    ws();
    const c = src[i];
    if (c === '{') {
      i++;
      const o: Record<string, unknown> = {};
      for (;;) {
        ws();
        if (src[i] === '}') { i++; return o; }
        let key: string;
        if (src[i] === '"' || src[i] === "'") key = String(value());
        else { const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i)); if (!m) throw new Error('key'); key = m[0]; i += key.length; }
        ws();
        if (src[i] !== ':') throw new Error(':');
        i++;
        o[key] = value();
        ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === '}') { i++; return o; }
        throw new Error('}');
      }
    }
    if (c === '[') {
      i++;
      const a: unknown[] = [];
      for (;;) {
        ws();
        if (src[i] === ']') { i++; return a; }
        a.push(value());
        ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === ']') { i++; return a; }
        throw new Error(']');
      }
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let out = '';
      i++;
      while (i < src.length && src[i] !== q) {
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') throw new Error('template');
        if (src[i] === '\\') { const n = src[i + 1]; out += n === 'n' ? '\n' : n === 't' ? '\t' : n; i += 2; } else out += src[i++];
      }
      i++;
      return out;
    }
    const m = /^(-?\d+(\.\d+)?(e[+-]?\d+)?|true|false|null)/.exec(src.slice(i));
    if (!m) throw new Error('value');
    i += m[0].length;
    return m[0] === 'true' ? true : m[0] === 'false' ? false : m[0] === 'null' ? null : Number(m[0]);
  };
  try { const v = value(); return { value: v, end: i }; } catch { return undefined; }
}

/** the `meta` a module exports, read from its text when it is plain data; {} otherwise (it is then known only once loaded, in the sandbox) */
export function metaOfText(source: string): PluginMeta {
  const m = /export\s+(?:const|let|var)\s+meta\s*(?::[^=]+)?=\s*/.exec(source);
  if (!m) return {};
  const v = literal(source, m.index + m[0].length)?.value;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as PluginMeta) : {};
}

const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin';

/** a manifest from a module's text and its file name: missing fields as today's plugins leave them (an id from the name, version 0.0.0, API 1, no permission) */
export function manifestOf(source: string, file: string): PluginManifest {
  const meta = metaOfText(source), stem = file.replace(/\.(js|mjs|trammeplugin)$/i, '');
  const name = typeof meta.name === 'string' && meta.name ? meta.name : stem;
  const p = (meta.permissions ?? {}) as PluginPermissions;
  return {
    id: typeof meta.id === 'string' && /^[\w.-]+\/[\w.-]+$/.test(meta.id) ? meta.id : `local/${slug(name)}`,
    name, version: typeof meta.version === 'string' && meta.version ? meta.version : '0.0.0', api: typeof meta.api === 'number' ? meta.api : 1,
    ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
    ...(typeof meta.licence === 'string' ? { licence: meta.licence } : {}),
    ...(typeof meta.author === 'string' ? { author: meta.author } : {}),
    ...(typeof meta.homepage === 'string' ? { homepage: meta.homepage } : {}),
    permissions: { network: list(p.network), providers: list(p.providers), files: list(p.files) },
    kinds: kindsOf(source),
  };
}

/** what an update adds to the permissions (an empty list for each when it asks nothing more) */
export function permissionsAdded(before: PluginManifest['permissions'], after: PluginManifest['permissions']): PluginManifest['permissions'] {
  const more = (a: string[], b: string[]) => b.filter((x) => !a.includes(x));
  return { network: more(before.network, after.network), providers: more(before.providers, after.providers), files: more(before.files, after.files) };
}

export const asksMore = (p: PluginManifest['permissions']) => p.network.length + p.providers.length + p.files.length > 0;

/** semver compared: <0, 0, >0 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0), pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

// ── the package ─────────────────────────────────────────────

/** a plugin's package: its module, and its own files (translations, icons, fonts, LUTs, pictures, sounds) by path */
export interface PluginPackage { module: string; files: Map<string, Uint8Array> }

const PACKAGE_LIMIT = 64 * 1024 * 1024;
const safePath = (p: string) => !!p && !p.startsWith('/') && !p.split('/').some((s) => s === '..' || s === '') && !/[\\:*?"<>|]/.test(p);

/** a .trammeplugin read and checked: its module (`plugin.js`, or its only .js at the top), its files under safe paths, not too large */
export function readPluginPackage(zip: Uint8Array): PluginPackage {
  if (zip.byteLength > PACKAGE_LIMIT) throw new Error('plugin package too large');
  if (zip[0] !== 0x50 || zip[1] !== 0x4b) throw new Error('this file is not a .trammeplugin package (zip)');
  let total = 0;
  const raw = unzipSync(zip, { filter: (f) => { total += f.originalSize; if (total > PACKAGE_LIMIT * 2) throw new Error(`entry too large: ${f.name}`); return !f.name.endsWith('/'); } });
  const files = new Map<string, Uint8Array>();
  for (const [p, d] of Object.entries(raw)) { if (!safePath(p)) throw new Error(`unsafe path in the package: ${p}`); files.set(p, d); }
  const tops = [...files.keys()].filter((p) => !p.includes('/') && /\.m?js$/.test(p));
  const entry = files.has('plugin.js') ? 'plugin.js' : tops.length === 1 ? tops[0] : null;
  if (!entry) throw new Error('the package has no plugin.js');
  const module = new TextDecoder().decode(files.get(entry));
  files.delete(entry);
  return { module, files };
}

export function writePluginPackage(p: PluginPackage): Uint8Array {
  const entries: Zippable = { 'plugin.js': new TextEncoder().encode(p.module) };
  for (const [k, v] of p.files) entries[k] = v;
  return zipSync(entries);
}

// ── the backup of every installed plugin ─────────────────────

/** what the backup keeps beside the files: the plugins turned off on this device */
export interface InstalledState { version: 1; disabled: string[] }

/** every installed plugin's files (by their name in the storage) and their state, as one zip */
export function packInstalled(files: Map<string, Uint8Array>, state: InstalledState): Uint8Array {
  const entries: Zippable = { 'installed.json': new TextEncoder().encode(JSON.stringify(state)) };
  for (const [k, v] of files) entries[`plugins/${k}`] = v;
  return zipSync(entries);
}

export function unpackInstalled(zip: Uint8Array): { files: Map<string, Uint8Array>; state: InstalledState } {
  if (zip[0] !== 0x50 || zip[1] !== 0x4b) throw new Error('this file is not a backup of plugins (zip)');
  const raw = unzipSync(zip);
  const files = new Map<string, Uint8Array>();
  for (const [p, d] of Object.entries(raw)) if (p.startsWith('plugins/') && /^[a-z0-9][a-z0-9_-]{0,62}\.(js|mjs)$/.test(p.slice(8))) files.set(p.slice(8), d);
  let state: InstalledState = { version: 1, disabled: [] };
  try { const s = JSON.parse(new TextDecoder().decode(raw['installed.json'])); if (Array.isArray(s?.disabled)) state = { version: 1, disabled: s.disabled.filter((x: unknown) => typeof x === 'string') }; } catch { /* the files alone */ }
  return { files, state };
}
