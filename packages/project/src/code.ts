// What an archive would run, inventoried without running anything: the
// plugins it carries (JS modules) and the expressions of its document. The
// editor's import shows this inventory and asks before any of it executes;
// the shipped examples (no plugins) skip the question.

import { pointer } from '@tramme/core/ops';
import type { TrammeDoc } from '@tramme/core/types';
import { srcPath } from './format.ts';

export interface PluginCode {
  /** the asset id the document names */
  id: string;
  /** its file in the project, null when the src points outside */
  path: string | null;
  /** its size in bytes, null when the file is missing */
  size: number | null;
  /** what the module declares it brings, read in its text without running it: nodes, effects, tools... */
  kinds: string[];
}

export interface CodeInventory {
  plugins: PluginCode[];
  /** how many properties of the document carry an expression */
  expressions: number;
  /** where the first ones are, as JSON Pointers in the document */
  addresses: string[];
}

/** how many expression addresses the inventory keeps */
const MAX_ADDRESSES = 5;

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** the property carries code: an expression of its own, or one over its keyframes */
const hasExpr = (v: unknown) => isPlainObject(v) && v.$expr !== undefined;

/** the kinds a plugin module declares to bring, in the order the vocabulary presents them */
const KINDS = ['nodes', 'effects', 'modifiers', 'tools', 'prompts', 'checks', 'kits', 'presets', 'tours'] as const;
const EXPORTED_KIND = /export\s+(?:const|let|var)\s+(nodes|effects|modifiers|tools|prompts|checks|kits|presets|tours)\b/g;

/** a static read of the module's text (the load itself stays a question of trust) */
export function kindsOf(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(EXPORTED_KIND)) found.add(m[1]);
  return KINDS.filter((k) => found.has(k));
}

export function codeInventory(doc: TrammeDoc, files: Map<string, Uint8Array>): CodeInventory {
  const plugins = (doc.plugins || []).map((id) => {
    const path = srcPath(doc.assets[id]?.src ?? '') || null;
    const data = path ? files.get(path) : undefined;
    return { id, path, size: data?.byteLength ?? null, kinds: data ? kindsOf(new TextDecoder().decode(data)) : [] };
  });
  let expressions = 0;
  const addresses: string[] = [];
  const prop = (path: string, v: unknown) => {
    if (!hasExpr(v)) return;
    expressions++;
    if (addresses.length < MAX_ADDRESSES) addresses.push(path);
  };
  const props = (path: string, values: unknown) => {
    if (!isPlainObject(values)) return;
    for (const [name, v] of Object.entries(values)) prop(`${path}/${name}`, v);
  };
  for (const [cid, comp] of Object.entries(doc.compositions)) {
    const base = pointer('compositions', cid);
    if (comp.background !== undefined && comp.background !== null) prop(`${base}/background`, comp.background);
    props(`${base}/camera`, comp.camera);
    props(`${base}/motionBlur`, comp.motionBlur);
    props(`${base}/sound`, comp.sound);
    (comp.effects || []).forEach((e, i) => props(`${base}/effects/${i}/props`, e.props));
    for (const [lid, layer] of Object.entries(comp.layers)) {
      const lp = `${base}/layers/${lid}`;
      props(`${lp}/transform`, layer.transform);
      props(`${lp}/props`, layer.props);
      (layer.effects || []).forEach((e, i) => props(`${lp}/effects/${i}/props`, e.props));
    }
  }
  return { plugins, expressions, addresses };
}
