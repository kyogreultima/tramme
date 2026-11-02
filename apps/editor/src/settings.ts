// Preferences of this machine (kept in the browser, not in the project): how
// much the preview may cost (a powerful computer keeps everything at full
// quality, a modest one lets the preview adapt; exports always render at full
// quality), and how the sound tools work by default.

import { effect, signal } from '@preact/signals';
import { MODEL_TASKS, resolveModel, type ModelEntry, type ModelTask } from './models.ts';
import type { DictationSource } from './speech.ts';
import { FORMER_PREFERENCES_KEY, PREFERENCES_KEY, savedTheme, showTheme, VIEWS, type ThemeId, type View } from './theme/pref.ts';
import { installGlassLight } from './theme/liquid-glass.ts';

export interface Preferences {
  /** interface language: the browser's (French or English), or chosen */
  language: 'auto' | 'fr' | 'en';
  /** the theme: one palette, or as the system says */
  theme: ThemeId;
  /** how the interface works: the studio (the film directed in notes) or the atelier (layers, timeline, inspector) */
  view: View;
  /** render size while playing, dragging or scrubbing */
  motion: 'auto' | 'full' | 'half' | 'quarter';
  /** render size once still: the size shown on screen, or the composition's full size */
  still: 'display' | 'full';
  /** motion blur in the preview: the document's, at most 4 sub-frames, or none */
  blur: 'document' | 'limited' | 'off';
  /** playback draws the composition's own frames (24, 30 i/s…), as the export, instead of every screen refresh */
  exactFrames: boolean;
  /** dragging the playhead plays a short window of the sound at each step */
  scrubAudio: boolean;
  /** experimental: the whole picture — built-ins, plugins, modifiers, effects, simulations — is evaluated and drawn in the project's sandbox */
  sandboxPreview: boolean;
  /** sound: the level (dB) of the effects the tools place, of the music beds, and how much a music drops under a voice */
  effectsDb: number;
  musicDb: number;
  duckDb: number;
  /** a sound placed on several moments alternates its variants */
  varySounds: boolean;
  /** a sound made by a provider (it costs money) waits for the user's yes */
  confirmPaid: boolean;
  /** paid generations a turn of the assistant may make when its changes apply without the user (nothing is asked then) */
  paidPerTurn: number;
  /** voice-overs: the provider (auto: the first the server has a key for) and the voice ('' for its own) */
  voiceProvider: 'auto' | 'elevenlabs' | 'openai' | 'gemini' | 'hydracept';
  voice: string;
  /** the ElevenLabs voice model ('' for the newest, Eleven v4) */
  voiceModel: string;
  /** what the preview plays at, 0 to 1, and muted; the exports keep the mix as it is */
  previewVolume: number;
  previewMuted: boolean;
  /** the preview plays a video's proxy when it has one (the exports always read the original) */
  proxies: boolean;
  /** the model each local tool downloads and runs, per task: a model's id, or 'hub:owner/name'; missing, the default (models.ts) */
  models: Partial<Record<ModelTask, string>>;
  /** installed plugins turned off on this device (their file names) */
  pluginsOff: string[];
  /** the studio: after an area is drawn, the layers it proposes are confirmed always, only when more than three, or never */
  areaConfirm: 'always' | 'many' | 'never';
  /** look for a newer version on its own, every twelve hours */
  checkUpdates: boolean;
  /** when it looked last (ms), and the newest version the user was told of */
  lastUpdateCheck: number;
  updateNotified: string;
  /** the / menu's commands used last, its first lines when it opens empty (at most six) */
  recentCommands: string[];
  /** pictures made by a provider: the one by default (auto: the first connected), the quality (auto: the tool's choice), the size at most (small costs less) */
  pictureProvider: 'auto' | 'openai' | 'gemini' | 'zai' | 'hydracept';
  pictureQuality: 'auto' | 'low' | 'medium' | 'high';
  pictureSize: 'small' | 'large';
  /** style frames drawn from a film's directions before it is built: how many (0 turns them off; each is a paid picture) */
  styleFrames: 0 | 2 | 3;
  /** clips made by a provider: the one by default (auto: the first connected), and their length in seconds */
  videoProvider: 'auto' | 'hydracept';
  videoSeconds: 4 | 6 | 8;
  /** where a dictation is transcribed: the downloaded model (this browser, the default), the companion, or the server */
  dictation: DictationSource;
}

export const DEFAULT_PREFERENCES: Preferences = {
  language: 'auto', theme: 'studio', view: 'studio', motion: 'auto', still: 'display', blur: 'document', exactFrames: true, scrubAudio: true, sandboxPreview: false,
  effectsDb: -8, musicDb: -14, duckDb: -12, varySounds: true, confirmPaid: true, paidPerTurn: 10, voiceProvider: 'auto', voice: '', voiceModel: '', previewVolume: 1, previewMuted: false, proxies: true, models: {}, pluginsOff: [], areaConfirm: 'always', checkUpdates: true, lastUpdateCheck: 0, updateNotified: '', recentCommands: [],
  pictureProvider: 'auto', pictureQuality: 'auto', pictureSize: 'large', styleFrames: 2,
  videoProvider: 'auto', videoSeconds: 8, dictation: 'local',
};

// ── themes and views ─────────────────────────────────────────
export { VIEWS, type ThemeId, type View };

/** a theme as the picker shows it: its id and the colours that draw its preview (its name's key lives beside the picker) */
export interface ThemeInfo { id: ThemeId; bg: string; surface: string; text: string; accent: string }
export const THEMES: ThemeInfo[] = [
  { id: 'studio', bg: 'var(--tramme-dark-bg)', surface: 'var(--tramme-dark-surface)', text: 'var(--tramme-dark-text)', accent: 'var(--tramme-dark-accent)' },
  { id: 'obsidian', bg: '#050708', surface: '#0c0f10', text: '#e9eef0', accent: 'var(--tramme-dark-accent)' },
  { id: 'carbon', bg: '#101010', surface: '#191919', text: '#ededed', accent: 'var(--tramme-dark-accent)' },
  { id: 'dusk', bg: '#150f0a', surface: '#1e1812', text: '#f4ebe2', accent: 'var(--tramme-dark-accent)' },
  { id: 'paper', bg: 'var(--tramme-light-bg)', surface: 'var(--tramme-light-surface)', text: 'var(--tramme-light-text)', accent: 'var(--tramme-light-accent)' },
  { id: 'linen', bg: '#f7f3ec', surface: '#fffdf8', text: '#221d14', accent: '#0c7f6b' },
  { id: 'porcelain', bg: '#eef2f6', surface: '#ffffff', text: '#151a21', accent: '#0b7f95' },
  { id: 'liquid-glass', bg: '#ededee', surface: 'rgba(255, 255, 255, 0.62)', text: '#202023', accent: '#29292c' },
  { id: 'system', bg: 'var(--tramme-dark-bg)', surface: 'var(--tramme-dark-surface)', text: 'var(--tramme-dark-text)', accent: 'var(--tramme-dark-accent)' },
];
const VOICE_PROVIDERS = ['auto', 'elevenlabs', 'openai', 'gemini', 'hydracept'] as const;

/** a number kept within its range, the default when it is not one */
const within = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

// what this browser kept under the tool's former name (trame.*) is carried over once
try {
  const old = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).filter((k) => k.startsWith('trame.'));
  for (const k of old) if (localStorage.getItem(`tramme.${k.slice(6)}`) === null) localStorage.setItem(`tramme.${k.slice(6)}`, localStorage.getItem(k)!);
} catch { /* no storage */ }

function load(): Preferences {
  try {
    // the preferences kept under the tool's former name are taken over
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? localStorage.getItem(FORMER_PREFERENCES_KEY) ?? '{}') as Partial<Preferences>;
    const p = { ...DEFAULT_PREFERENCES, ...saved };
    if (!['auto', 'full', 'half', 'quarter'].includes(p.motion)) p.motion = DEFAULT_PREFERENCES.motion;
    if (!['display', 'full'].includes(p.still)) p.still = DEFAULT_PREFERENCES.still;
    if (!['document', 'limited', 'off'].includes(p.blur)) p.blur = DEFAULT_PREFERENCES.blur;
    p.exactFrames = p.exactFrames !== false;
    p.scrubAudio = p.scrubAudio !== false;
    p.sandboxPreview = p.sandboxPreview === true;
    // the theme preference: the former mode + per-mode themes collapse into one theme
    p.theme = savedTheme(saved);
    // the former display modes (editor, cinema, conversation) gave way to the views: the studio first
    delete (p as Partial<Preferences> & { display?: unknown }).display;
    if (!VIEWS.includes(p.view)) p.view = DEFAULT_PREFERENCES.view;
    if (!['auto', 'fr', 'en'].includes(p.language)) p.language = DEFAULT_PREFERENCES.language;
    const d = DEFAULT_PREFERENCES;
    p.effectsDb = within(p.effectsDb, d.effectsDb, -40, 12);
    p.musicDb = within(p.musicDb, d.musicDb, -40, 12);
    p.duckDb = within(p.duckDb, d.duckDb, -40, -1);
    p.previewVolume = within(p.previewVolume, d.previewVolume, 0, 1);
    p.varySounds = p.varySounds !== false;
    p.confirmPaid = p.confirmPaid !== false;
    p.paidPerTurn = Math.round(within(p.paidPerTurn, d.paidPerTurn, 0, 100));
    p.previewMuted = p.previewMuted === true;
    if (!VOICE_PROVIDERS.includes(p.voiceProvider)) p.voiceProvider = d.voiceProvider;
    if (typeof p.voice !== 'string') p.voice = d.voice;
    if (typeof p.voiceModel !== 'string') p.voiceModel = d.voiceModel;
    p.proxies = p.proxies !== false;
    const models = p.models && typeof p.models === 'object' ? p.models : {};
    p.models = Object.fromEntries(MODEL_TASKS.filter((k) => typeof models[k] === 'string').map((k) => [k, models[k]]));
    p.pluginsOff = Array.isArray(p.pluginsOff) ? p.pluginsOff.filter((x) => typeof x === 'string') : [];
    p.areaConfirm = p.areaConfirm === 'many' || p.areaConfirm === 'never' ? p.areaConfirm : 'always';
    p.checkUpdates = p.checkUpdates !== false;
    p.lastUpdateCheck = Number.isFinite(p.lastUpdateCheck) ? p.lastUpdateCheck : 0;
    p.updateNotified = typeof p.updateNotified === 'string' ? p.updateNotified : '';
    p.recentCommands = Array.isArray(p.recentCommands) ? p.recentCommands.filter((x) => typeof x === 'string').slice(0, 6) : [];
    if (!['auto', 'openai', 'gemini', 'zai', 'hydracept'].includes(p.pictureProvider)) p.pictureProvider = DEFAULT_PREFERENCES.pictureProvider;
    if (!['auto', 'low', 'medium', 'high'].includes(p.pictureQuality)) p.pictureQuality = DEFAULT_PREFERENCES.pictureQuality;
    if (!['small', 'large'].includes(p.pictureSize)) p.pictureSize = DEFAULT_PREFERENCES.pictureSize;
    if (![0, 2, 3].includes(Number(p.styleFrames))) p.styleFrames = DEFAULT_PREFERENCES.styleFrames;
    else p.styleFrames = Number(p.styleFrames) as Preferences['styleFrames'];
    if (!['auto', 'hydracept'].includes(p.videoProvider)) p.videoProvider = DEFAULT_PREFERENCES.videoProvider;
    const seconds = Number(p.videoSeconds);
    p.videoSeconds = ([4, 6, 8] as number[]).includes(seconds)
      ? seconds as Preferences['videoSeconds']
      : DEFAULT_PREFERENCES.videoSeconds;
    if (!['local', 'companion', 'server'].includes(p.dictation)) p.dictation = DEFAULT_PREFERENCES.dictation;
    return p;
  } catch { return { ...DEFAULT_PREFERENCES }; }
}

export const prefs = signal<Preferences>(load());

export function setPrefs(patch: Partial<Preferences>) {
  prefs.value = { ...prefs.peek(), ...patch };
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs.peek())); } catch { /* private mode: for this session only */ }
}

/** the model a local tool runs for a task on this computer */
export const chosenModel = (task: ModelTask): ModelEntry => resolveModel(task, prefs.peek().models[task]);

/** a command of the / menu was used: it opens the menu first, at most six kept */
export function commandUsed(name: string) {
  const rec = prefs.peek().recentCommands, next = [name, ...rec.filter((n) => n !== name)].slice(0, 6);
  if (next.some((n, i) => n !== rec[i])) setPrefs({ recentCommands: next });
}

/** back to the defaults; the language stays as chosen */
export function resetPrefs() { setPrefs({ ...DEFAULT_PREFERENCES, language: prefs.peek().language }); }

/** another language: the page reloads, so every text (menus, tours) follows */
export function setLanguage(language: Preferences['language']) {
  if (language === prefs.peek().language) return;
  setPrefs({ language });
  location.reload();
}

// ── theme ────────────────────────────────────────────────────
const lightQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
const systemLight = signal(lightQuery?.matches ?? false);
lightQuery?.addEventListener('change', (e) => { systemLight.value = e.matches; });

/** the theme on the page: data-theme and data-view on <html>, read by the stylesheet's tokens */
let lastView = '';
effect(() => {
  if (typeof document === 'undefined') return;
  const p = prefs.value;
  showTheme(document, p.theme, p.view, systemLight.value);
  // another view changes the size of the stage without a window resize: the viewport re-measures on this
  if (lastView && lastView !== p.view) window.dispatchEvent(new Event('resize'));
  lastView = p.view;
});

/** Dispose lighting listeners as soon as this theme is no longer selected. */
effect(() => {
  if (typeof document !== 'undefined' && prefs.value.theme === 'liquid-glass') return installGlassLight(document);
});

/** the settings dialog, opened from the top bar, the home screen or Ctrl+, */
export const settingsOpen = signal(false);

export type SettingsSection = 'plugins' | 'appearance' | 'preview' | 'sound' | 'pictures' | 'videos' | 'models' | 'tours' | 'storage' | 'model' | 'providers' | 'behavior' | 'connection' | 'about';
/** the section shown: the last one opened, or the one asked for */
export const settingsSection = signal<SettingsSection>('appearance');
export function openSettings(section?: SettingsSection) {
  if (section) settingsSection.value = section;
  settingsOpen.value = true;
}
