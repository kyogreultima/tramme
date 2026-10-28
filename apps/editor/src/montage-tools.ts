// The editing operations of a track-based timeline, as tools of the assistant:
// the same functions (@tramme/core, montage.ts) the timeline's gestures and
// keys call, so a cut made in words is the cut made by hand. Each takes ids
// and times, never raw operations.

import { addAdjustmentOps, addTrackOps, applyOps, detachAudioOps, insertOps, isLocked, linkOps, overwriteOps, rippleDeleteOps, rippleTrimOps, rollOps, slideOps, slipOps, toSequenceOps, unlinkOps, type Layer, type Op, type ToolContext, type ToolOutput, type ToolType } from '@tramme/core';
import { hasSound, mediaDuration } from './perception.ts';
import { clipFromRange } from './subclips.ts';
import { defaultTrackOf } from './ui/timeline/tracks.ts';
import { placeClipOps, STILL_LENGTH } from './ui/timeline/place-ops.ts';
import { fixOps, presetIssues, PUBLISH_PRESETS } from './publish.ts';
import { syncPlan } from './sync-plan.ts';
import { t } from './i18n/index.ts';

const clip = { type: 'string', title: 'Clip', description: 'the id of a layer of the composition' } as const;
const clips = { type: 'array', items: { type: 'string' }, title: 'Clips', description: 'ids of layers of the composition; the selection by default' } as const;
const track = { type: 'string', title: 'Track', description: 'the id of a track of the composition (V1, A1…)' } as const;
const at = { type: 'number', minimum: 0, title: 'At (s)', description: 'a time of the composition; the playhead by default' } as const;

/** the clips named, or the selection */
const pick = (ids: string[] | undefined, ctx: ToolContext) => (ids?.length ? ids : ctx.selection);

/** why an edit did nothing, in words for the assistant */
const why = (ctx: ToolContext, ids: string[]): string => {
  const c = ctx.doc.compositions[ctx.compId], known = ids.filter((id) => c.layers[id]);
  if (!known.length) return `no such clip (${ids.join(', ') || 'none given, and none selected'})`;
  if (known.some((id) => isLocked(c, id))) return 'a clip is on a locked track (or linked to one): unlock the track first';
  return 'nothing to change here: check the clips, the track they are on and the times';
};

const done = (ops: Op[], label: string, text: string): ToolOutput => ({ ops, label, notice: label, text });

/** the lengths of the files the clips play, read from their containers (a few kB each): what limits a trim at the end of a file */
async function lengthsOf(ctx: ToolContext, ids: string[]): Promise<(asset: string) => number | undefined> {
  const c = ctx.doc.compositions[ctx.compId], lengths = new Map<string, number>();
  for (const id of ids) {
    const l = c.layers[id], asset = l?.props?.[l.type === 'audio' ? 'audio' : 'video'];
    if (l && (l.type === 'video' || l.type === 'audio') && typeof asset === 'string' && ctx.doc.assets[asset] && !lengths.has(asset)) lengths.set(asset, (await mediaDuration(ctx.assetUrl(asset))) || Infinity);
  }
  return (asset) => { const n = lengths.get(asset); return n === Infinity ? undefined : n; };
}

/** a layer playing an asset, or a range of one (a sub-clip, or `from` and `to` in the media's own time) */
async function layerOf(ctx: ToolContext, assetId: string, from?: number, to?: number): Promise<{ layer: Layer; sound: boolean } | null> {
  const doc = ctx.doc, a = doc.assets[assetId];
  if (!a) return null;
  const media = a.of ?? assetId, file = doc.assets[media];
  if (file.type === 'image') return { layer: { type: 'image', name: a.name ?? assetId, in: 0, out: STILL_LENGTH, props: { image: media, size: [doc.compositions[ctx.compId].width, doc.compositions[ctx.compId].height], fit: 'contain' } }, sound: false };
  if (file.type !== 'video' && file.type !== 'audio') return null;
  const range: [number, number] = a.range ?? [from ?? 0, to ?? (await mediaDuration(ctx.assetUrl(media)))];
  if (!(range[1] > range[0])) throw new Error(`${assetId}: the range ${range[0]}–${range[1]} s is empty (the file may be too short, or unreadable)`);
  const base: Layer = { type: file.type, name: a.name ?? assetId, props: { [file.type]: media } };
  return { layer: clipFromRange(base, range[0], range[1]), sound: file.type === 'video' && await hasSound(ctx.assetUrl(media)) };
}

/** a clip put on a track: the composition made a sequence first when it is not one */
async function place(a: { asset: string; track?: string; at?: number; from?: number; to?: number }, mode: 'insert' | 'overwrite', ctx: ToolContext): Promise<ToolOutput> {
  const built = await layerOf(ctx, a.asset, a.from, a.to);
  if (!built) throw new Error(`${a.asset}: a video, a sound or a picture of the project is expected`);
  const prep = ctx.doc.compositions[ctx.compId].tracks ? [] : toSequenceOps(ctx.doc, ctx.compId);
  const doc = prep.length ? applyOps(ctx.doc, prep).doc : ctx.doc, c = doc.compositions[ctx.compId], audio = built.layer.type === 'audio';
  let ops = prep;
  let lane = a.track ?? defaultTrackOf(c, audio, ctx.selection[0]);
  if (!lane) {
    const add = addTrackOps(c, ctx.compId, audio ? 'audio' : 'video');
    ops = [...ops, ...add.ops];
    lane = add.id;
  }
  const next = ops.length > prep.length ? applyOps(doc, ops.slice(prep.length)).doc : doc;
  const r = placeClipOps(next, ctx.compId, ctx.doc.assets[a.asset].name || a.asset, { layer: built.layer, withSound: built.sound }, a.at ?? ctx.time, lane, mode);
  if (!r) throw new Error(`${a.asset} cannot go on ${lane} (a track of the other kind, or locked)`);
  return done([...ops, ...r.ops], t('timeline.placeName', { name: ctx.doc.assets[a.asset].name || a.asset }), `${a.asset} ${mode === 'insert' ? 'inserted' : 'laid over the track'} as ${r.id} on ${lane} at ${(a.at ?? ctx.time).toFixed(2)} s${built.sound ? ', its sound on its own track, linked' : ''}.`);
}

const placeInput = { type: 'object', properties: { asset: { type: 'string', format: 'asset', assetType: ['video', 'audio', 'image'], title: 'Media', description: 'a video, a sound or a picture of the project, or a sub-clip' }, track, at, from: { type: 'number', minimum: 0, title: 'From (s)', description: "where to start in the media's own time (the start by default)" }, to: { type: 'number', minimum: 0, title: 'To (s)', description: "where to stop in the media's own time (its end by default)" } }, required: ['asset'] } as const;

export const MONTAGE_TOOLS: ToolType[] = [
  {
    name: 'ripple_delete', title: 'Delete and close the gap',
    description: 'removes clips from their tracks (the clips linked to them go too) and moves what follows on those tracks earlier by the time removed, a gap that already followed staying; a clip of a locked track is refused',
    input: { type: 'object', properties: { clips } },
    ai: { when: 'a shot is cut out of an edit and the rest must close up behind it', avoid: 'layers that are not clips of a track (use the plain delete), or titles over the picture that must stay where they are' },
    run({ clips: ids }: { clips?: string[] }, ctx) {
      const list = pick(ids, ctx), ops = rippleDeleteOps(ctx.doc, ctx.compId, list);
      if (!ops.length) throw new Error(`ripple_delete: ${why(ctx, list)}`);
      return done(ops, t('timeline.rippleDelete'), `Removed ${list.join(', ')} and closed the gap behind it.`);
    },
  },
  {
    name: 'insert_clip', title: 'Insert a clip',
    description: 'puts a clip of the project on a track at a time and pushes the rest of the track later by its length (a clip it falls in is cut in two); a video with a sound brings its sound on a sound track, linked. A composition without tracks becomes a sequence first',
    input: placeInput,
    ai: { when: 'a shot is added in the middle of an edit and everything after it must make room', avoid: 'a clip that must cover what is there (use overwrite_clip)' },
    run: (a: { asset: string; track?: string; at?: number; from?: number; to?: number }, ctx) => place(a, 'insert', ctx),
  },
  {
    name: 'overwrite_clip', title: 'Lay a clip over the track',
    description: 'puts a clip of the project on a track at a time, over what is there: the clips it covers are removed, one it covers in part is trimmed on that side, one that holds it is cut in three; nothing else moves. A composition without tracks becomes a sequence first',
    input: placeInput,
    ai: { when: 'a shot replaces what is on the track for the same length (a cutaway, a take replaced)', avoid: 'a clip that must push the rest later (use insert_clip)' },
    run: (a: { asset: string; track?: string; at?: number; from?: number; to?: number }, ctx) => place(a, 'overwrite', ctx),
  },
  {
    name: 'ripple_trim', title: 'Trim an edge and ripple',
    description: 'moves the in or the out edge of a clip to a time: the in edge keeps the clip where it starts and carries its file (the head cut off or brought back, as far as the file goes), and everything after it on the track moves by the change of length',
    input: { type: 'object', properties: { clip, edge: { type: 'string', enum: ['in', 'out'], title: 'Edge', description: 'in: the start of the clip, out: its end' }, to: { type: 'number', minimum: 0, title: 'To (s)', description: 'the time the edge goes to' } }, required: ['clip', 'edge', 'to'] },
    ai: { when: 'a shot should start later or end earlier and the track must close up (or open) behind it', avoid: 'a trim that must leave the next clips where they are (set the out point directly)' },
    async run(a: { clip: string; edge: 'in' | 'out'; to: number }, ctx) {
      const ops = rippleTrimOps(ctx.doc, ctx.compId, a.clip, a.edge, a.to, await lengthsOf(ctx, [a.clip]));
      if (!ops.length) throw new Error(`ripple_trim: ${why(ctx, [a.clip])}`);
      return done(ops, t(a.edge === 'in' ? 'timeline.trimStartToPlayhead' : 'timeline.trimEndToPlayhead'), `${a.clip}: its ${a.edge} edge is at ${a.to} s, the track after it moved.`);
    },
  },
  {
    name: 'roll', title: 'Move a cut',
    description: 'moves the cut between two neighbouring clips of a track to a time: the left one ends there, the right one starts there with its file carried, nothing else moves; limited by what the files have left and by one frame on each side',
    input: { type: 'object', properties: { left: { ...clip, title: 'Left clip' }, right: { ...clip, title: 'Right clip' }, to: { type: 'number', minimum: 0, title: 'To (s)', description: 'where the cut goes' } }, required: ['left', 'right', 'to'] },
    ai: { when: 'the cut between two shots is a little early or late (a line that starts before the picture changes)', avoid: 'shots that do not touch (there is no cut to move)' },
    async run(a: { left: string; right: string; to: number }, ctx) {
      const ops = rollOps(ctx.doc, ctx.compId, a.left, a.right, a.to, await lengthsOf(ctx, [a.left]));
      if (!ops.length) throw new Error(`roll: ${why(ctx, [a.left, a.right])}`);
      return done(ops, t('timeline.roll'), `The cut between ${a.left} and ${a.right} moved to ${a.to} s.`);
    },
  },
  {
    name: 'slip', title: 'Slip a shot in its file',
    description: 'shows another part of the file in a clip that stays where it is, as long as it is: the window moves later in the file for a positive amount, earlier for a negative one; the clips linked to it slip too; limited by the start of the file and its end',
    input: { type: 'object', properties: { clip, by: { type: 'number', title: 'By (s)', description: 'seconds of the timeline: positive shows what comes later in the file' } }, required: ['clip', 'by'] },
    ai: { when: 'the moment wanted is just before or after what the shot shows, and its place in the edit is right', avoid: 'a clip whose start is animated or written as an expression (it cannot slip)' },
    async run(a: { clip: string; by: number }, ctx) {
      const ops = slipOps(ctx.doc, ctx.compId, a.clip, a.by, await lengthsOf(ctx, [a.clip]));
      if (!ops.length) throw new Error(`slip: ${why(ctx, [a.clip])}`);
      return done(ops, t('timeline.slip'), `${a.clip} now shows the file ${a.by} s ${a.by > 0 ? 'later' : 'earlier'}; its place in the edit is unchanged.`);
    },
  },
  {
    name: 'slide', title: 'Slide a shot between its neighbours',
    description: 'moves a clip in time while the clip before it ends later (or earlier) and the one after it starts later (or earlier) by the same amount, so the track keeps its length; each neighbour keeps a frame at least',
    input: { type: 'object', properties: { clip, by: { type: 'number', title: 'By (s)', description: 'positive moves it later' } }, required: ['clip', 'by'] },
    ai: { when: 'a shot should come earlier or later in a sequence of shots without changing the length of the film', avoid: 'a clip with no neighbour on its track' },
    run(a: { clip: string; by: number }, ctx) {
      const ops = slideOps(ctx.doc, ctx.compId, a.clip, a.by);
      if (!ops.length) throw new Error(`slide: ${why(ctx, [a.clip])}`);
      return done(ops, t('timeline.slide'), `${a.clip} slid ${a.by} s between its neighbours.`);
    },
  },
  {
    name: 'detach_audio', title: 'Detach the sound of a video',
    description: "puts a video's sound on its own layer of a sound track (same range, same place in the file, same mix settings), linked to the video, which is muted; the sound track is made when there is none",
    input: { type: 'object', properties: { clip, track } , required: ['clip'] },
    ai: { when: 'the sound of a shot must be cut, faded or kept apart from its picture (a J-cut or an L-cut: roll or ripple_trim its sound alone after unlinking)', avoid: 'a video already muted, or without a sound' },
    run(a: { clip: string; track?: string }, ctx) {
      const prep = ctx.doc.compositions[ctx.compId].tracks ? [] : toSequenceOps(ctx.doc, ctx.compId);
      let doc = prep.length ? applyOps(ctx.doc, prep).doc : ctx.doc, ops = prep, lane = a.track ?? doc.compositions[ctx.compId].tracks?.find((x) => x.kind === 'audio' && !x.locked)?.id;
      if (!lane) { const add = addTrackOps(doc.compositions[ctx.compId], ctx.compId, 'audio'); ops = [...ops, ...add.ops]; doc = applyOps(doc, add.ops).doc; lane = add.id; }
      const r = detachAudioOps(doc, ctx.compId, a.clip, lane);
      if (!r) throw new Error(`detach_audio: ${a.clip} is not a video with its own sound, or a track involved is locked`);
      return done([...ops, ...r.ops], t('timeline.detachAudio'), `The sound of ${a.clip} is the layer ${r.id} on ${lane}, linked to it; the video is muted.`);
    },
  },
  {
    name: 'link', title: 'Link or unlink clips',
    description: 'clips that share a link move, split and are deleted together (a video and its sound); `unlink` frees them',
    input: { type: 'object', properties: { clips, unlink: { type: 'boolean', title: 'Unlink', description: 'free the clips instead of linking them' } } },
    ai: { when: 'two clips must stay in step (a picture and its sound), or an L-cut needs the sound freed', avoid: 'clips of different shots' },
    run(a: { clips?: string[]; unlink?: boolean }, ctx) {
      const list = pick(a.clips, ctx), ops = a.unlink ? unlinkOps(ctx.doc, ctx.compId, list) : linkOps(ctx.doc, ctx.compId, list);
      if (!ops.length) throw new Error(`link: ${list.length < 2 && !a.unlink ? 'two clips at least are needed' : why(ctx, list)}`);
      return done(ops, t(a.unlink ? 'timeline.unlinkClips' : 'timeline.linkClips'), `${list.join(', ')} ${a.unlink ? 'unlinked' : 'linked'}.`);
    },
  },
  {
    name: 'sync_clips', title: 'Line clips up by their sound',
    description: "moves the other clips so that their sound agrees with the first one's (two cameras on one scene, a camera and a separate recorder): the loudness of each is compared at every shift; a pair that shares no sound is left where it is and said",
    input: { type: 'object', properties: { clips } },
    ai: { when: 'several recordings of one event must play together before a multicam or a cutaway', avoid: 'clips at a speed other than 1, or recordings of different events' },
    async run(a: { clips?: string[] }, ctx) {
      const list = pick(a.clips, ctx), { ops, notes } = await syncPlan(ctx.doc, ctx.compId, list, ctx.assetUrl, ctx.signal);
      const said = notes.map((n) => (n.kind === 'few' ? 'two clips with a sound are needed' : n.kind === 'nosound' ? `${n.clip} has no sound to compare` : `${n.a} and ${n.b} share no sound that can be lined up`));
      if (!ops.length) throw new Error(`sync_clips: ${said.join('; ') || 'nothing to move: the clips already agree'}`);
      return { ...done(ops, t('timeline.syncBySound'), `Lined up by sound.${said.length ? ` Not done: ${said.join('; ')}.` : ''}`) };
    },
  },
  {
    name: 'add_adjustment', title: 'Add an adjustment clip',
    description: 'an adjustment clip on a picture track: what is on the tracks under it, over its length only, goes through its effects (a grade, a blur); it goes on the track given when nothing plays there in that range, else on a new track above the others, and moves nothing',
    input: { type: 'object', properties: { track, at, length: { type: 'number', minimum: 0.1, title: 'Length (s)', description: '5 s by default' } } },
    ai: { when: 'one correction must reach several tracks at once for a part of the film (a grade over a scene)', avoid: 'a correction for one clip only (put the effect on that clip)' },
    run(a: { track?: string; at?: number; length?: number }, ctx) {
      const r = addAdjustmentOps(ctx.doc, ctx.compId, a.track ?? null, a.at ?? ctx.time, a.length ?? 5);
      if (!r) throw new Error(`add_adjustment: ${a.track ? `${a.track} is not a picture track, or it is locked` : 'the length is empty'}`);
      return done(r.ops, t('timeline.addAdjustment'), `Adjustment clip ${r.id} added; add its effects with the usual tools.`);
    },
  },
  {
    name: 'match_look', title: 'Match the look of a shot',
    description: "gives the other clips the look of the first one: the mean and the spread of each colour of their pictures are compared and colour wheels (fx.wheels: lift, gamma, gain) are put on them, visible and editable",
    input: { type: 'object', properties: { clips } },
    ai: { when: 'shots of one scene differ in colour (two cameras, two times of day) and must cut together', avoid: 'a deliberate change of look between two scenes' },
    async run(a: { clips?: string[] }, ctx) {
      // read the pictures where the editor holds them: loaded when the tool runs, not at the editor's start
      const { lookPlan } = await import('./looks-run.ts');
      const list = pick(a.clips, ctx), { ops, notes } = await lookPlan(ctx.doc, ctx.compId, list, ctx.time);
      const said = notes.map((n) => (n.kind === 'few' ? 'two clips with a picture are needed' : `the picture of ${n.clip} cannot be read yet`));
      if (!ops.length) throw new Error(`match_look: ${said.join('; ') || 'nothing to change'}`);
      return done(ops, t('timeline.matchLook'), `Colour wheels put on the clips after ${list[0]}.${said.length ? ` Not done: ${said.join('; ')}.` : ''}`);
    },
  },
  {
    name: 'publish', title: 'Check a film for a format',
    description: 'says what stands between the film and a format (a vertical short, a square, landscape, a 4K master, a GIF): its length, proportions, size, frame rate and loudness; with fix, applies what operations can fix (the length cut to the limit, the size, the rate, the loudness target). A film in the wrong proportions for a vertical format is recomposed by the assistant, not by this tool. The file itself is exported from the export menu',
    input: { type: 'object', properties: { preset: { type: 'string', enum: PUBLISH_PRESETS.map((p) => p.id), title: 'Format', description: 'short: 1080×1920 up to 60 s; square: 1080×1080 up to 60 s; landscape: 1920×1080; master: 3840×2160; gif: 640 px up to 15 s' }, fix: { type: 'boolean', title: 'Fix', description: 'apply the fixes that operations can make' } }, required: ['preset'] },
    ai: { when: 'the film is about to be exported for a place (a social network, a master): check it first', avoid: 'a film that is still being made' },
    run(a: { preset: string; fix?: boolean }, ctx) {
      const p = PUBLISH_PRESETS.find((x) => x.id === a.preset);
      if (!p) throw new Error(`publish: unknown format "${a.preset}" (${PUBLISH_PRESETS.map((x) => x.id).join(', ')})`);
      const c = ctx.doc.compositions[ctx.compId], issues = presetIssues(c, p);
      const said = issues.map((i) => `${i.code}: ${JSON.stringify(i.params)}${i.fix ? ` (fix: ${i.fix})` : ''}`);
      if (!a.fix || !issues.length) return { text: issues.length ? `Not ready for ${p.id}: ${said.join('; ')}.` : `The film is ready for ${p.id}: export it as ${p.format} from the export menu.`, notice: issues.length ? t('publish.title') : t('publish.ready') };
      const ops = issues.filter((i) => i.fix && i.fix !== 'vertical').flatMap((i) => fixOps(c, ctx.compId, p, i.fix!));
      const left = issues.filter((i) => i.fix === 'vertical').length;
      return { ops, label: t('publish.fixAll'), notice: t('publish.fixAll'), text: `Fixed for ${p.id}: ${issues.filter((i) => i.fix && i.fix !== 'vertical').map((i) => i.code).join(', ') || 'nothing'}.${left ? ' The proportions need a version recomposed for the format (ask for a 9:16 version).' : ''} Export it as ${p.format} from the export menu.` };
    },
  },
];
