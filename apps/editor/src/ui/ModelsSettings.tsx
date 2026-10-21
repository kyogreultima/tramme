// The settings' "Models" section (docs/editing-roadmap.md, step 1): the tasks
// the editor runs on this machine, those on the picture then those on the
// sound, one line each: the model chosen (the default marked), its size,
// licence and whether it is in this browser, and a button that downloads it
// ahead of its tool or deletes it to free the space. A model hub id can stand
// in for a task that goes through a pipeline, tried on a blank input before
// it is kept. The choice is per computer (preferences).

import { useEffect, useState } from 'preact/hooks';
import { cachedFiles, cachedOf, deleteCached, downloadModel, groupCache, type CachedFile } from '../model-cache.ts';
import { HUB_PREFIX, isHubId, MODEL_TASKS, modelsFor, PIPELINE_OF, resolveModel, type ModelEntry, type ModelTask } from '../models.ts';
import { tryPipeline } from '../perception.ts';
import { prefs, setPrefs } from '../settings.ts';
import { toast } from '../state.ts';
import { m, t } from '../i18n/index.ts';
import { Select } from './controls.tsx';
import { Icon } from './icons.tsx';
import { Row, Section } from './SettingsRows.tsx';

const TASK: Record<ModelTask, string> = {
  'cutout-person': m('localModels.cutoutPerson'),
  'cutout-any': m('localModels.cutoutAny'),
  detection: m('localModels.detection'),
  depth: m('localModels.depth'),
  transcription: m('localModels.transcription'),
  vad: m('localModels.vad'),
  face: m('localModels.face'),
};

/** what to know before choosing a model, by its id */
const NOTE: Record<string, string> = {
  'u2netp-person': m('localModels.noteU2netpPerson'),
  u2net: m('localModels.noteU2net'),
  'isnet-general': m('localModels.noteIsnet'),
  'yolos-small': m('localModels.noteYolosSmall'),
  'depth-anything-v2-base': m('localModels.noteNonCommercial'),
  'whisper-base': m('localModels.noteWhisperBase'),
  'whisper-tiny': m('localModels.noteWhisperTiny'),
  'whisper-large-v3-turbo': m('localModels.noteWhisperLarge'),
};

/** the tasks on the picture, then those on the sound */
const PICTURE: ModelTask[] = ['cutout-person', 'cutout-any', 'detection', 'depth', 'face'];
const SOUND: ModelTask[] = ['transcription', 'vad'];

const bytes = (n: number) => size(n / 1e6);
const size = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`);

export const setModel = (task: ModelTask, id: string) => setPrefs({ models: { ...prefs.peek().models, [task]: id } });

/** the cache's files, read again after a download or a deletion */
const useCache = (): [CachedFile[], () => void] => {
  const [files, setFiles] = useState<CachedFile[]>([]);
  const [round, setRound] = useState(0);
  useEffect(() => { let live = true; void cachedFiles().then((f) => { if (live) setFiles(f); }); return () => { live = false; }; }, [round]);
  return [files, () => setRound((r) => r + 1)];
};

/**
 * A task on one line: the model chosen, and under it its size (measured once
 * it is here), its licence and where it stands in this browser; beside it a
 * download, or a delete. A model other than the default says what to know of it.
 */
function ModelRow({ task, files, changed }: { task: ModelTask; files: CachedFile[]; changed: () => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const chosen = resolveModel(task, prefs.value.models[task]);
  const list = modelsFor(task);
  const options: [string, string][] = list.map((e, i) => [e.id, i === 0 ? t('localModels.byDefault', { name: e.name }) : e.name]);
  if (!list.includes(chosen)) options.push([chosen.id, chosen.name]);
  const here = cachedOf(chosen, files);
  const download = async () => {
    setProgress(0);
    try { await downloadModel(chosen, (loaded, total) => setProgress(total ? loaded / total : 0)); }
    catch (e) { toast(t('localModels.downloadFailed', { name: chosen.name, error: (e as Error).message }), 'error'); }
    finally { setProgress(null); changed(); }
  };
  const remove = async () => { await deleteCached(here.urls); changed(); };
  const hint = [
    here.bytes ? bytes(here.bytes) : chosen.mb ? t('localModels.aboutSize', { size: size(chosen.mb) }) : '',
    chosen.licence,
    here.bytes ? t('localModels.inThisBrowser') : progress !== null ? t('localModels.downloading', { percent: Math.round(progress * 100) }) : t('localModels.notDownloaded'),
  ].filter(Boolean).join(' · ');
  const warnings = chosen === list[0] ? [] : [
    chosen.commercial === false ? t('localModels.notCommercial') : chosen.commercial === null ? t('localModels.ownLicence') : '',
    chosen.checked ? '' : t('localModels.notTried'),
    NOTE[chosen.id] ? t(NOTE[chosen.id]) : '',
  ].filter(Boolean);
  return (
    <Row label={t(TASK[task])} hint={hint} below={warnings.length > 0 && <p class="set-note models-note">
      {chosen.commercial === false && <Icon name="alert" />}{warnings.join(' · ')}
    </p>}>
      <div class="set-actions models-actions">
        <Select value={chosen.id} options={options} onChange={(id) => setModel(task, id)} />
        {here.bytes
          ? <button class="icon-btn sm" title={t('common.delete')} aria-label={t('common.delete')} onClick={remove}><Icon name="trash" /></button>
          : <button class="icon-btn sm" title={t('localModels.download')} aria-label={t('localModels.download')} disabled={progress !== null} onClick={download}><Icon name={progress !== null ? 'spinner' : 'download'} /></button>}
      </div>
    </Row>
  );
}

/** a model hub id for a task that goes through a pipeline: kept once it loaded and answered a blank input */
function HubRow() {
  const tasks = MODEL_TASKS.filter((task) => PIPELINE_OF[task]);
  const [task, setTask] = useState(tasks[0]);
  const [id, setId] = useState('');
  const [trying, setTrying] = useState(false);
  const run = async () => {
    const hubId = id.trim();
    if (!isHubId(hubId)) { toast(t('localModels.notAHubId', { id: hubId }), 'error'); return; }
    setTrying(true);
    try {
      await tryPipeline(resolveModel(task, HUB_PREFIX + hubId));
      setModel(task, HUB_PREFIX + hubId);
      setId('');
      toast(t('localModels.hubModelKept', { id: hubId, task: t(TASK[task]) }), 'info');
    } catch (e) {
      toast(t('localModels.hubModelFailed', { id: hubId, error: (e as Error).message }), 'error');
    } finally { setTrying(false); }
  };
  return (
    <Row stack label={t('localModels.hubModel')} hint={t('localModels.hubModelHint')}>
      <div class="set-pair models-hub">
        <Select value={task} options={tasks.map((k) => [k, t(TASK[k])])} onChange={(k) => setTask(k as ModelTask)} />
        <div class="field"><input value={id} placeholder="owner/model" spellcheck={false} aria-label={t('localModels.hubModel')} onInput={(e) => setId((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} /></div>
        <button class="btn sm" disabled={trying || !id.trim()} onClick={run}><Icon name={trying ? 'spinner' : 'check'} />{t('localModels.tryAndUse')}</button>
      </div>
    </Row>
  );
}

/** what else the cache holds: models the user named, older versions; each can be deleted */
function Others({ files, changed }: { files: CachedFile[]; changed: () => void }) {
  const used = new Set(MODEL_TASKS.flatMap((task) => cachedOf(resolveModel(task, prefs.value.models[task]), files).urls));
  const others = groupCache(files.filter((f) => !used.has(f.url)));
  const total = files.reduce((n, f) => n + f.bytes, 0);
  return (
    <Section title={t('localModels.cacheTitle')} hint={t('localModels.cacheHint', { size: bytes(total) })}>
      {others.length ? others.map((g) => (
        <Row key={g.id} label={g.name} hint={bytes(g.bytes)}>
          <button class="btn ghost sm" onClick={async () => { await deleteCached(g.urls); changed(); }}><Icon name="trash" />{t('common.delete')}</button>
        </Row>
      )) : <div class="set-info"><Icon name="info" /><span>{t('localModels.nothingElse')}</span></div>}
    </Section>
  );
}

export function LocalModels() {
  const [files, changed] = useCache();
  return (
    <>
      <Section title={t('localModels.picture')} hint={t('localModels.hint')}>
        {PICTURE.map((task) => <ModelRow key={task} task={task} files={files} changed={changed} />)}
      </Section>
      <Section title={t('localModels.sound')} hint={t('localModels.soundHint')}>
        {SOUND.map((task) => <ModelRow key={task} task={task} files={files} changed={changed} />)}
      </Section>
      <Section title={t('localModels.advanced')} hint={t('localModels.advancedHint')}>
        <HubRow />
      </Section>
      <Others files={files} changed={changed} />
    </>
  );
}
