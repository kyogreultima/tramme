// The Plugins section of the settings (docs/installed-plugins-roadmap.md,
// step 2): the plugins installed on this device, where they are kept, each
// with what it brings, turned on or off, updated or removed; an import by
// the file picker or a drop, with the install question before any of its
// code runs; and every plugin backed up in one file and brought back.

import { useEffect, useRef, useState } from 'preact/hooks';
import { PLUGIN_API } from '@tramme/core';
import { asksMore, compareVersions } from '@tramme/project';
import { backup, canPickFolder, copiesIn, stopped, copyId, copyOps, offIn, candidateOf, folderAccess, folderName, forgetFolder, install, installed, persistence, pickFolder, refreshInstalled, restoreBackup, setEnabled, storageKind, uninstall, type Candidate, type Installed } from '../installed.ts';
import { tauri } from '../tauri.ts';
import { api } from '../api.ts';
import { preview } from '../preview.ts';
import { KIND_LABEL } from '../importer.ts';
import { confirmWith } from '../confirm.ts';
import { saveBlob } from '../download.ts';
import { commit, S, toast } from '../state.ts';
import { t } from '../i18n/index.ts';
import { Toggle } from './controls.tsx';
import { Icon } from './icons.tsx';
import { Row, Section } from './SettingsRows.tsx';

const kinds = (k: string[]) => k.map((x) => KIND_LABEL[x]?.() ?? x).join(', ');
const reach = (p: Candidate['added']) => [...p.network, ...p.providers.map((x) => t('plugins.provider', { name: x })), ...p.files.map((x) => t('plugins.writes', { path: x }))].join(', ');

/** the install question: what it brings and may reach, its API; nothing of it has run */
async function ask(c: Candidate): Promise<boolean> {
  const m = c.manifest;
  if (m.api > PLUGIN_API) { toast(t('plugins.newerApi', { name: m.name, api: m.api, ours: PLUGIN_API }), 'error'); return false; }
  const who = [m.author && t('plugins.by', { author: m.author }), m.licence].filter(Boolean).join(' · ');
  if (c.replaces) {
    // an update: asked again only when it asks more
    if (!asksMore(c.added)) return true;
    return confirmWith(t('plugins.updateTitle', { name: m.name, from: c.replaces.manifest.version, to: m.version }), t('plugins.updateMore', { reach: reach(c.added) }), t('plugins.update'));
  }
  const text = [
    `${m.name} ${m.version}${who ? ` (${who})` : ''}`,
    m.description ?? '',
    m.kinds.length ? t('plugins.brings', { kinds: kinds(m.kinds) }) : t('plugins.bringsNothing'),
    asksMore(m.permissions) ? t('plugins.mayReach', { reach: reach(m.permissions) }) : t('plugins.reachesNothing'),
    t('plugins.sandboxed'),
  ].filter(Boolean).join('\n');
  return confirmWith(t('plugins.installTitle', { name: m.name }), text, t('plugins.install'));
}

async function importFiles(list: FileList | File[]) {
  for (const f of [...list]) {
    try {
      if (/\.zip$/i.test(f.name)) { const n = await restoreBackup(f); toast(t('plugins.restored', { n }), 'info'); continue; }
      const c = await candidateOf(f);
      if (!(await ask(c))) continue;
      await install(c);
      toast(c.replaces ? t('plugins.updated', { name: c.manifest.name, version: c.manifest.version }) : t('plugins.installed', { name: c.manifest.name }), 'info');
    } catch (e) { toast((e as Error).message, 'error'); }
  }
}

/** an installed plugin turned off or on in the open project (its document keeps the list) */
function setInProject(id: string, on: boolean) {
  const doc = S.doc.peek(), off = offIn(doc).filter((x) => x !== id);
  const value = on ? off : [...off, id];
  commit(on ? t('plugins.onHere') : t('plugins.offHere'), [{ op: doc.meta.pluginsOff === undefined ? 'add' : 'replace', path: '/meta/pluginsOff', value }]);
}

/** the installed version put in the open project in place of its copy (asked per project, never done alone) */
async function useInProject(p: Installed) {
  const doc = S.doc.peek(), { ops, files } = copyOps(doc, p);
  for (const [path, blob] of files) await api.write(S.project.peek().id, path, blob, blob.type ? { type: blob.type } : {});
  if (commit(t('plugins.usedHere', { name: p.manifest.name, version: p.manifest.version }), ops)) await preview.reload([copyId(p)]);
}

function PluginRow({ p }: { p: Installed }) {
  const [sure, setSure] = useState(false);
  const m = p.manifest;
  // this project's copy, older than the one installed: offered, never applied alone
  const copy = S.project.value ? copiesIn(S.doc.value)[m.id] : undefined;
  const older = copy !== undefined && compareVersions(copy, m.version) < 0;
  return (
    <Row label={`${m.name} ${m.version}`} badge={stopped.value.has(m.id) ? t('plugins.stoppedBadge') : m.id.startsWith('local/') ? undefined : m.id} hint={[m.description, m.kinds.length ? t('plugins.brings', { kinds: kinds(m.kinds) }) : '', asksMore(m.permissions) ? t('plugins.mayReach', { reach: reach(m.permissions) }) : '', `${(p.size / 1024).toFixed(1)} KB${p.files.size ? ` · ${t('plugins.nFiles', { n: p.files.size })}` : ''}`].filter(Boolean).join(' · ')}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {older && <button class="btn sm" title={t('plugins.olderHere', { name: m.name, copy, version: m.version })} onClick={() => useInProject(p).catch((e) => toast((e as Error).message, 'error'))}>{t('plugins.useHere', { version: m.version })}</button>}
        {S.project.value && p.enabled && <span class="hint" style={{ fontSize: 11 }}>{t('plugins.inProject')}</span>}
        {S.project.value && p.enabled && <Toggle on={!offIn(S.doc.value).includes(m.id)} onChange={(v) => setInProject(m.id, v)} />}
        <Toggle on={p.enabled} onChange={(v) => setEnabled(p, v)} />
        {sure
          ? <button class="btn sm danger" onClick={() => uninstall(p).catch((e) => toast((e as Error).message, 'error'))}>{t('plugins.removeSure')}</button>
          : <button class="icon-btn" title={t('common.remove')} onClick={() => setSure(true)}><Icon name="trash" /></button>}
      </div>
    </Row>
  );
}

export function Plugins() {
  const input = useRef<HTMLInputElement>(null), restore = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [locked, setLocked] = useState(false);
  // the list follows the folder: read again when the window comes back
  useEffect(() => {
    folderAccess().then((ok) => setLocked(!ok));
    const again = () => { refreshInstalled().catch(() => {}); };
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
  const kind = storageKind.value;
  const where = kind === 'desktop' ? t('plugins.whereDesktop') : kind === 'folder' ? t('plugins.whereFolder', { name: folderName.value ?? '' }) : kind === 'browser' ? t('plugins.whereBrowser') : t('plugins.whereServer');
  const list = installed.value;
  const newer = (p: Installed) => list.some((q) => q !== p && q.manifest.id === p.manifest.id && compareVersions(q.manifest.version, p.manifest.version) > 0);
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer?.files.length) void importFiles(e.dataTransfer.files); }} class={over ? 'drop-over' : ''}>
      <Section title={t('plugins.title')} hint={t('plugins.hint')}>
        <Row label={t('plugins.where')} hint={where}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {kind === 'desktop' && <button class="btn sm" onClick={() => tauri!.core.invoke('desktop_open_plugins').catch((e) => toast(String(e), 'error'))}><Icon name="folder" />{t('plugins.openFolder')}</button>}
            {canPickFolder() && kind !== 'folder' && <button class="btn sm" onClick={() => pickFolder().catch((e) => { if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error'); })}><Icon name="folder" />{t('plugins.pickFolder')}</button>}
            {kind === 'folder' && locked && <button class="btn sm" onClick={async () => { if (await folderAccess(true)) { setLocked(false); await refreshInstalled(); } }}><Icon name="unlock" />{t('plugins.allowAgain')}</button>}
            {kind === 'folder' && <button class="btn sm" onClick={() => forgetFolder()}>{t('plugins.forgetFolder')}</button>}
            <button class="icon-btn" title={t('plugins.readAgain')} onClick={() => refreshInstalled()}><Icon name="loop" /></button>
          </div>
        </Row>
        {kind === 'browser' && persistence.value === 'refused' && <Row label={t('plugins.notPersistent')} hint={t('plugins.notPersistentHint')}><span /></Row>}
        <Row label={t('plugins.import')} hint={t('plugins.importHint')}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button class="btn sm" onClick={() => input.current?.click()}><Icon name="upload" />{t('plugins.choose')}</button>
            <input ref={input} type="file" multiple accept=".js,.mjs,.trammeplugin,.zip" style={{ display: 'none' }} onChange={(e) => { const f = (e.target as HTMLInputElement).files; if (f) void importFiles(f); (e.target as HTMLInputElement).value = ''; }} />
          </div>
        </Row>
        <Row label={t('plugins.backup')} hint={t('plugins.backupHint')}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button class="btn sm" disabled={!list.length} onClick={() => saveBlob(backup(), 'tramme-plugins.zip')}><Icon name="download" />{t('plugins.exportAll')}</button>
            <button class="btn sm" onClick={() => restore.current?.click()}>{t('plugins.importBackup')}</button>
            <input ref={restore} type="file" accept=".zip" style={{ display: 'none' }} onChange={(e) => { const f = (e.target as HTMLInputElement).files; if (f) void importFiles(f); (e.target as HTMLInputElement).value = ''; }} />
          </div>
        </Row>
      </Section>
      <Section title={t('plugins.installedTitle', { n: list.length })}>
        {list.length ? list.map((p) => <PluginRow key={p.file} p={p} />) : <Row label={t('plugins.none')} hint={t('plugins.noneHint')}><span /></Row>}
        {list.some(newer) && <Row label="" hint={t('plugins.duplicates')}><span /></Row>}
      </Section>
    </div>
  );
}
