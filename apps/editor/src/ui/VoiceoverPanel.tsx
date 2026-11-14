// The voice-over panel of the timeline: the words to say, the short list of
// voices of the provider that speaks (a warm one, a deep narrator, a lively
// one, a soft one, a clear one), each heard on a sample sentence, the whole
// library one click away in the Sound settings; the first take lands on a new
// voice track at the playhead, the music ducked under it and the voice
// cleanup on it, in one step of the history.

import { useEffect, useState } from 'preact/hooks';
import type { Voice } from '@tramme/api';
import { api } from '../api.ts';
import { payFor } from '../confirm.ts';
import { fileProject, sameFileProject } from '../files.ts';
import { locale, m, t } from '../i18n/index.ts';
import { freshId, snap } from '../model.ts';
import { openSettings, prefs } from '../settings.ts';
import { comp, commit, S, select, toast } from '../state.ts';
import { firstTakeOps, sampleName, shortlistFor, type ShortVoice, type Tone } from '../voice-shortlist.ts';
import { Icon } from './icons.tsx';
import { useListen } from './listen.ts';

const TONE: Record<Tone, string> = { warm: m('voiceover.tone.warm'), narrator: m('voiceover.tone.narrator'), lively: m('voiceover.tone.lively'), soft: m('voiceover.tone.soft'), clear: m('voiceover.tone.clear') };

/** the provider that speaks: the one chosen in the Sound settings, else the first the server offers */
async function speaker(): Promise<string | null> {
  const chosen = prefs.peek().voiceProvider;
  if (chosen !== 'auto') return chosen;
  const first = await api.voices({}).catch(() => [] as Voice[]);
  return first[0]?.provider ?? null;
}

/** a sound's length in seconds */
async function secondsOf(blob: Blob): Promise<number> {
  const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
  return Math.round(buf.duration * 1000) / 1000;
}

const extOf = (type: string) => (/wav/.test(type) ? 'wav' : /ogg|opus/.test(type) ? 'ogg' : 'mp3');

export function VoiceoverPanel({ onDone }: { onDone: () => void }) {
  const [provider, setProvider] = useState<string | null | undefined>(undefined);
  const [available, setAvailable] = useState<Voice[] | null>(null);
  const [words, setWords] = useState('');
  const [voice, setVoice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { playing, play } = useListen();

  useEffect(() => {
    let live = true;
    void speaker().then(async (p) => {
      if (!live) return;
      setProvider(p);
      if (p) setAvailable(await api.voices({ provider: p }).catch(() => null));
    });
    return () => { live = false; };
  }, []);
  const list: ShortVoice[] = provider ? shortlistFor(provider, prefs.value.voiceShortlist, available) : [];
  useEffect(() => { if (!voice && list.length) setVoice(list.find((v) => v.id === prefs.peek().voice)?.id ?? list[0].id); }, [list.length]);

  /** a voice heard on the sample sentence: the provider's own sample in English, else one made once and kept in the sound library */
  const listen = async (v: ShortVoice) => {
    if (!provider || playing === v.id) { play(v.id, ''); return; }
    const own = available?.find((a) => a.id === v.id)?.preview;
    if (own && locale === 'en') { play(v.id, own); return; }
    const name = sampleName(provider, v.id, locale), url = api.soundUrl(name);
    if ((await fetch(url, { method: 'HEAD' }).catch(() => null))?.ok) { play(v.id, url); return; }
    setBusy(v.id);
    try {
      await payFor(t('voiceover.sampleTitle'), t('voiceover.sampleText', { voice: v.name }), t('voiceover.sampleYes'), 'listen to another voice');
      const made = await api.generate({ kind: 'voice', prompt: t('voiceover.sample'), voice: v.id, provider });
      await api.soundPut(name, made.blob, { kind: 'voice-sample', provider, voice: v.id, language: locale });
      play(v.id, url);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };

  const make = async () => {
    const chosen = list.find((v) => v.id === voice);
    if (!provider || !chosen || !words.trim()) return;
    const project = fileProject(), compId = S.compId.peek(), at = snap(S.time.peek(), comp.peek().fps);
    setBusy('take');
    try {
      await payFor(t('voiceover.takeTitle'), t('voiceover.takeText', { voice: chosen.name }), t('voiceover.takeYes'), 'record the voice-over with the microphone');
      const made = await api.generate({ kind: 'voice', prompt: words.trim(), voice: chosen.id, provider, ...(prefs.peek().voiceModel ? { model: prefs.peek().voiceModel } : {}) });
      if (!sameFileProject(project)) return;
      const doc = S.doc.peek(), id = freshId(doc.assets, 'voice'), path = `assets/voice/${id}-${Date.now()}.${extOf(made.blob.type)}`;
      const r = firstTakeOps(doc, compId, id, { src: path, name: t('voiceover.takeName', { voice: chosen.name }), duration: await secondsOf(made.blob) }, at);
      if (!r) { toast(t('timeline.cannotRecordHere'), 'error'); return; }
      await api.writeAny(project.id, path, made.blob);
      if (sameFileProject(project) && commit(t('voiceover.label', { voice: chosen.name }), r.ops)) { select([r.layer]); onDone(); }
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };

  return (
    <div class="voiceover-panel">
      <div style={{ fontWeight: 600 }}>{t('voiceover.title')}</div>
      <textarea class="voiceover-words" rows={4} placeholder={t('voiceover.wordsPlaceholder')} value={words} onInput={(e) => setWords((e.currentTarget as HTMLTextAreaElement).value)} />
      {provider === null && <p class="faint">{t('voiceover.noProvider')}</p>}
      {provider === undefined && <p class="faint"><Icon name="spinner" /></p>}
      {provider && (
        <ul class="voiceover-voices" role="radiogroup" aria-label={t('voiceover.voices')}>
          {list.map((v) => (
            <li key={v.id} class={voice === v.id ? 'on' : ''}>
              <button class="icon-btn sm" disabled={busy === v.id} title={playing === v.id ? t('settings.stopListening') : t('settings.listen')} aria-label={t('settings.listen')} onClick={() => { void listen(v); }}>
                <Icon name={busy === v.id ? 'spinner' : playing === v.id ? 'stop' : 'play'} />
              </button>
              <button class="voiceover-voice" role="radio" aria-checked={voice === v.id} onClick={() => setVoice(v.id)}>
                <span>{v.name}</span>{v.tone && <span class="faint">{t(TONE[v.tone])}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div class="voiceover-foot">
        <button class="btn sm ghost" onClick={() => { onDone(); openSettings('sound'); }}><Icon name="search" />{t('voiceover.library')}</button>
        <button class="btn sm primary" disabled={!provider || !voice || !words.trim() || busy !== null} onClick={() => { void make(); }}>
          <Icon name={busy === 'take' ? 'spinner' : 'check'} />{t('voiceover.make')}
        </button>
      </div>
    </div>
  );
}
