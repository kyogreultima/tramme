// The shipped packs (plugins/index.json, docs/packs-roadmap.md): what each
// one brings, how a project that holds none of them still reaches it through
// the assistant, and the data files a pack reads beside itself. A pack is an
// ordinary plugin; the editor adds it to a project from the Code section, and
// the assistant reaches it the way an installed plugin is reached
// (attachInstalled), copied into the project the first time a proposal draws
// with one of its nodes — a pack whose tools only write ordinary layers is
// never copied. A pack's own data (an icon set, map shapes) stays beside it
// in the editor: its tools read it at authoring time with ctx.packFile, and
// only what they used is written into the project.

import type { ToolContext, TrammeDoc } from '@tramme/core';
import { compareVersions, manifestOf } from '@tramme/project';
import type { Command } from './ai/commands.ts';
import { addMessages } from './i18n/index.ts';
import type { Installed } from './installed.ts';
import { readLimitedBody } from './plugins/host.ts';

export interface PackCommand { name: string; title: string; description: string }

export interface PackEntry {
  file: string;
  name: string;
  description?: string;
  /** the data files beside the module (plugins/<pack>/…), read with ctx.packFile */
  data?: string[];
  /** the version the module declares (the index carries it): a project's older copy is offered the update */
  version?: string;
  /** the pack's tools as the / menu lists them, generated from the modules by scripts/packs/index.ts */
  commands?: PackCommand[];
  /** what each of the pack's nodes, effects and tools is for, one line each, generated with the commands */
  entries?: { name: string; kind: 'node' | 'tool' | 'effect'; line: string }[];
  /** the French of those commands' titles and descriptions */
  fr?: Record<string, string>;
}

let cache: PackEntry[] | null = null;
const packModule = (file: unknown): file is string => typeof file === 'string' && /^[a-zA-Z0-9_-]+\.m?js$/.test(file);
const packIndex = (value: unknown): value is PackEntry[] => Array.isArray(value) && value.length <= 64 && value.every((pack) =>
  pack && typeof pack === 'object' && packModule(pack.file) && typeof pack.name === 'string' && pack.name.length <= 128 &&
  (pack.data === undefined || (Array.isArray(pack.data) && pack.data.length <= 512 && pack.data.every((path: unknown) => typeof path === 'string' && path.length <= 512))) &&
  (pack.commands === undefined || (Array.isArray(pack.commands) && pack.commands.length <= 128 && pack.commands.every((command: PackCommand) =>
    command && typeof command.name === 'string' && typeof command.title === 'string' && typeof command.description === 'string'))) &&
  (pack.entries === undefined || (Array.isArray(pack.entries) && pack.entries.length <= 256 && pack.entries.every((entry: NonNullable<PackEntry['entries']>[number]) =>
    entry && typeof entry.name === 'string' && typeof entry.line === 'string' && ['node', 'tool', 'effect'].includes(entry.kind)))) &&
  (pack.fr === undefined || (pack.fr && typeof pack.fr === 'object' && !Array.isArray(pack.fr) && Object.values(pack.fr).every((line) => typeof line === 'string'))));

/** the packs that ship with this editor, from its own index (fetched once it answers; asked again after a failure) */
export async function shippedPacks(): Promise<PackEntry[]> {
  if (cache) return cache;
  try {
    const r = await fetch('/plugins/index.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(await readLimitedBody(r, 1024 * 1024, 'pack index')));
    if (!packIndex(parsed)) throw new Error('invalid pack index');
    cache = parsed;
    return cache;
  } catch (e) {
    console.error('[packs] the index could not be read', e);
    return [];
  }
}

/** what the assistant's instructions list of the packs: one line per entry, `name (pack): what it is for` */
export function packLines(packs: PackEntry[]): string[] {
  return packs.flatMap((p) => (p.entries ?? []).map((e) => `${e.name} (${p.name}): ${e.line}`));
}

/** a pack file's stem: its data folder beside the module, and its meta id (tramme/<stem>) */
export const packStem = (file: string) => file.replace(/\.(js|mjs)$/i, '');
export const packIdOf = (file: string) => `tramme/${packStem(file)}`;

/** the pack a module asset's src holds, when it is one of the editor's (a project's own copy reads its data too) */
export function packBySrc(packs: PackEntry[], src: string | undefined): PackEntry | null {
  if (!src) return null;
  const m = src.match(/^plugins\/([\w.-]+)\.(js|mjs)$/i);
  if (!m) return null;
  return packs.find((p) => packStem(p.file) === m[1]) ?? null;
}

/** the packs' tools as commands of the / menu (the home screen, before a project holds any of them); each pack's French added as it comes */
export function packCommands(packs: PackEntry[]): Command[] {
  const out: Command[] = [];
  for (const p of packs) {
    if (p.fr) addMessages('fr', p.fr);
    for (const c of p.commands ?? []) out.push({ kind: 'tool', name: c.name, title: c.title, description: c.description, from: p.name });
  }
  return out;
}

/** a project's copy of a shipped pack that is older than the editor's: the Code section offers it, never applied alone (the way an installed plugin's copy is).
 *  `versions` reads each copy's own version by asset src, out of its code (the document does not carry it) */
export interface PackUpdate { assetId: string; name: string; file: string; src: string; from: string; to: string }

export function packUpdates(doc: TrammeDoc, packs: PackEntry[], versions: Record<string, string>): PackUpdate[] {
  const out: PackUpdate[] = [];
  for (const [id, a] of Object.entries(doc.assets) as [string, { type: string; src?: string; name?: string }][]) {
    if (a.type !== 'module') continue;
    const pack = packBySrc(packs, a.src);
    const from = a.src ? versions[a.src] : undefined;
    if (!pack?.version || !from) continue;
    if (compareVersions(from, pack.version) >= 0) continue;
    out.push({ assetId: id, name: a.name || pack.name, file: pack.file, src: a.src!, from, to: pack.version });
  }
  return out;
}

/** the ToolContext of a pack's tool: its data files, fetched from the editor's own origin */
export function packContext(pack: PackEntry, ctx: ToolContext): ToolContext {
  if (!packModule(pack.file)) throw new Error('invalid pack module');
  const dir = `/plugins/${packStem(pack.file)}/`;
  return {
    ...ctx,
    packFile: async (path: string) => {
      if (typeof path !== 'string' || path.length < 1 || path.length > 512 || path.startsWith('/') ||
          /[\\%?#:\u0000-\u001f\u007f]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..'))
        throw new Error('invalid pack file path');
      const res = await fetch(new URL(dir + path, location.href));
      if (!res.ok) throw new Error(`the pack's file "${path}" is missing (HTTP ${res.status})`);
      return new TextDecoder().decode(await readLimitedBody(res, 8 * 1024 * 1024, 'pack file'));
    },
  };
}

/** a pack as an installed plugin: its code fetched once, its manifest from the module's meta */
export async function packAsInstalled(pack: PackEntry): Promise<Installed> {
  if (!packModule(pack.file)) throw new Error('invalid pack module');
  const url = `/plugins/${pack.file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const code = new TextDecoder().decode(await readLimitedBody(response, 1024 * 1024, 'pack module'));
  return {
    file: pack.file,
    manifest: manifestOf(code, pack.file),
    size: code.length,
    modified: '',
    code,
    files: new Map(), // the data stays beside the pack in the editor, never copied into a project
    enabled: true,
  };
}
