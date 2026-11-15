// The plugins' marketplace from the editor (the Worker's market.ts): its
// catalogue, a package downloaded and checked against the hash the catalogue
// gives before the install question of an import, the installed plugins
// checked for newer versions and for revoked ones (turned off, and said so).
// Where the app has no marketplace (no accounts), all of it stays silent.

import { signal } from '@preact/signals';
import type { PluginManifest } from '@tramme/project';
import { t } from './i18n/index.ts';
import { installed, setEnabled, type Installed } from './installed.ts';
import { toast } from './state.ts';

export interface MarketPlugin {
  id: string;
  name: string;
  description?: string;
  licence?: string;
  homepage?: string;
  author: { name: string; handle: string };
  version: { version: string; permissions: PluginManifest['permissions']; kinds: string[]; size: number; sha256: string; changelog?: string };
  versions: string[];
}

/** the catalogue, once read; null while unknown or where there is none */
export const catalogue = signal<MarketPlugin[] | null>(null);

export async function readCatalogue(): Promise<MarketPlugin[] | null> {
  try {
    const r = await fetch('/api/market');
    catalogue.value = r.ok ? ((await r.json()) as MarketPlugin[]) : null;
  } catch { catalogue.value = null; }
  return catalogue.value;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** a plugin's package of the catalogue, as a file to install, its bytes checked against the catalogue's hash */
export async function download(p: MarketPlugin): Promise<File> {
  const [handle, name] = p.id.split('/');
  const r = await fetch(`/api/market/${encodeURIComponent(handle)}/${encodeURIComponent(name)}/${encodeURIComponent(p.version.version)}`);
  if (!r.ok) throw new Error(t('market.unavailable'));
  const bytes = await r.arrayBuffer();
  if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== p.version.sha256) throw new Error(t('market.altered', { name: p.name }));
  return new File([bytes], `${name}.trammeplugin`, { type: 'application/zip' });
}

/** the newer version the catalogue has of an installed plugin; none when it is up to date or not from the catalogue */
export function updateOf(p: Installed, list: MarketPlugin[] | null): MarketPlugin | null {
  const found = list?.find((m) => m.id === p.manifest.id);
  return found && newer(found.version.version, p.manifest.version) ? found : null;
}

export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.+-]/).map((n) => Number(n) || 0), pb = b.split(/[.+-]/).map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** an installed plugin published in the marketplace, as its author: its package made from what is installed */
export async function publishPlugin(p: Installed): Promise<{ state: 'listed' | 'pending' }> {
  const { writePluginPackage } = await import('@tramme/project');
  const r = await fetch('/api/market/publish', { method: 'POST', body: writePluginPackage({ module: p.code, files: p.files }) as BodyInit });
  if (!r.ok) {
    let said = '';
    try { said = ((await r.json()) as { error?: string }).error ?? ''; } catch { /* not JSON */ }
    throw new Error(t('market.publishFailed', { error: said || String(r.status) }));
  }
  return (await r.json()) as { state: 'listed' | 'pending' };
}

/** a plugin of the catalogue reported, with the reason */
export async function report(p: MarketPlugin, reason: string): Promise<boolean> {
  const [handle, name] = p.id.split('/');
  const r = await fetch(`/api/market/${encodeURIComponent(handle)}/${encodeURIComponent(name)}/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) });
  return r.ok;
}

/** the installed plugins whose version was revoked: turned off, and the person told which */
export async function checkRevoked(): Promise<string[]> {
  let revoked: { id: string; version: string }[];
  try {
    const r = await fetch('/api/market/revoked');
    if (!r.ok) return [];
    revoked = await r.json();
  } catch { return []; }
  const hit = installed.peek().filter((p) => p.enabled && revoked.some((v) => v.id === p.manifest.id && v.version === p.manifest.version));
  for (const p of hit) setEnabled(p, false);
  if (hit.length) toast(t('market.revoked', { names: hit.map((p) => p.manifest.name).join(', ') }), 'error', 12000);
  return hit.map((p) => p.manifest.id);
}
