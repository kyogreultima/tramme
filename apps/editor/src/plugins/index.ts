// One plugin sandbox per open project: a browser worker where the project's
// plugin modules are imported and their tools and checks run (see
// plugin-isolation.md, stage 1, and the files beside this one).

import { browserHost, type PluginHost } from './host.ts';

let current: { docUrl: string; host: PluginHost } | null = null;
const toolHosts = new Map<string, { url: string; host: PluginHost }>();

/** the sandbox of the open project (recreated when another project opens on the same page, or when its worker failed) */
export function pluginHost(docUrl: string): PluginHost {
  if (current?.docUrl !== docUrl || current.host.closed()) {
    current?.host.dispose();
    for (const { host } of toolHosts.values()) host.dispose();
    toolHosts.clear();
    current = { docUrl, host: browserHost(docUrl) };
  }
  return current.host;
}

/** A tool/check host loads one plugin only, so its bridge cannot borrow another plugin's grant. */
export function pluginToolHost(docUrl: string, id: string, url: string): PluginHost {
  pluginHost(docUrl);
  let current = toolHosts.get(id);
  if (!current || current.url !== url || current.host.closed()) {
    current?.host.dispose();
    toolHosts.set(id, current = { url, host: browserHost(docUrl) });
  }
  return current.host;
}

export { attachInstalled, attachIsolated, filterModule } from './vocabulary.ts';
export { browserHost, type PluginHost } from './host.ts';
