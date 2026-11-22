// What a sound or a video says is transcribed when the user asks for it,
// never on its own: one control wherever a media shows (a file joined to a
// message, the material of the film, the assets, the inspector of its layer,
// the menus), reading the same state everywhere: to transcribe, under way, done.

import { staticValue, type Layer } from '@tramme/core';
import { S, toast } from '../state.ts';
import { cancelled, transcribeAsset, transcribing, transcriptIdOf } from '../speech.ts';
import type { MenuEntry } from './controls.tsx';
import { Icon } from './icons.tsx';
import { t } from '../i18n/index.ts';

/** starts the transcription of a media asset (or waits for the one under way); a failure is told */
export const transcribe = (asset: string) => { transcribeAsset(asset).catch((e) => { if (!cancelled(e)) toast(t('common.couldNotTranscribeError', { error: (e as Error).message }), 'error', 9000); }); };

/** the media asset a layer plays, when it is a sound or a video of the project */
export function mediaOf(l: Layer | undefined): string | null {
  const id = l?.type === 'video' ? staticValue(l.props?.video) : l?.type === 'audio' ? staticValue(l.props?.audio) : null;
  const a = typeof id === 'string' ? S.doc.value.assets[id] : undefined;
  return a && (a.type === 'audio' || a.type === 'video') ? (id as string) : null;
}

const transcribed = (asset: string) => !!S.doc.value.assets[transcriptIdOf(asset)];

/** the menu entry: transcribe, or again once done */
export function transcribeItem(asset: string): MenuEntry {
  return {
    label: transcribed(asset) ? t('panel.transcribeAgain') : t('panel.transcribeSpeech'),
    icon: 'chat',
    disabled: transcribing(asset),
    onClick: () => transcribe(asset),
  };
}

/** the state and the button: a button to transcribe, a spinner while it runs, a tag once done; small: the button is a tag too (inside a chip or a tile) */
export function TranscribeButton({ asset, small }: { asset: string; small?: boolean }) {
  if (transcribing(asset)) return <span class="tag accent"><Icon name="spinner" class="spin" />{t('transcribe.running')}</span>;
  if (transcribed(asset)) return <span class="tag ok" title={t('transcribe.doneHint')}><Icon name="check" />{t('transcribe.done')}</span>;
  const go = (e: MouseEvent) => { e.stopPropagation(); transcribe(asset); };
  return (
    <button class={small ? 'tag tag-btn' : 'btn sm outline'} title={t('transcribe.hint')} onClick={go} onPointerDown={(e) => e.stopPropagation()}>
      <Icon name="chat" />{t('transcribe.action')}
    </button>
  );
}
