// Proxies made without asking, on import and when a project opens, once per
// video and page, while the preview's proxies setting is on (the default):
// a video this machine decodes slower than the film needs gets a light copy
// that the preview plays instead. The film needs it once per layer showing
// it at the same moment (a soft cut between two shots of one take reads the
// file at two places). A video only larger than the film (a 4K take in a
// 1080p film) needs none: the preview shrinks its frames on the graphics card
// while it plays (frame-shrink.ts).

import { S } from './state.ts';
import { prefs } from './settings.ts';
import { sameFileProject, type FileProject } from './files.ts';
import { t } from './i18n/index.ts';

/** the videos measured in this page: each is measured once */
const measured = new Set<string>();

/**
 * Makes a proxy of one video when it plays poorly here; `source` is the file
 * (an import) or its address (a project opening). True when one was made.
 */
export async function proxyIfSlow(project: FileProject, asset: string, source: Blob | string, name: string): Promise<boolean> {
  const doc = S.doc.peek();
  const a = doc.assets[asset];
  if (!prefs.peek().proxies || a?.type !== 'video' || a.proxy) return false;
  // a proxy itself is never given one
  if (Object.values(doc.assets).some((x) => x.type === 'video' && x.proxy === asset)) return false;
  const key = `${project.id}\0${asset}`;
  if (measured.has(key)) return false;
  measured.add(key);
  const { decodeRate, playsPoorly, proxySize, readsOf, PROXY_HEIGHT } = await import('./proxy.ts');
  const rate = await decodeRate(source).catch(() => null);
  if (!sameFileProject(project) || !rate) return false;
  const reads = Math.max(1, readsOf(S.doc.peek(), asset).reads);
  if (!playsPoorly(rate.fps, rate.fileFps * reads) || !proxySize(rate.width, rate.height, PROXY_HEIGHT)) return false;
  const { listCommands } = await import('./ai/commands.ts'), { runCommand } = await import('./ai/conversation.ts');
  if (!sameFileProject(project)) return false;
  const cmd = listCommands(S.registry.peek()).find((c) => c.name === 'proxy');
  if (!cmd) return false;
  await runCommand(cmd, { video: asset, height: PROXY_HEIGHT }, t('panel.proxyAuto', { name }));
  return true;
}

/** a project just opened: each of its videos measured, one after the other, a proxy made where one is needed */
export async function proxiesIfSlow(project: FileProject, url: (asset: string) => string) {
  for (const [id, a] of Object.entries(S.doc.peek().assets)) {
    if (!sameFileProject(project)) return;
    if (a.type !== 'video' || a.proxy) continue;
    await proxyIfSlow(project, id, url(id), a.name ?? id).catch(() => false);
  }
}
