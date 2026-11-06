// CLI plugin declarations are loaded in the same opaque browser worker as the
// editor. Native Node never imports a project's module during validation.

import fs from 'node:fs';
import path from 'node:path';
import type { PluginModule, Registry, TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { srcPath } from '@tramme/project';
import type { PluginDecl } from '../../../apps/editor/src/plugins/protocol.ts';
import { launch } from './browser.ts';
import { Server } from './server.ts';

async function isolatedDeclarations(plugins: { id: string; code: string }[]): Promise<PluginDecl[]> {
  if (!plugins.length) return [];
  const server = new Server({ dir: process.cwd(), mounts: [] });
  server.use((_req, res, url) => {
    if (url.pathname !== '/__tramme/plugin-schema/') return false;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end('<!doctype html><html><body><script type="module" src="/__tramme/plugin-schema/plugin-schema-page.js"></script></body></html>');
    return true;
  });
  let browser: Awaited<ReturnType<typeof launch>>['browser'] | undefined;
  try {
    const port = await server.start();
    await server.bundle('plugin-schema', path.join(import.meta.dirname, 'plugin-schema-page.ts'));
    const launched = await launch();
    browser = launched.browser;
    const { page } = launched;
    await page.goto(`http://127.0.0.1:${port}/__tramme/plugin-schema/`);
    await page.waitForFunction(() => typeof (window as any).TRAMME_PLUGIN_SCHEMA === 'function');
    return await page.evaluate((sources) => (window as any).TRAMME_PLUGIN_SCHEMA(sources), plugins) as PluginDecl[];
  } finally { await browser?.close(); server.close(); }
}

function registryFrom(declarations: PluginDecl[]): Registry {
  const registry = builtinRegistry().clone();
  const isolated = () => { throw new Error('plugin behavior must run in the browser sandbox'); };
  for (const declaration of declarations) {
    const module: PluginModule = {
      meta: declaration.meta,
      nodes: declaration.nodes.map((node) => ({ ...node, render: { canvas2d: isolated } })) as PluginModule['nodes'],
      effects: declaration.effects as PluginModule['effects'],
      modifiers: declaration.modifiers.map((modifier) => ({ ...modifier, apply: isolated })) as PluginModule['modifiers'],
      tools: declaration.tools.map((tool) => ({ ...tool, run: isolated })) as PluginModule['tools'],
      checks: declaration.checks.map((check) => ({ ...check, run: isolated })) as PluginModule['checks'],
      prompts: declaration.prompts,
      kits: declaration.kits,
      presets: declaration.presets,
    };
    registry.use(module, declaration.id);
  }
  return registry;
}

/** Vocabulary of an archive, with module initialization isolated from Node. */
export async function filesRegistry(doc: TrammeDoc, files: Map<string, Uint8Array>): Promise<Registry> {
  const sources: { id: string; code: string }[] = [];
  for (const id of doc.plugins || []) {
    const file = srcPath(doc.assets[id]?.src ?? '');
    const data = file ? files.get(file) : undefined;
    if (!data) throw new Error(`plugin "${id}" not found in the project`);
    sources.push({ id, code: new TextDecoder().decode(data) });
  }
  try { return registryFrom(await isolatedDeclarations(sources)); }
  catch (error) {
    const message = (error as Error).message;
    const named = /^plugin ([^:]+): (.*)$/.exec(message);
    throw new Error(named ? `plugin "${named[1]}" unreadable: ${named[2]}` : `plugin unreadable: ${message}`);
  }
}

/** Vocabulary of a project folder and its configured mounts, isolated. */
export async function docRegistry(doc: TrammeDoc, dir: string, resolve?: (urlPath: string) => string | null): Promise<Registry> {
  const sources: { id: string; code: string }[] = [];
  for (const id of doc.plugins || []) {
    const asset = doc.assets[id];
    if (!asset || asset.type !== 'module') continue;
    const relative = asset.src.startsWith('/') ? null : srcPath(asset.src);
    if (!asset.src.startsWith('/') && (!relative || asset.src.includes('\\'))) throw new Error(`plugin "${id}" has an invalid path: ${asset.src}`);
    const file = asset.src.startsWith('/') ? resolve?.(asset.src) ?? null : path.resolve(dir, relative!);
    if (relative && (path.relative(dir, file!).startsWith(`..${path.sep}`) || path.isAbsolute(path.relative(dir, file!)))) throw new Error(`plugin "${id}" leaves its project`);
    if (!file || !fs.existsSync(file)) throw new Error(`plugin "${id}" not found: ${asset.src}`);
    sources.push({ id, code: fs.readFileSync(file, 'utf8') });
  }
  try { return registryFrom(await isolatedDeclarations(sources)); }
  catch (error) { throw new Error(`plugin unreadable: ${(error as Error).message}`); }
}
