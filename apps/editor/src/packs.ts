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

/** the packs that ship with this editor, from its own index (fetched once it answers; asked again after a failure) */
export async function shippedPacks(): Promise<PackEntry[]> {
  if (cache) return cache;
  try {
    const r = await fetch('/plugins/index.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    cache = await r.json() as PackEntry[];
    return cache;
  } catch (e) {
    console.error('[packs] the index could not be read', e);
    return [];
  }
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
  const dir = `/plugins/${packStem(pack.file)}/`;
  return {
    ...ctx,
    packFile: async (path: string) => {
      const clean = String(path).replace(/^\/+/, '');
      if (!clean || clean.split('/').includes('..')) throw new Error(`packFile: "${path}" is outside the pack's folder`);
      const res = await fetch(new URL(dir + clean, location.href));
      if (!res.ok) throw new Error(`the pack's file "${path}" is missing (HTTP ${res.status})`);
      return res.text();
    },
  };
}

/** a pack as an installed plugin: its code fetched once, its manifest from the module's meta */
export async function packAsInstalled(pack: PackEntry): Promise<Installed> {
  const url = `/plugins/${pack.file}`;
  const code = await fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });
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
