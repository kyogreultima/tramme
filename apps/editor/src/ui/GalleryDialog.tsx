// Publishing the film just exported in the gallery (gallery.ts): its title,
// its words, whether it is listed or reachable by its link only, whether others
// may copy the project; then its address on the site. A film already published
// is updated, or taken off.

import { useEffect, useState } from 'preact/hooks';
import { myFilms, publish, unpublish, type Published } from '../gallery.ts';
import { t } from '../i18n/index.ts';
import { comp, S, toast } from '../state.ts';
import { Modal, Seg, Toggle } from './controls.tsx';
import { Icon } from './icons.tsx';

export function GalleryDialog({ video, onClose }: { video: Blob; onClose: () => void }) {
  const project = S.project.peek(), c = comp.peek();
  const [before, setBefore] = useState<Published | null | undefined>(undefined);
  const [title, setTitle] = useState(project.name);
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('public');
  const [reusable, setReusable] = useState(true);
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setBefore(undefined);
    setLoadError(null);
    void myFilms().then((list) => {
      const p = list.find((f) => f.project === project.id) ?? null;
      setBefore(p);
      if (p) { setTitle(p.title); setDescription(p.description); setVisibility(p.visibility); setReusable(p.reusable); }
    }).catch((error: unknown) => setLoadError((error as Error).message));
  };
  useEffect(load, []);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (step || !title.trim()) return;
    try {
      const r = await publish({ projectId: project.id, video, title: title.trim(), description: description.trim(), visibility, reusable, width: c.width, height: c.height, duration: c.duration },
        (s) => setStep(s === 'still' ? t('gallery.stepStill') : s === 'archive' ? t('gallery.stepArchive') : t('gallery.stepUpload')));
      setDone(r.url);
      for (const w of r.warnings) toast(w, 'info', 9000);
    } catch (x) {
      toast(t('gallery.failed', { error: (x as Error).message }), 'error');
    }
    setStep(null);
  };
  const takeOff = async () => {
    try { await unpublish(project.id); toast(t('gallery.takenOff')); onClose(); } catch (x) { toast(t('gallery.failed', { error: (x as Error).message }), 'error'); }
  };

  if (done) return (
    <Modal title={t('gallery.title')} onClose={onClose}>
      <div class="modal-body">
        <p>{t('gallery.published')}</p>
        <span class="field"><input readOnly value={done} onFocus={(e) => (e.target as HTMLInputElement).select()} /></span>
        <div class="modal-foot">
          <button class="btn ghost" onClick={() => { void navigator.clipboard?.writeText(done); toast(t('gallery.copied')); }}><Icon name="copy" />{t('gallery.copyLink')}</button>
          <a class="btn solid" href={done} target="_blank" rel="noopener">{t('gallery.see')}</a>
        </div>
      </div>
    </Modal>
  );

  return (
    <Modal title={t('gallery.title')} onClose={() => { if (!step) onClose(); }}>
      <form class="modal-body" onSubmit={submit}>
        <p>{before ? t('gallery.leadAgain') : t('gallery.lead')}</p>
        <span class="field"><input value={title} maxLength={120} placeholder={t('gallery.filmTitle')} aria-label={t('gallery.filmTitle')} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></span>
        <span class="field area"><textarea value={description} maxLength={2000} rows={3} placeholder={t('gallery.description')} aria-label={t('gallery.description')} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} /></span>
        <Seg value={visibility} onChange={(v) => setVisibility(v as 'public' | 'unlisted')} ariaLabel={t('gallery.visibility')}
          options={[['public', t('gallery.public')], ['unlisted', t('gallery.unlisted')]]} />
        <span class="faint">{visibility === 'public' ? t('gallery.publicHint') : t('gallery.unlistedHint')}</span>
        <label class="gallery-toggle"><span>{t('gallery.reusable')}</span><Toggle on={reusable} onChange={setReusable} /></label>
        {loadError && <div class="prop-note err">{t('gallery.listFailed', { error: loadError })} <button class="btn sm" type="button" onClick={load}>{t('gallery.retry')}</button></div>}
        {step && <span class="faint">{step}</span>}
        <div class="modal-foot">
          {before && <button class="btn ghost danger" type="button" disabled={!!step} onClick={takeOff}>{t('gallery.takeOff')}</button>}
          <button class="btn ghost" type="button" disabled={!!step} onClick={onClose}>{t('common.cancel')}</button>
          <button class="btn solid" type="submit" disabled={!!step || !title.trim() || before === undefined || !!loadError}>{before ? t('gallery.update') : t('gallery.publish')}</button>
        </div>
      </form>
    </Modal>
  );
}
