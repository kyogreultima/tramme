// The editor's vocabulary: the engine's nodes and effects, plus the editor's
// own tools (the ready-made dressings) and workflows. They reach the
// assistant (use_tool) and the chat's / menu the same way as those a
// project's plugins bring.

import type { PromptType, ToolContext, ToolType } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { BLOCK_TOOLS } from './blocks.ts';
import { BRIEF_TOOLS } from './brief.ts';
import { FILM_PLAN_TOOLS } from './filmplan.ts';
import { STYLE_FRAME_TOOLS } from './styleframes.ts';
import { STOCK_TOOLS } from './stock.ts';
import { SURFACE_TOOLS } from './surfaces.ts';
import { CUTOUT_TOOLS } from './cutout.ts';
import { DEPTH_TOOLS } from './depth.ts';
import { EVENT_TOOLS } from './events.ts';
import { FIGURE_TOOLS } from './figures.ts';
import { IMAGE_TOOLS } from './images.ts';
import { VIDEO_TOOLS } from './videos.ts';
import { LIBRARY_TOOLS } from './library.ts';
import { LIPSYNC_TOOLS } from './lipsync.ts';
import { MODEL_TOOLS } from './model3d.ts';
import { REMOVEBG_TOOLS } from './removebg.ts';
import { CUTS_TOOLS } from './cuts.ts';
import { MONTAGE_TOOLS } from './montage-tools.ts';
import { PERCEPTION_TOOLS } from './perception.ts';
import { EDITOR_PRESETS } from './presets.ts';
import { BUILTIN_KITS, RECIPE_TOOLS } from './recipes.ts';
import { TYPEFACE_TOOLS } from './typefaces/tools.ts';
import { REVIEW_TOOLS } from './review.ts';
import { SHORTS_TOOLS } from './shorts.ts';
import { SOURCE_TOOLS } from './sources.ts';
import { SOUND_TOOLS } from './sound.ts';
import { SVG_TOOLS } from './svgpaths.ts';
import { MIXING_TOOLS } from './mixing.ts';
import { transcriptOfDoc } from './model.ts';
import { TRACKING_TOOLS } from './tracking.ts';
import { STABILIZE_TOOLS } from './stabilize.ts';
import { COMPONENT_TOOLS } from './components.ts';
import { DENOISE_TOOLS } from './denoise.ts';
import { FILLERS_TOOLS } from './fillers.ts';
import { SKIN_TOOLS } from './faces.ts';
import { LONG_TOOLS } from './longtools.ts';
import { PROXY_TOOLS } from './proxy.ts';
import { placeTemplate, TEMPLATES, type TemplateArgs } from './templates.ts';

const at = { type: 'number', minimum: 0, title: 'Start (s)', description: 'composition time; the current time by default' };
const duration = { type: 'number', minimum: 0.1, title: 'Duration (s)' };
const place = { enum: ['top', 'center', 'bottom'], title: 'Place' };

function templateTool(name: string, properties: Record<string, unknown>, required: string[] = []): ToolType<Partial<TemplateArgs>> {
  const tpl = TEMPLATES[name];
  return {
    name, title: tpl.title, description: tpl.description,
    input: { type: 'object', properties, required },
    run(input, ctx) {
      const transcript = name === 'captions' ? input.transcript ?? transcriptOfDoc(ctx.doc) : input.transcript;
      return placeTemplate(ctx.doc, ctx.compId, name, { ...input, at: input.at ?? ctx.time, transcript });
    },
  };
}

export const EDITOR_TOOLS: ToolType[] = [
  templateTool('captions', { transcript: { type: 'string', format: 'asset', assetType: 'json', title: 'Transcript' }, at, duration, place }),
  templateTool('title', { text: { type: 'string', title: 'Text' }, subtitle: { type: 'string', title: 'Subtitle' }, at, duration, place }, ['text']),
  templateTool('keyword', { text: { type: 'string', title: 'Text' }, at, duration, place }, ['text']),
  templateTool('lower-third', { text: { type: 'string', title: 'Name' }, subtitle: { type: 'string', title: 'Role' }, at, duration }, ['text']),
];

export const EDITOR_PROMPTS: PromptType[] = [
  {
    name: 'analyze', title: 'Analyse the sources', description: 'reads every picture, video, sound and document of the project, then proposes what the video should be',
    prompt: 'Analyse the sources of this project before making anything, following your guide for sources: list them (use_tool "sources"), read the kit first when the list names one (a brief written from the project\'s repository: check it, do not take it on trust), read every one in full (each document to its last page, each video and sound with what is said), take the colours of the brand from its logo or its pictures (use_tool "palette"), and write what you learned in the brief (use_tool "brief" with about and sources). Then tell me in a few lines what you understood, and propose two or three directions for the video: what it is for and for whom, format and length, the story scene by scene with the sources each scene uses and what must be made for it. Recommend one, and wait for my choice before building.',
  },
  {
    name: 'dress', title: 'Dress a talking video', description: 'cuts, captions, titles and keywords on a video where someone speaks',
    prompt: 'Dress the talking video of this project, following your guide for talking videos: ask about the format and the tone if I have not said them, read the transcript, cut the silences and hesitations, add captions, section titles and keywords at the right moments, then check with frames.',
  },
  {
    name: 'review', title: 'Review the composition', description: 'checks the key moments and fixes what is wrong',
    prompt: 'Review the composition: run the check tool (use_tool "check") and read its issues and contact sheet, look closer at the entrances and transitions that matter with the motion tool, and judge what the checks cannot: contrast, hierarchy, rhythm, elements over a face. When the film has music (a beats analysis), add the rhythm pack so the check tool reads its off-beat and even-shots checks too, and move the cuts they flag onto the beats they name. Propose fixes for what you find, then run check again.',
  },
  {
    name: 'polish', title: 'Polish the motion', description: 'brings the movement to standard: easings, durations, stagger, arcs, settles',
    prompt: 'Polish the motion of this composition, following your guide for motion: run the check tool (use_tool "check") and look at the entrances that matter with the motion tool (use_tool "motion"), then fix what they flag and what the guide asks for: entrances that ease in over about 300 ms and land softly, exits that leave faster, group entrances staggered by uneven gaps, arcs on the big diagonal travels, moves that pass their mark and settle instead of stopping dead. Define the curves once as ease tokens and reference them, keep what already reads well, then check again.',
  },
  {
    name: 'sound-design', title: 'Sound design', description: 'gives the video its sound: effects on the moments that matter, a bed if it needs one, levels under the voice',
    prompt: 'Give this video its sound, following your guide for sound: read the cues of the picture (cues) and say in a few lines which sounds go where and why (the heroes first), then search the library (sfx with a query), look at the sheet and place them on the cues (on: heroes, cuts, lands, appears, moves), a stack and a stop on each hero; find recordings for what the library lacks (sound-find), duck any music under a voice (duck), balance the effects (mix), check (check) and fix the sound warnings, two rounds at most. End with the credits (credits) and the moments I should listen to.',
  },
  {
    name: 'shorts', title: 'Cut shorts from a long video', description: 'the strongest moments as shorts of the asked format, captions and titles included',
    prompt: 'Cut shorts from the long video of this project, following your guide for shorts: ask how many and which format if I have not said them, read the candidates (use_tool "shorts" without plan) and say which you would pick and why, build them (shorts with a plan), then check each short (check, after switching to it) and fix what matters before summing up.',
  },
  {
    name: 'transcript', title: 'Transcribe and read', description: 'the words of a sound or a video, with the moments that matter',
    prompt: 'Get the transcript of the sound or video I name, or of the only one in the project: the editor asks me to confirm the transcription the first time. Then read it and tell me in a few lines what is said and where — the topic changes, the strong sentences, the numbers — with their times. Propose what to do next with it: captions, a cut of the silences, keywords on the strong sentences, or a lip sync on a drawn character.',
  },
  {
    name: 'cut-silences', title: 'Cut the silences', description: 'tightens a talking video: hesitations and quiet gaps shortened, the piece laid back to back',
    prompt: 'Cut the silences of the talking video of this project (use_tool "silences" on it; transcribe it first if it is not). Read what it did — how many cuts and how much time saved — then run the check tool and fix what the cuts broke (a caption drifting off its moment, an entrance landing in a removed gap). Tell me the total saved and the one or two joins I should look at.',
  },
  {
    name: 'beats', title: 'Cut to the music', description: 'the edit lands on the beats and the sections of the sound',
    prompt: 'Make the edit land on the music: run the beats tool on the sound of the composition (use_tool "beats"), read its tempo, beats, bars and sections, then tell me in a few lines what you would put on the strong moments — entrances on beats, a change of scene on a section. When the composition is simple, go ahead and move them; otherwise wait for my word. Then check.',
  },
  {
    name: 'still', title: 'Save a still', description: 'a picture of the composition at a moment, saved as an image asset (cover, thumbnail)',
    prompt: 'Save a still of this composition (use_tool "still") at the moment I name — or, if I have not said one, look at a few candidates first and save the one that reads best: one clear subject, room for a title. Tell me where it was saved and what it shows. Place it as a layer only if I asked for a cover on the timeline.',
  },
];

/** the base vocabulary of the editor, before a document's plugins */
export function editorRegistry() {
  return builtinRegistry().registerTool(...EDITOR_TOOLS, ...SVG_TOOLS, ...RECIPE_TOOLS, ...TYPEFACE_TOOLS, ...FIGURE_TOOLS, ...EVENT_TOOLS, ...PERCEPTION_TOOLS, ...TRACKING_TOOLS, ...STABILIZE_TOOLS, ...PROXY_TOOLS, ...COMPONENT_TOOLS, ...DENOISE_TOOLS, ...SKIN_TOOLS, ...LONG_TOOLS, ...CUTOUT_TOOLS, ...DEPTH_TOOLS, ...MODEL_TOOLS, ...REMOVEBG_TOOLS, ...LIPSYNC_TOOLS, ...CUTS_TOOLS, ...MONTAGE_TOOLS, ...FILLERS_TOOLS, ...REVIEW_TOOLS, ...SOUND_TOOLS, ...MIXING_TOOLS, ...IMAGE_TOOLS, ...VIDEO_TOOLS, ...SHORTS_TOOLS, ...SOURCE_TOOLS, ...BLOCK_TOOLS, ...BRIEF_TOOLS, ...FILM_PLAN_TOOLS, ...STYLE_FRAME_TOOLS, ...SURFACE_TOOLS, ...STOCK_TOOLS, ...LIBRARY_TOOLS).registerPrompt(...EDITOR_PROMPTS).registerKit(...BUILTIN_KITS).registerPreset(...EDITOR_PRESETS);
}
