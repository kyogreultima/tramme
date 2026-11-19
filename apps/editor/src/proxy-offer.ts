// When a proxy is offered, on import and when a project opens, once per video
// (a refusal is kept on this computer):
// - a video this machine decodes slower than the film needs it. The film needs
//   it once per layer showing it at the same moment (a soft cut between two
//   shots of one take reads the file at two places);
// - a video of at least twice the lines of the film showing it (a 4K take in a
//   1080p film): every frame is decoded, copied and drawn at four times what
//   the preview can show, which a cross-fade doubles. Its proxy is made at the
//   film's height, so the preview stays sharp.

import { askUser } from './confirm.ts';
import { S } from './state.ts';
import { prefs } from './settings.ts';
import { sameFileProject, type FileProject } from './files.ts';
import { t } from './i18n/index.ts';

const declinedKey = (project: string, asset: string) => `tramme.proxy.declined.${project}.${asset}`;
const declined = (project: string, asset: string) => { try { return localStorage.getItem(declinedKey(project, asset)) === '1'; } catch { return false; } };
const decline = (project: string, asset: string) => { try { localStorage.setItem(declinedKey(project, asset), '1'); } catch { /* private browsing: asked again next time */ } };

/** the videos measured in this page: each is measured once */
const measured = new Set<string>();

/**
 * Offers a proxy of one video when it plays poorly here; `source` is the file
 * (an import) or its address (a project opening). True when one was made.
 */
export async function offerProxy(project: FileProject, asset: string, source: Blob | string, name: string): Promise<boolean> {
  const doc = S.doc.peek();
  const a = doc.assets[asset];
  if (!prefs.peek().proxies || a?.type !== 'video' || a.proxy || declined(project.id, asset)) return false;
  // a proxy itself is never given one
  if (Object.values(doc.assets).some((x) => x.type === 'video' && x.proxy === asset)) return false;
  const key = `${project.id}\0${asset}`;
  if (measured.has(key)) return false;
  measured.add(key);
  const { decodeRate, oversized, playsPoorly, proxySize, readsOf, PROXY_HEIGHT } = await import('./proxy.ts');
  const rate = await decodeRate(source).catch(() => null);
  if (!sameFileProject(project) || !rate) return false;
  const shown = readsOf(S.doc.peek(), asset), reads = Math.max(1, shown.reads);
  const slow = playsPoorly(rate.fps, rate.fileFps * reads), big = oversized(rate.height, shown.filmHeight);
  // slow: the light copy that plays anywhere; oversized only: a copy at the film's own height
  const height = slow ? PROXY_HEIGHT : shown.filmHeight;
  if (!(slow || big) || !proxySize(rate.width, rate.height, height)) return false;
  const text = slow
    ? t('panel.proxyText', { name, fps: Math.round(rate.fps), need: Math.round(rate.fileFps * reads) })
    : t('panel.proxyOversized', { name, lines: rate.height, film: shown.filmHeight });
  if (!(await askUser(t('panel.proxyTitle'), text, t('panel.makeProxy')))) {
    decline(project.id, asset);
    return false;
  }
  if (!sameFileProject(project)) return false;
  const { listCommands } = await import('./ai/commands.ts'), { runCommand } = await import('./ai/conversation.ts');
  if (!sameFileProject(project)) return false;
  const cmd = listCommands(S.registry.peek()).find((c) => c.name === 'proxy');
  if (!cmd) return false;
  await runCommand(cmd, { video: asset, height });
  return true;
}

/** a project just opened: each of its videos measured, one after the other, a proxy offered where one is needed */
export async function offerProxies(project: FileProject, url: (asset: string) => string) {
  for (const [id, a] of Object.entries(S.doc.peek().assets)) {
    if (!sameFileProject(project)) return;
    if (a.type !== 'video' || a.proxy) continue;
    await offerProxy(project, id, url(id), a.name ?? id).catch(() => false);
  }
}
