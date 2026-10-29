// The packs' index, generated from the pack modules themselves so it cannot
// go stale: plugins/index.json gains each pack's commands (its tools, as the
// / menu lists them: name, title, description) and the French of those
// strings; docs/packs.md gains one section per pack (the site's Packs page).
//
//   npm run packs:index            # write both
//   node scripts/packs/index.ts --check
//                                  # exit 1 when either file would change (CI)
//
// Run after a pack lands or its tools change; every pack task's last step.

import { readFileSync, writeFileSync } from 'node:fs';
import { needLine, type Described } from './entries.ts';

const root = new URL('../../', import.meta.url);
const indexUrl = new URL('plugins/index.json', root);
const packsMdUrl = new URL('docs/packs.md', root);
const check = process.argv.includes('--check');

interface PackModule {
  meta?: { version?: string };
  tools?: (Described & { name: string; title?: string; description: string })[];
  nodes?: (Described & { type: string; title: string })[];
  effects?: (Described & { type: string; title: string })[];
  checks?: { name: string; title: string }[];
  messages?: { fr?: Record<string, string> };
}
interface Entry {
  file: string;
  name: string;
  description?: string;
  data?: string[];
  /** the version the pack's module declares, for the update offers of a project's copy */
  version?: string;
  commands?: { name: string; title: string; description: string }[];
  /** what each node, effect and tool is for, one line each: the assistant's prompt lists them so it finds a pack's piece before it writes its own */
  entries?: { name: string; kind: 'node' | 'tool' | 'effect'; line: string }[];
  fr?: Record<string, string>;
}

const index: Entry[] = JSON.parse(readFileSync(indexUrl, 'utf8'));
/** each pack's nodes and checks, read from its module for docs/packs.md (the index entries do not hold them) */
const shapes = new Map<string, { nodes: { type: string; title: string }[]; checks: { name: string; title: string }[] }>();

for (const entry of index) {
  const mod: PackModule = await import(new URL(`plugins/${entry.file}`, root).href);
  entry.version = mod.meta?.version;
  entry.commands = (mod.tools ?? []).map((t) => ({ name: t.name, title: t.title ?? t.name, description: t.description }));
  entry.entries = [
    ...(mod.nodes ?? []).map((n) => ({ name: n.type, kind: 'node' as const, line: needLine(n) })),
    ...(mod.effects ?? []).map((n) => ({ name: n.type, kind: 'effect' as const, line: needLine(n) })),
    ...(mod.tools ?? []).map((n) => ({ name: n.name, kind: 'tool' as const, line: needLine(n) })),
  ];
  shapes.set(entry.file, {
    nodes: (mod.nodes ?? []).map((n) => ({ type: n.type, title: n.title })),
    checks: (mod.checks ?? []).map((c) => ({ name: c.name, title: c.title })),
  });
  const fr = mod.messages?.fr ?? {};
  const keys = new Set<string>();
  for (const c of entry.commands) { keys.add(c.title); keys.add(c.description); }
  // a name standing in for a title (no title of its own) carries through as it is
  entry.fr = Object.fromEntries([...keys].map((k) => [k, fr[k] ?? k]));
}

const list = (label: string, items: string[]) => (items.length ? `- ${label}: ${items.join(', ')}` : `- ${label}: none`);
const packsMd = [
  '# Packs',
  '',
  'The plugin packs that ship with the editor: one self-contained file each in `plugins/`, added to a project from the Code section, their commands in the `/` menu from the home screen on. Each brings nodes (layers only it can draw), tools (a whole thing laid out in one move) and checks (what the review flags). This page is generated from the packs themselves by `npm run packs:index` — do not edit it by hand.',
  '',
  ...index.flatMap((e) => [
    `## ${e.name}`,
    '',
    e.description ?? '',
    '',
    list('Tools', (e.commands ?? []).map((c) => `\`/${c.name}\` — ${c.title}`)),
    list('Nodes', (shapes.get(e.file)?.nodes ?? []).map((n) => `\`${n.type}\` — ${n.title}`)),
    list('Checks', (shapes.get(e.file)?.checks ?? []).map((c) => `\`${c.name}\` — ${c.title}`)),
    '',
  ]),
].join('\n');

const indexJson = `${JSON.stringify(index, null, 2)}\n`;
const mdOut = `${packsMd}\n`;

if (check) {
  const stale = (url: URL, next: string, name: string) => {
    if (readFileSync(url, 'utf8') !== next) { console.error(`stale: ${name} (run npm run packs:index)`); return true; }
    return false;
  };
  const bad = stale(indexUrl, indexJson, 'plugins/index.json') | stale(packsMdUrl, mdOut, 'docs/packs.md');
  if (bad) process.exit(1);
  console.log(`packs index up to date (${index.length} packs)`);
} else {
  writeFileSync(indexUrl, indexJson);
  writeFileSync(packsMdUrl, mdOut);
  console.log(`packs index written: ${index.length} packs, ${index.reduce((n, e) => n + (e.commands?.length ?? 0), 0)} commands`);
}
