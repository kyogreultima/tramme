// How the document's plugins join the editor's vocabulary under stage 1 of
// the isolation plan (docs/plugin-isolation.md): nodes, effects, modifiers
// and the data exports (kits, presets, prompts, tours, translations) stay on
// the page — they draw — while the tools and checks run in the sandbox, as
// registry entries whose calls bridge there. The assistant's surface does not
// change: use_tool and list_nodes speak in names and schemas as before.

import type { PluginModule, Registry, ToolContext, TrammeDoc } from '@tramme/core';
import type { PluginHost } from './host.ts';
import { declarationsModule, noteSandboxDeclaration, sandboxNode } from './sandbox-draw.ts';

/**
 * What the page's registry takes from a plugin module: the tools and checks
 * go to the sandbox (stage 1), and every node draws from the sandbox too
 * (stage 2) — its geometry (outline, handles, vector export) is served from
 * what the sandbox ships with the frames. The module itself still loads on
 * the page for nothing but its declarations; its authoring and drawing code
 * is reached only through the sandbox's copy. (Still on the page, documented:
 * modifiers, Canvas2D effects and the stepping of simulations.)
 */
export function filterModule(mod: PluginModule): PluginModule {
  const { tools: _tools, checks: _checks, ...rest } = mod;
  return {
    ...rest,
    nodes: rest.nodes?.map((n) => sandboxNode(n)),
  };
}

/** the plugins (id and url) a registry already carries from a sandbox, or was refused */
const attached = new WeakMap<Registry, { host: PluginHost; done: Set<string> }>();

/**
 * Give the registry the plugin's tools and checks as sandbox-backed entries
 * (idempotent: a plugin already attached at its url, or refused at it, is left
 * alone; another sandbox attaches them all again). The urls come from the
 * renderer's asset store, so an edited plugin file (its url re-versioned) is
 * loaded again. One plugin that cannot load keeps none of the others out;
 * the refusals are thrown together once all the others are attached.
 */
export async function attachIsolated(registry: Registry, host: PluginHost, doc: TrammeDoc, urlOf: (id: string) => string | null, context?: (id: string, ctx: ToolContext) => ToolContext): Promise<void> {
  const list = (doc.plugins ?? []).map((id) => ({ id, url: urlOf(id) })).filter((p): p is { id: string; url: string } => !!p.url);
  if (!list.length) return;
  let seen = attached.get(registry);
  if (seen?.host !== host) attached.set(registry, seen = { host, done: new Set() });
  const { done } = seen;
  const missing = list.filter((p) => !done.has(`${p.id}\n${p.url}`));
  if (!missing.length) return;
  const refused: string[] = [];
  await Promise.all(missing.map(async (p) => {
    try {
      const d = (await host.ensure([p])).get(p.id)!;
      noteSandboxDeclaration(d);
      if (d.tools.length || d.checks.length) {
        registry.use({
          tools: d.tools.map((t) => ({ ...t, run: (input, ctx) => host.runTool(t.name, input, context ? context(p.id, ctx) : ctx) })),
          checks: d.checks.map((c) => ({ ...c, run: (ctx) => host.runCheck(c.name, ctx) })),
        }, p.id);
      }
    } catch (e) { refused.push((e as Error).message); }
    // said once per url: the same file is not tried again at each edit of the document
    done.add(`${p.id}\n${p.url}`);
  }));
  if (refused.length) throw new Error(refused.join('; '));
}

/**
 * The installed plugins of this device in a project (docs/installed-plugins-roadmap.md,
 * step 3): loaded in the project's sandbox only, never on the page, and
 * offered through the registry as the project's own are: their tools and
 * checks bridged there, their workflows, kits and presets as the plain data
 * the sandbox declares. What the registry has already (Tramme's, the
 * project's plugins) wins: a name is never taken from them, so a project
 * opens the same on any device. Their nodes, effects and modifiers draw
 * only once copied into a project (step 4). Idempotent per registry and url,
 * like attachIsolated; the refusals are thrown together, named.
 */
export interface InstalledHooks {
  /** each type a plugin brought (node:…, effect:…, modifier:…), told on every call */
  brought?(id: string, key: string): void;
  /** the tool context a plugin's tool gets (its permissions) */
  context?(id: string, ctx: ToolContext): ToolContext;
  /** around each call of its tools and checks (its failures counted) */
  around?<T>(id: string, run: () => Promise<T>): Promise<T>;
}

export async function attachInstalled(registry: Registry, host: PluginHost, list: { id: string; url: string; name: string }[], hooks: InstalledHooks = {}): Promise<void> {
  const { brought } = hooks, around = <T>(id: string, run: () => Promise<T>) => (hooks.around ? hooks.around(id, run) : run());
  if (!list.length) return;
  let seen = attachedInstalled.get(registry);
  if (seen?.host !== host) attachedInstalled.set(registry, seen = { host, done: new Set(), keys: new Map() });
  const { done, keys } = seen;
  const missing = list.filter((p) => !done.has(`${p.id}\n${p.url}`));
  // what each one brought, told again on every call (the caller's map follows the registry)
  const tell = () => { for (const p of list) for (const k of keys.get(p.id) ?? []) brought?.(p.id, k); };
  if (!missing.length) { tell(); return; }
  const refused: string[] = [];
  await Promise.all(missing.map(async (p) => {
    try {
      const d = (await host.ensure([{ id: p.id, url: p.url }])).get(p.id)!;
      // what draws, from its declarations (drawn by the sandbox until the copy of step 4 is in the project)
      const draws = declarationsModule(d, p.id);
      const nodes = (draws.nodes ?? []).filter((n) => !registry.hasNode(n.type));
      const effects = (draws.effects ?? []).filter((e) => !registry.hasEffect(e.type));
      const modifiers = (draws.modifiers ?? []).filter((m) => !registry.hasModifier(m.type));
      keys.set(p.id, [...nodes.map((n) => `node:${n.type}`), ...effects.map((e) => `effect:${e.type}`), ...modifiers.map((m) => `modifier:${m.type}`)]);
      const free = <T extends { name: string }>(xs: T[] | undefined, taken: { name: string }[]) => (xs ?? []).filter((x) => !taken.some((y) => y.name === x.name));
      registry.use({
        meta: d.meta, nodes, effects, modifiers,
        tools: d.tools.filter((t) => !registry.hasTool(t.name)).map((t) => ({ ...t, run: (input, ctx) => around(p.id, () => host.runTool(t.name, input, hooks.context ? hooks.context(p.id, ctx) : ctx)) })),
        checks: free(d.checks, registry.listChecks().map((c) => c.check)).map((c) => ({ ...c, run: (ctx) => around(p.id, () => host.runCheck(c.name, ctx)) })),
        prompts: free(d.prompts, registry.listPrompts().map((x) => x.prompt)),
        kits: free(d.kits, registry.listKits().map((x) => x.kit)),
        presets: free(d.presets, registry.listPresets().map((x) => x.preset)),
      }, p.id);
    } catch (e) { refused.push(`${p.name}: ${(e as Error).message}`); }
    done.add(`${p.id}\n${p.url}`);
  }));
  tell();
  if (refused.length) throw new Error(refused.join('; '));
}
const attachedInstalled = new WeakMap<Registry, { host: PluginHost; done: Set<string>; keys: Map<string, string[]> }>();
