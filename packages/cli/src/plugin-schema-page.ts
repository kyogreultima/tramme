// Loaded only by the CLI's local browser page: declarations cross back as
// data, while the plugin module runs in the opaque project worker.
import { browserHost } from '../../../apps/editor/src/plugins/host.ts';

(window as unknown as { TRAMME_PLUGIN_SCHEMA?: (plugins: { id: string; code: string }[]) => Promise<unknown> }).TRAMME_PLUGIN_SCHEMA = async (plugins) => {
  const host = browserHost('');
  const urls = plugins.map((plugin) => ({ id: plugin.id, url: URL.createObjectURL(new Blob([plugin.code], { type: 'text/javascript' })) }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('plugin declaration timed out')), 10_000); });
  try { return [...(await Promise.race([host.ensure(urls), deadline])).values()]; }
  finally { clearTimeout(timer); host.dispose(); for (const plugin of urls) URL.revokeObjectURL(plugin.url); }
};
