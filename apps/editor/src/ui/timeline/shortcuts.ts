// The editing keys of the timeline and what each does to the document: a key
// is matched to a command, a command is planned as the operations of one
// commit (one undo). Pure: the keyboard handler runs the plan (edit-keys.ts).

import { applyOps, isLocked, linkOps, pasteAttributesOps, pasteOps, pointer, rippleDeleteOps, rippleTrimOps, splitAtOps, trimInOps, unlinkOps, type Layer, type Op, type TrammeDoc } from '@tramme/core';
import { t } from '../../i18n/index.ts';

export type EditCommand = 'split' | 'trimIn' | 'trimOut' | 'rippleDelete' | 'copy' | 'paste' | 'pasteAttributes' | 'link' | 'unlink';

/** a key and the modifiers it needs, no others (mod is Ctrl, or Cmd on a Mac) */
interface Chord { key: string; mod?: boolean; shift?: boolean; alt?: boolean }

/** every editing key, in one place */
export const KEYMAP: Record<EditCommand, Chord> = {
  split: { key: 'b', mod: true },
  trimIn: { key: 'q' },
  trimOut: { key: 'w' },
  rippleDelete: { key: 'delete', shift: true },
  copy: { key: 'c', mod: true },
  paste: { key: 'v', mod: true },
  pasteAttributes: { key: 'v', mod: true, alt: true },
  link: { key: 'l' },
  unlink: { key: 'l', mod: true, shift: true },
};

export function commandFor(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): EditCommand | null {
  const key = e.key.toLowerCase() === 'backspace' ? 'delete' : e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  for (const [cmd, ch] of Object.entries(KEYMAP) as [EditCommand, Chord][]) {
    if (ch.key === key && !!ch.mod === mod && !!ch.shift === e.shiftKey && !!ch.alt === e.altKey) return cmd;
  }
  return null;
}

/** clips copied: where they came from and what they were */
export interface Clipboard { compId: string; ids: string[]; layers: Layer[] }

export interface EditEnv {
  doc: TrammeDoc;
  compId: string;
  selection: string[];
  /** the playhead, s */
  time: number;
  clipboard: Clipboard | null;
  /** a video's length when the preview has it open */
  fileLength?: (asset: string) => number | undefined;
}

export interface EditPlan {
  label: string;
  ops: Op[];
  /** the layers to select once it is done */
  select?: string[];
  /** what a copy puts on the clipboard */
  copied?: Clipboard;
}

/** the operations a command comes to here, or null when it does nothing (nothing selected, a locked track, the playhead outside the clip) */
export function editPlan(cmd: EditCommand, env: EditEnv): EditPlan | null {
  const { doc, compId, time } = env, c = doc.compositions[compId], half = 0.5 / c.fps;
  const clips = env.selection.filter((id) => c.layers[id] && !c.layers[id].children && !isLocked(c, id));
  const inside = (id: string) => (c.layers[id].in ?? 0) + half < time && time < (c.layers[id].out ?? c.duration) - half;
  const magnetic = (id: string) => !!c.tracks?.find((x) => x.id === c.layers[id].track)?.magnetic;
  const plan = (label: string, ops: Op[], extra: Partial<EditPlan> = {}): EditPlan | null => (ops.length ? { label, ops, ...extra } : null);

  if (cmd === 'split') {
    const r = splitAtOps(doc, compId, clips.length || env.selection.length ? clips : [], time);
    return plan(t('timeline.split'), r.ops, { select: r.ids });
  }
  if (cmd === 'trimIn' || cmd === 'trimOut') {
    const ops: Op[] = [];
    let d = doc;
    for (const id of clips.filter(inside)) {
      const one = cmd === 'trimIn'
        ? (magnetic(id) ? rippleTrimOps(d, compId, id, 'in', time, env.fileLength) : trimInOps(d, compId, id, time))
        : (magnetic(id) ? rippleTrimOps(d, compId, id, 'out', time, env.fileLength) : [{ op: 'add', path: pointer('compositions', compId, 'layers', id, 'out'), value: time } as Op]);
      ops.push(...one);
      d = applyAll(d, one);
    }
    return plan(cmd === 'trimIn' ? t('timeline.trimStartToPlayhead') : t('timeline.trimEndToPlayhead'), ops);
  }
  if (cmd === 'rippleDelete') return clips.length === env.selection.length ? plan(t('timeline.rippleDelete'), rippleDeleteOps(doc, compId, clips)) : null;
  if (cmd === 'copy') {
    const ids = env.selection.filter((id) => c.layers[id] && !c.layers[id].children);
    return ids.length ? { label: t('timeline.copyClips'), ops: [], copied: { compId, ids, layers: ids.map((id) => structuredClone(c.layers[id])) } } : null;
  }
  if (cmd === 'paste') {
    const clip = env.clipboard;
    if (!clip) return null;
    const track = c.tracks?.find((x) => x.id === clip.layers[0]?.track && !x.locked) ?? c.tracks?.find((x) => x.kind === 'video' && !x.locked);
    if (c.tracks && !track) return null;
    return plan(t('timeline.pasteClips'), pasteOps(doc, compId, clip.layers, track?.id ?? null, time, track?.magnetic ? 'insert' : 'overwrite'));
  }
  if (cmd === 'pasteAttributes') {
    const from = env.clipboard?.compId === compId ? env.clipboard.ids[0] : undefined;
    return from && c.layers[from] ? plan(t('timeline.pasteAttributes'), pasteAttributesOps(doc, compId, from, clips, ['transform', 'effects', 'masks', 'blend', 'speed'])) : null;
  }
  if (cmd === 'link') return plan(t('timeline.linkClips'), linkOps(doc, compId, clips));
  return plan(t('timeline.unlinkClips'), unlinkOps(doc, compId, clips));
}

const applyAll = (d: TrammeDoc, ops: Op[]) => (ops.length ? applyOps(d, ops).doc : d);
