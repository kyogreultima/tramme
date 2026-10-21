// One plugin sandbox per open project: a browser worker where the project's
// plugin modules are imported and their tools and checks run (see
// plugin-isolation.md, stage 1, and the files beside this one).

import { browserHost, type PluginHost } from './host.ts';

let current: { docUrl: string; host: PluginHost } | null = null;

/** the sandbox of the open project (recreated when another project opens on the same page, or when its worker failed) */
export function pluginHost(docUrl: string): PluginHost {
  if (current?.docUrl !== docUrl || current.host.closed()) {
    current?.host.dispose();
    current = { docUrl, host: browserHost(docUrl) };
  }
  return current.host;
}

export { attachInstalled, attachIsolated, filterModule } from './vocabulary.ts';
export { browserHost, type PluginHost } from './host.ts';
