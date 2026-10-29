// The plugin library, shared by the projects: keep a project's plugin there,
// use one of it in a project (copied, so the project stays self-contained).
// Tools of the editor's vocabulary: the assistant reaches them with use_tool,
// the user from the / menu.

import { signal } from '@preact/signals';
import { pointer, type Op, type ToolType } from '@tramme/core';
import { KEEP_PLUGIN } from './ai/answers.ts';
import { api } from './api.ts';
import { t } from './i18n/index.ts';
import { installed, installedCode, installFile, storageKind } from './installed.ts';

const NAME = /^[a-z0-9][a-z0-9_-]{0,62}\.(js|mjs)$/;

/** the plugins of the library, as last listed (pickers of the / menu) */
export const libraryList = signal<{ name: string; size: number; modified: string }[]>([]);
export async function refreshLibrary() {
  let list: { name: string; size: number; modified: string }[] = [];
  try { list = await api.library(); } catch { /* no server: no library */ }
  // the plugins kept in a picked folder, beside the library's components
  if (storageKind.peek() === 'folder') list = [...list.filter((f) => f.name.startsWith('component-')), ...installed.peek().map((p) => ({ name: p.file, size: p.size, modified: p.modified }))];
  libraryList.value = list;
}

const keep: ToolType<{ plugin: string; name?: string }> = {
  name: 'library-add', title: KEEP_PLUGIN, description: 'copies a plugin of this project into the library, to use it in other projects',
  input: {
    type: 'object',
    properties: {
      plugin: { type: 'string', format: 'plugin', title: 'Plugin' },
      name: { type: 'string', title: 'Name in the library', description: 'lower case, ending in .js (its file name by default)' },
    },
    required: ['plugin'],
  },
  ai: { when: 'the user wants to reuse a plugin (their brand, a node, a set of tools) in other projects' },
  async run({ plugin, name }, ctx) {
    const a = ctx.doc.assets[plugin];
    if (!a || a.type !== 'module') throw new Error(`${plugin} is not a plugin of this project`);
    const code = await ctx.readText(a.src);
    if (code === null) throw new Error(`file not found: ${a.src}`);
    const file = (name ?? a.src.split('/').pop() ?? '').toLowerCase();
    if (!NAME.test(file)) throw new Error(`invalid name "${file}": lower case letters, digits, - and _, then .js`);
    // installed on this device: the Plugins section of the settings lists it, every project can use it
    await installFile(file, code);
    await refreshLibrary();
    return { text: `Plugin "${plugin}" kept in the library as ${file}; other projects can use it with library-use.`, notice: t('library.kept', { name: file }) };
  },
};

const use: ToolType<{ name: string }> = {
  name: 'library-use', title: 'Use a plugin of the library', description: 'copies a plugin of the library into this project and adds it to the document',
  input: { type: 'object', properties: { name: { type: 'string', format: 'library', title: 'Plugin' } }, required: ['name'] },
  ai: { when: 'the user mentions a plugin of theirs from another project; list_nodes shows its nodes and tools once added' },
  async run({ name }, ctx) {
    if (!NAME.test(name)) throw new Error(`invalid name "${name}"`);
    if (name.startsWith('component-')) throw new Error(`${name} is a component, not a plugin: bring it in with component-use`);
    const code = storageKind.peek() === 'folder' ? await installedCode(name) : await api.libraryGet(name);
    const id = name.replace(/\.(js|mjs)$/, '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
    const path = await ctx.writeFile(`plugins/${name}`, code);
    const had = ctx.doc.assets[id];
    const ops: Op[] = [{ op: had ? 'replace' : 'add', path: pointer('assets', id), value: { type: 'module', src: path, name: id } }];
    if (!(ctx.doc.plugins ?? []).includes(id)) ops.push(ctx.doc.plugins ? { op: 'add', path: '/plugins/-', value: id } : { op: 'add', path: '/plugins', value: [id] });
    return {
      ops, reload: had ? [id] : [], label: `Plugin ${id}`,
      text: `Plugin ${name} copied into the project (${path}) as the module "${id}" and added to the document's plugins: read list_nodes for what it brings.`,
      notice: t('library.used', { name }),
    };
  },
};

export const LIBRARY_TOOLS: ToolType[] = [keep, use];
