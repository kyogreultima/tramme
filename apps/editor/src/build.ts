// The page's side of a scene builder (build-kit.ts runs the script in the
// sandbox): what a build gives back becomes the operations of a proposal. A
// builder owns the layers it made last time, kept in a record beside its script
// (assets/builds/<name>.json): those are replaced, every other layer of the
// composition (a sound a tool placed, a layer the user added) stays where it is.
// A layer of the builder's changed since its build (by hand or by operations)
// is said, not overwritten, unless asked.

import { pointer, type Op, type TrammeDoc } from '@tramme/core';
import type { BuildOutput, BuiltLayer } from './build-kit.ts';

export interface BuildRecord { version: 1; kind: 'build'; script: string; comp: string; hashes: Record<string, string> }

/** a builder script's path: assets/builds/<name>.js */
export const BUILDER = /^assets\/builds\/[a-z0-9][a-z0-9_-]{0,63}\.js$/;
/** where a builder keeps what it built */
export const recordPathOf = (script: string) => script.replace(/\.js$/, '.json');

/** a short, stable hash of a value (FNV-1a over its JSON) */
export function hashOf(value: unknown): string {
  const s = JSON.stringify(value) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** a record read back from its file: null when it is not one */
export function readRecord(text: string | null): BuildRecord | null {
  if (!text) return null;
  try {
    const r = JSON.parse(text);
    return r?.kind === 'build' && typeof r.comp === 'string' && r.hashes && typeof r.hashes === 'object' ? r as BuildRecord : null;
  } catch { return null; }
}

/** the builder's layers changed or removed since its last build, in the composition as it is now */
export function changedSince(doc: TrammeDoc, record: BuildRecord | null): string[] {
  const c = record && doc.compositions[record.comp];
  if (!c) return [];
  return Object.entries(record.hashes).filter(([id, h]) => !c.layers[id] || hashOf(c.layers[id]) !== h).map(([id]) => id);
}

/** the ids reached from these, down their children */
function withDescendants(layers: Record<string, { children?: string[] }>, ids: Iterable<string>): Set<string> {
  const out = new Set<string>(), stack = [...ids];
  while (stack.length) { const id = stack.pop()!; if (out.has(id) || !layers[id]) continue; out.add(id); stack.push(...(layers[id].children ?? [])); }
  return out;
}

/**
 * The operations that put a build into a composition, and the record of it. The builder's previous
 * layers go; its new ones take the place in the root order of the first of them (on top for a first
 * build); a layer of someone else's that sat in one of its groups comes back at the root. A missing
 * composition is made, in the root's size and frame rate.
 */
export function buildOps(doc: TrammeDoc, compId: string, out: BuildOutput, record: BuildRecord | null, script: string): { ops: Op[]; record: BuildRecord } {
  const hashes = Object.fromEntries(Object.entries(out.layers).map(([id, l]) => [id, hashOf(l)]));
  const next: BuildRecord = { version: 1, kind: 'build', script, comp: compId, hashes };
  const path = (...p: string[]) => pointer('compositions', compId, ...p);
  const c = doc.compositions[compId];
  const settings = Object.fromEntries(Object.entries(out.set).filter(([, v]) => v !== undefined));
  if (!c) {
    const r = doc.compositions[doc.root];
    const comp = { name: compId, width: r.width, height: r.height, fps: r.fps, duration: 5, ...settings, layers: out.layers, order: out.order };
    return { ops: [{ op: 'add', path: pointer('compositions', compId), value: comp }], record: next };
  }
  // the record names every layer the builder made, children included: a layer it did not make is never its own, even in its group
  const owned = new Set(record?.comp === compId ? Object.keys(record.hashes).filter((id) => c.layers[id]) : []);
  const kept: Record<string, BuiltLayer | (typeof c.layers)[string]> = Object.fromEntries(Object.entries(c.layers).filter(([id]) => !owned.has(id)));
  // the kept layers still reached from the kept root or groups; the rest sat in a group of the builder's
  const reached = withDescendants(kept as Record<string, { children?: string[] }>, c.order.filter((id) => !owned.has(id)));
  const orphans = Object.keys(kept).filter((id) => !reached.has(id) && !Object.values(kept).some((l) => l.children?.includes(id)));
  const order: string[] = [];
  let placed = false;
  for (const id of c.order) {
    if (!owned.has(id)) order.push(id);
    else if (!placed) { order.push(...out.order); placed = true; }
  }
  if (!placed) order.push(...out.order);
  order.push(...orphans);
  const ops: Op[] = [
    { op: 'replace', path: path('layers'), value: { ...kept, ...out.layers } },
    { op: 'replace', path: path('order'), value: order },
  ];
  for (const [k, v] of Object.entries(settings)) ops.push({ op: (c as unknown as Record<string, unknown>)[k] === undefined ? 'add' : 'replace', path: path(k), value: v });
  return { ops, record: next };
}

/** a build's output checked as plain data before it becomes operations */
export function outputIssue(out: unknown): string | null {
  const o = out as BuildOutput | null;
  if (!o || typeof o !== 'object' || !o.layers || typeof o.layers !== 'object' || !Array.isArray(o.order)) return 'the build gave no layers';
  if (!o.order.length) return 'the build made no layer: its script must call k.text, k.rect, k.add… (its default export receives k)';
  return null;
}

/** the one composition a batch of operations changes, when it changes only one: its checks are read there */
export function touchedComp(ops: Op[]): string | undefined {
  const ids = new Set(ops.map((o) => /^\/compositions\/([^/]+)/.exec(o.path)?.[1]).filter((id): id is string => !!id).map((id) => id.replace(/~1/g, '/').replace(/~0/g, '~')));
  return ids.size === 1 ? [...ids][0] : undefined;
}
