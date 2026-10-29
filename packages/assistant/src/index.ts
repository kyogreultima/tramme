// What the assistant knows and can do, the same whichever way it reaches
// Claude (the local companion with the Agent SDK, or the server's key):
// the models offered, the system prompt, the tools. The tools themselves run
// in the editor, where the document, the renderer and the files are.

import { z } from 'zod';

export const MODELS: [id: string, label: string][] = [
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'],
  ['claude-haiku-5-5', 'Haiku 5.5'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
];
export const DEFAULT_MODEL = 'claude-opus-5-5';
/** models that think when they need to (adaptive thinking) */
export const ADAPTIVE = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
/** models a request cannot ask the server to run another model for when Claude declines (no server-side fallback exists for them) */
export const NO_FALLBACK = new Set(['claude-haiku-5-5']);

/** how hard a model works on a turn: thinking depth, care, checks (Opus 5.5 alone would run at medium) */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = typeof EFFORTS[number];
/** Claude's level when none is chosen; the other models keep their own default */
export const DEFAULT_EFFORT: Effort = 'high';

// ── other models ─────────────────────────────────────────────
// Claude goes through the companion or the server's Anthropic key. The others
// speak the OpenAI chat format: OpenAI, Gemini, OpenRouter, Z.AI (GLM) and the
// custom providers through the server (their keys are connected in the
// settings, or Worker secrets), local models (Ollama, LM Studio) straight from
// the browser to this machine. A model of another provider is written
// `provider:model` (`openai:gpt-5`, `zai:glm-4-plus`, `local:llama3.1:8b`), of
// a custom provider `custom:<id>:model` (`custom:deepseek:deepseek-chat`).

export type Provider = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'zai' | 'custom' | 'local' | 'codex' | 'antigravity';
/** the providers built in that are reached through the server */
export const REMOTE: Record<Exclude<Provider, 'anthropic' | 'custom' | 'local' | 'codex' | 'antigravity'>, { label: string }> = {
  openai: { label: 'OpenAI' },
  gemini: { label: 'Gemini' },
  openrouter: { label: 'OpenRouter' },
  zai: { label: 'Z.AI (GLM)' },
};
export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', openrouter: 'OpenRouter', zai: 'Z.AI (GLM)', custom: 'Custom provider', local: 'Local models', codex: 'ChatGPT (Codex)', antigravity: 'Antigravity' };

// ── the companion's engines ──────────────────────────────────
// The local companion runs a turn with one of the agents installed on the
// user's computer, each on its own login: Claude Code (the Agent SDK), Codex
// (a ChatGPT login) or the Antigravity CLI (a Google login; it replaced the
// Gemini CLI). A model of the last two is written `codex:<model>` or
// `antigravity:<model>`, `default` leaving the choice to the command line.

export const ENGINES = ['claude', 'codex', 'antigravity'] as const;
export type Engine = typeof ENGINES[number];
/** the model a command line picks by itself */
export const CLI_DEFAULT = 'default';

/** the models each engine runs, and its name for the user */
export const ENGINE_MODELS: Record<Engine, { provider: Provider; label: string }> = {
  claude: { provider: 'anthropic', label: 'Claude Code' },
  codex: { provider: 'codex', label: 'ChatGPT (Codex)' },
  antigravity: { provider: 'antigravity', label: 'Antigravity' },
};

/** the companion's engine that runs a model, null when the model does not go through the companion */
export function engineOf(model: string): Engine | null {
  const p = providerOf(model);
  return ENGINES.find((e) => ENGINE_MODELS[e].provider === p) ?? null;
}
/** where Ollama answers by default (LM Studio: http://127.0.0.1:1234/v1) */
export const LOCAL_URL = 'http://127.0.0.1:11434/v1';

export function providerOf(model: string): Provider {
  const i = model.indexOf(':');
  const p = i > 0 ? model.slice(0, i) : '';
  if (p === 'glm') return 'zai';
  return p === 'openai' || p === 'gemini' || p === 'openrouter' || p === 'zai' || p === 'custom' || p === 'local' || p === 'codex' || p === 'antigravity' ? p : 'anthropic';
}
/** where the server finds the model: its provider, or custom:<id> for a custom one */
export function slotOf(model: string): string {
  if (providerOf(model) !== 'custom') return providerOf(model);
  const i = model.indexOf(':', 'custom:'.length);
  return i > 0 ? model.slice(0, i) : model;
}
/** the model's name for its provider */
export const modelName = (model: string) => (providerOf(model) === 'anthropic' ? model : model.slice(slotOf(model).length + 1));
/** a short name to show */
export const modelLabel = (model: string) => MODELS.find(([id]) => id === model)?.[1]
  ?? (engineOf(model) && modelName(model) === CLI_DEFAULT ? PROVIDER_LABEL[providerOf(model)] : modelName(model).replace(/^models\//, ''));

// ── the model taken for the user ─────────────────────────────
// Someone who connected OpenAI or Gemini and not Claude should not have to
// find the model menu: the assistant takes the strongest model of a connected
// provider that follows tools well. A provider's listing is searched for these
// families in order; within a family, the newest version wins.
const PREFERRED: Partial<Record<Provider, RegExp[]>> = {
  openai: [/^gpt-5(\.\d+)*$/, /^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/],
  gemini: [/^gemini-\d+(\.\d+)*-pro$/, /^gemini-\d+(\.\d+)*-pro/, /^gemini-\d+(\.\d+)*-flash$/],
  openrouter: [/^anthropic\/claude-sonnet/, /^anthropic\/claude-opus/, /^openai\/gpt-5/, /^google\/gemini-[\d.]+-pro/],
  zai: [/^glm-\d+(\.\d+)*$/, /^glm-/],
};

/** the model to take among a provider's listing (slot: openai, gemini, custom:<id>…; ids without the provider), undefined for an empty listing */
export function pickModel(slot: string, ids: string[]): string | undefined {
  const newest = (list: string[]) => [...list].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0];
  for (const family of PREFERRED[providerOf(`${slot}:`)] ?? []) {
    const found = ids.filter((id) => family.test(id));
    if (found.length) return `${slot}:${newest(found)}`;
  }
  return ids.length ? `${slot}:${ids[0]}` : undefined;
}

/** the levels the providers of the chat format share (reasoning_effort, OpenRouter's reasoning.effort) */
const CHAT_EFFORTS: Effort[] = ['low', 'medium', 'high'];

/**
 * The effort levels a model offers, none when it has no such setting. Claude
 * Opus, Sonnet and Haiku 5.5: all five. In the chat format, the reasoning models: OpenAI's
 * o-series and GPT-5 (not their chat variants), Gemini 2.5 and later, the
 * OpenRouter models whose listing says they reason (`reasons`), gpt-oss on a
 * local server, Codex, Antigravity's default. Haiku 4.5, Z.AI and the other models: none.
 */
export function effortLevels(model: string, reasons = false): Effort[] {
  const name = modelName(model).toLowerCase().replace(/^models\//, '');
  switch (providerOf(model)) {
    case 'anthropic': return ADAPTIVE.has(model) ? [...EFFORTS] : [];
    case 'openai': return /^(o\d|gpt-5)/.test(name) && !/chat/.test(name) ? CHAT_EFFORTS : [];
    case 'gemini': return /^gemini-(2\.5|[3-9])/.test(name) ? CHAT_EFFORTS : [];
    case 'openrouter': return reasons ? CHAT_EFFORTS : [];
    case 'local': return /gpt-oss/.test(name) ? CHAT_EFFORTS : [];
    // Codex takes a reasoning effort (model_reasoning_effort); Antigravity for its default model alone (--effort), each of its listed models holding its own level (gemini-3.1-pro-low)
    case 'codex': return CHAT_EFFORTS;
    case 'antigravity': return name === CLI_DEFAULT ? CHAT_EFFORTS : [];
    default: return [];
  }
}

/** the level a model works at: the one chosen for it, otherwise high for Claude and nothing for the others (their own default) */
export function effortFor(model: string, chosen: Record<string, Effort | undefined>, reasons = false): Effort | undefined {
  const levels = effortLevels(model, reasons);
  if (!levels.length) return undefined;
  const c = chosen[model];
  if (c && levels.includes(c)) return c;
  return providerOf(model) === 'anthropic' ? DEFAULT_EFFORT : undefined;
}

/** default port of the local companion (tramme agent) */
export const COMPANION_PORT = 4317;

const Op = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'test']),
  path: z.string().describe('JSON Pointer, e.g. /compositions/main/layers/title/props/text'),
  value: z.any().optional(),
  from: z.string().optional(),
});

export interface ToolDef { name: string; description: string; schema: z.ZodObject<any>; label: (input: any) => string }

// The activity lines (tool labels) are shown to the user: written in English,
// they go through a translator the interface sets (setTranslator), {name}
// replaced by params.name. The descriptions and the prompts stay as they are
// (read by the model).
type Translate = (text: string, params?: Record<string, string | number>) => string;
let translate: Translate = (text, params) => (params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text);
export function setTranslator(fn: Translate) { translate = fn; }
const t: Translate = (text, params) => translate(text, params);

export const TOOLS: ToolDef[] = [
  {
    name: 'get_document',
    description: 'The current document (JSON), with your pending proposal applied if there is one. With path, only that part (e.g. /compositions/main/layers/title, /tokens): lighter when you know where to look.',
    schema: z.object({
      path: z.string().optional().describe('JSON Pointer of the part to read; the whole document without it'),
    }),
    label: (i) => (i.path ? t('Reading {path} in the document', { path: i.path }) : t('Reading the document')),
  },
  {
    name: 'list_nodes',
    description: "The vocabulary of the project: node, effect and modifier types (built-in and the project's plugins) and the tools they bring (run them with use_tool). Without types: an index, each entry with its properties as name:type=default and notes on when to use it, each tool with its input as name:type (? when optional); the plugins installed on the device are left out of it. With query: the entries whose name, description or notes hold its words, the installed plugins' included (built-in and the project's first). With types: the full entries of these names (property labels, descriptions, ranges, options, examples; a tool's input schema).",
    schema: z.object({
      types: z.array(z.string()).optional().describe('node, effect or modifier types and tool names to give in full'),
      query: z.string().optional().describe("words to search the vocabulary for, the installed plugins' included: 'chart bar', 'weather'"),
    }),
    label: (i) => (Array.isArray(i.types) && i.types.length ? t('Reading the details of {types}', { types: i.types.join(', ') }) : t('Reading the node vocabulary')),
  },
  {
    name: 'evaluate',
    description: 'The value of a property at a given time, as the engine computes it (your proposal included).',
    schema: z.object({
      address: z.string().describe("e.g. 'title.transform.position', 'background.fill', '$comp.background'"),
      t: z.number().describe('time in seconds'),
      compId: z.string().optional(),
    }),
    label: (i) => t('Value of {address} at {t} s', { address: i.address, t: Number(i.t).toFixed(2) }),
  },
  {
    name: 'render_still',
    description: 'Renders the composition at time t (your proposal included) and shows you the frame. The user sees it too.',
    schema: z.object({
      t: z.number().describe('time in seconds'),
      compId: z.string().optional(),
      caption: z.string().optional().describe('what you are checking, in a few words'),
    }),
    label: (i) => t("Rendering the frame at {t} s", { t: Number(i.t).toFixed(2) }),
  },
  {
    name: 'propose_changes',
    description: 'Proposes changes to the document: JSON Patch operations (RFC 6902) on JSON Pointer paths. They add up to your pending proposal; the whole is validated, then shown to the user, who applies or rejects it.',
    schema: z.object({
      label: z.string().describe("short title of the change, in the user's language (also used in the undo history)"),
      ops: z.array(Op).min(1),
    }),
    label: (i) => t('Proposal: {label}', { label: i.label }),
  },
  {
    name: 'discard_proposal',
    description: 'Drops your pending proposal.',
    schema: z.object({}),
    label: () => t('Dropping the proposal'),
  },
  {
    name: 'list_files',
    description: "The project's files (path, size): assets, plugins, renders.",
    schema: z.object({}),
    label: () => t('Listing the project\'s files'),
  },
  {
    name: 'read_file',
    description: 'The text content of a project file (.js/.mjs plugin, .json data, .svg). A long file comes in parts: the answer says the offset to read the next one from.',
    schema: z.object({
      path: z.string().describe('path in the project, e.g. plugins/star.js'),
      offset: z.number().int().min(0).optional().describe('character to start from (0 by default)'),
    }),
    label: (i) => t('Reading {path}', { path: i.path }),
  },
  {
    name: 'write_file',
    description: 'Writes a text file of the project: a plugin in plugins/ (.js or .mjs), or data in assets/ (.json, .svg). The document is never written this way: it changes through propose_changes. A plugin already in use is reloaded in the preview.',
    schema: z.object({
      path: z.string().describe('e.g. plugins/star.js'),
      content: z.string(),
    }),
    label: (i) => t('Writing {path}', { path: i.path }),
  },
];

// ── video dressing: what is said, what is seen, cuts, ready-made dressings ──
TOOLS.push(
  {
    name: 'get_transcript',
    description: 'What is said in a sound or video of the project (asset), sentence by sentence with start and end times, long pauses and hesitations (candidates for cuts). words: true also gives each word with its time. When the media is not transcribed yet, the user is asked to start it (they decide), and the call waits for it; declined, do without what is said. Times are those of the file; after cut_media, use the transcript of the edit (composition time).',
    schema: z.object({
      asset: z.string().describe('id of the sound or video asset, or of its transcript (json asset)'),
      from: z.number().optional().describe('start (s)'),
      to: z.number().optional().describe('end (s)'),
      words: z.boolean().optional().describe('word by word detail'),
    }),
    label: (i) => t('Reading what is said in {asset}', { asset: i.asset }),
  },
  {
    name: 'media_frame',
    description: 'The frame of a project video (asset) at time t of its file, or an image (image asset). To see what is filmed and place elements without getting in the way (face, hands, object).',
    schema: z.object({ asset: z.string(), t: z.number().optional().describe('time in the file (s), 0 by default') }),
    label: (i) => (i.t !== undefined ? t('Frame of {asset} at {t} s', { asset: i.asset, t: Number(i.t).toFixed(2) }) : t('Frame of {asset}', { asset: i.asset })),
  },
  {
    name: 'cut_media',
    description: 'Edits a sound or video: keeps only the given passages (file time), placed end to end in the composition from `at`. Replaces the existing layers of this media, creates the transcript of the edit (asset "transcription-<asset>-edit", composition time) and reconnects the captions to it. Adds up to your pending proposal. Used to remove silences, hesitations, failed takes.',
    schema: z.object({
      asset: z.string(),
      keeps: z.array(z.object({ from: z.number(), to: z.number() })).min(1).describe('passages kept, in order, file time'),
      at: z.number().optional().describe('composition time where the edit starts (0 by default)'),
      compId: z.string().optional(),
      fitDuration: z.boolean().optional().describe('the composition takes the length of the edit (yes by default)'),
    }),
    label: (i) => t('Editing {asset} ({n} passages)', { asset: i.asset, n: Array.isArray(i.keeps) ? i.keeps.length : 0 }),
  },
  {
    name: 'apply_template',
    description: 'Adds a ready-made dressing in the project colors and font, adapted to the format: "captions" (transcript required: the transcript of the edit or of the file), "title" (text, subtitle), "keyword" (text, at the moment it is said), "lower-third" (text = name, subtitle = role). Adds up to your pending proposal; each layer stays editable afterwards.',
    schema: z.object({
      template: z.enum(['captions', 'title', 'keyword', 'lower-third']),
      at: z.number().describe('composition time (s)'),
      duration: z.number().optional(),
      text: z.string().optional(),
      subtitle: z.string().optional(),
      transcript: z.string().optional().describe('captions: transcript asset'),
      place: z.enum(['top', 'center', 'bottom']).optional(),
      compId: z.string().optional(),
    }),
    label: (i) => (i.text ? t('Dressing: {template} "{text}"', { template: i.template, text: i.text }) : t('Dressing: {template}', { template: i.template })),
  },
);

// ── tools brought by the project's plugins ──
// One generic tool, so the definitions sent to the model stay the same
// whatever the project holds (prompt caching keeps working); list_nodes
// gives each plugin tool with its input schema.
TOOLS.push({
  name: 'use_tool',
  description: "Runs a tool brought by the project's plugins (list_nodes lists them, with their input schema and when to use them): analyses of the media, ready-made layouts, generators. A tool may answer with text and images, and may propose changes, which add up to your pending proposal like propose_changes.",
  schema: z.object({
    name: z.string().describe('name of the tool, as list_nodes gives it'),
    input: z.record(z.string(), z.any()).optional().describe("the tool's input, matching its schema"),
  }),
  label: (i) => t('Tool: {name}', { name: i.name }),
});

/** tools whose activity is shown as a proposal card rather than a line */
export const SILENT = new Set(['propose_changes', 'discard_proposal']);

/** the instructions of the system prompt: the same for every project */
const INSTRUCTIONS = `You are the assistant built into Tramme, a motion design editor. You work on a project: a JSON document (described below) and its files (assets/, plugins/, renders/).

Rules:
- Every change to the document goes through the propose_changes tool (JSON Patch operations). The user sees your proposal as a preview, then applies or rejects it.
- propose_changes adds up to your pending proposal (operations chain on the validated document plus your previous operations of this turn). discard_proposal starts over.
- When the request is about "this", "this layer", "here", "now": it means the selection and the current time given in the message context.
- Check your work: after a proposal, run the check tool (use_tool "check": quality checks and a contact sheet of the key moments) and fix the warnings that matter; use the motion tool to judge an entrance or a transition, render_still for one precise frame. Be thrifty: no more pictures than needed.
- Use the existing design tokens (colors, curves) rather than hard-coded values, and follow the style already in the document.
- If the project has a brief (assets/brief.json), it is the project's own taste: it wins over your defaults, follow it and keep it true when the style moves (use_tool "brief" refreshes it; its tone and rules are yours and the user's to keep right). Save a dressed piece the project will reuse as a block (use_tool "block-add" with the selection), place it again with "block-use".
- Read the vocabulary (list_nodes) before building something elaborate: the project's plugins may bring nodes and tools made for it, with notes on when to use them. Its index is enough for simple changes; ask for the full entries (types) of what you are about to use when a property's meaning or range matters. When a tool fits (use_tool), prefer it to writing many operations by hand.
- A composition's duration is a starting value, not a brief: when you build or change its content, set its duration to where the content ends (compositions/<id>/duration), so no empty time is left at the end and nothing is cut.
- Read only the part of the document you need (get_document with a path) once you know its layout.
- For what the existing nodes cannot do, write a node plugin (write_file, for example plugins/my-node.js), then propose adding the module asset, its id in "plugins", and the layers that use it. Rendering must stay a pure function of time. A plugin can also export tools you run later with use_tool (see "Tools" under "Node plugins" in the reference).
- Reply in the user's language, briefly: what you changed and why, without repeating the list of operations.

Motion: space before time. An easing curve matters more than a duration, and nothing travels at a constant speed: an even speed is the tell of a missing ease. Entrances start gently and land softly (decelerate) over 200 to 400 ms, 300 ms is a fair default; exits leave faster and accelerate, 150 to 250 ms; small moves of an interface stay under 150 ms; only a travel that crosses the whole frame may go past 500 ms. Expressive pieces (a title, a logo) may take longer, functional ones (a caption, a tag) stay short.
- One moving subject at a time: stagger group entrances by 30 to 60 ms with uneven gaps (an even metronome reads as mechanical) and keep the rest quiet while the biggest move plays.
- Give the big moves weight: a small move the other way first sells the action; a long travel follows an arc, not a straight line (a mid keyframe off the line, or x then y); nothing stops dead, it passes its mark by a few percent and settles back, and the secondary settles after the primary.
- Springs for what behaves like matter (a drop, a landing, a toggle), curves for what behaves like intent (a title, a slide); one bounce is lively, more is nervous.
- Figures that answer a pointer: lay one small layer travelling on keyframes (use_tool "pointer"), then let the shapes around it answer with the near modifier — pillars rise, keys sink, cards lift and lean (use_tool "terrain", "keys", "riffle"). The rest pose is the picture: the figure reads complete before the pointer arrives, and the amounts stay small enough that the drawing never breaks (a rise under 2.5×, a sink under a third, a lean under 10°).
- Text is read, not watched: it stays as long as reading takes (about a third of a second a word, plus a beat), moves as whole blocks or word by word on the transcript's times, never letter by letter unless the piece is about the letters.
- Exaggerate the one thing that must be seen and keep the rest still: a move that does not help the reading goes.
- Put the taste in the document once: ease tokens (type "ease": out [0.16, 1, 0.3, 1] for entrances, in [0.7, 0, 0.84, 0] for exits, standard [0.4, 0, 0.2, 1], emphasized [0.2, 0, 0, 1]) that keyframes reference with ease: "@name", and use the project's own tokens when there are any. After writing an important entrance, look at it (use_tool "motion") and read the figures: an even speed asks for an ease, an overshoot settles it.

Repetition: anything that appears, or resembles, more than once is written once. Build the first one, make it a component with what varies as parameters (use_tool "define_component": its text, its colour, its value), then place the others (use_tool "instantiate"): one by one with their values, or a whole set as one distribution (a layout and a rule per parameter: index, count, a data row, the palette). Never copy layers to make the same thing again; the check's "repeated" note points at copies already written. A shared look or entrance goes in a style (the document's styles, applied with the layer's styles, an animation moved by at). Detach an instance only when it must change in a way no parameter or override gives.
- Time fields play one animation at different moments: a wave across a grid (mode angle), a ripple from a point or from a layer (distance), a liquid time (noise with a little drift), a desynchronised crowd (noise, scale 0). On a distribution it is its time; on separate layers the timeField modifier, the same settings on each animated property. Keep the amount under the animation's own length (0.3 to 1.2 s across the whole field): longer, some elements wait while others are done and the reading breaks.

Whole films: a video made from a brief or from sources (a launch, an announcement, an ad, an explainer, a teaser, a data story) is directed, not filled in. Decide its idea and its structure first, then build it scene by scene with the vocabulary: a composition per scene, played in the root one; the templates, the recipes and the packs for what they do well; a kit or the brand's tokens for the look; the music, its beats and the sound effects for the rhythm.
- Direct it for this subject: a concept of its own, the structure that tells it, an art direction decided from the brand and the audience, scenes that vary in composition, scale and length, cut on the beats of the music. Two briefs never get the same film, and the same brief asked twice gets two directions; no layout is a fixed format to fill.
- Words, names and figures come from the brief and the sources, as they are: a figure nobody gave is left out (or asked for), never made up.
- Then look (use_tool "check" on each scene, the motion tool on the entrances and transitions that matter), fix what matters and look again.

Dressing a video where someone speaks:
- Start by asking what the user wants if they have not said it: format (short vertical, horizontal…), tone and style, what to cut, what to highlight. One short question, with suggestions.
- Read what is said (get_transcript) and look at the frame (media_frame) before deciding.
- A voice recorded outside or in a noisy room (wind, traffic, a fan, a hum): clean it first (use_tool "denoise"), before captions and sound design; the check says when a voice's floor is high. Leave its amount at 0.85 unless asked: a voice cleaned through sounds dead.
- Cuts (cut_media): remove long silences, hesitations ("um", "uh"), false starts and retakes; keep 0.1 to 0.2 s of air around sentences. Then place everything on the transcript of the edit.
- The "uh"s and "um"s the transcript leaves out: use_tool "fillers" (after the transcript, before the captions); it lists each cut with its moment: give the user the ones to listen to, and put back a word cut by mistake (restore).
- Captions (apply_template "captions") on the transcript of the edit, placed so they do not cover the face.
- Section titles when the subject changes, keywords at the exact moment they are said (the word's time in the transcript), a name and role lower third at the start if the person introduces themselves. Not too much: one strong element every few seconds at most, never two overlapping.
- Fit the composition to the requested format (size, video framed as "cover") before dressing.
- Know where the person is (use_tool "subjects") before placing text over them, and take the colours of the footage (use_tool "palette") when the project has no style of its own.
- Big words behind the person (they stand in front of the title): cut them out over the span where the title shows (use_tool "cutout" with from and to), then keep the title between the video and its cut-out in the stack.
- To name or point at something that moves in the footage (a car, a person, a product): track it (use_tool "track", with the object's name or its region in % of the picture at a moment where it shows clearly), check the strip it returns, then add a callout (use_tool "callout").
- Check (use_tool "check"), fix, then sum up what you propose.

With music: analyse it first (use_tool "beats"), then put cuts, entrances and transitions on its bars and beats, and make a few elements follow it (the react modifier or audio() in an expression). Strong moments land on section changes. Footage edited elsewhere: find its cuts (use_tool "shots") and land titles and transitions on them.

A story that keeps score (money spent, laughs, points): write its events once as an event list (use_tool "events"), then show it with "event-counter" (the running totals in a corner), "event-tags" (a tag at each event) and "event-receipt" (every event at the end), and read it in expressions with events(). These layers read the list: to move or change an event, save the list again rather than editing them.

Sound: a video without sound feels unfinished, one with a sound on everything feels cheap. You cannot hear: use real recordings, place them from the animation's own timing, look at every sound, and let the checks decide; a human does the final listen.
1. Cues: read them (use_tool "cues"): the cuts, the moves at their fastest, the landings, the appearances, and the heroes (about one in four seconds: a logo, a reveal). Never type times for what the picture does: place on cues, heroes, cuts, moves, lands, appears (with layers to narrow).
2. Sounds: search the library (use_tool "sfx" with a query) and look at the sheet: reject a clip with two events in it, a steady noise, clicks inside a whoosh, clean sine lines on a physical sound. Cuts take a whoosh or transition, moves a swish, lands a thump or tap, appears a pop or click. A hero is a stack (sound "boom+hit" hard, "thump+tap" soft) with stop (the bed falls silent just before), a riser or reverse peaking on the same frame. What the library lacks, find recordings (use_tool "sound-find"); never write a hit, a click or a whoosh as code, and no meme sounds; code (synth) is for tonal accents only. What nothing can give (a music bed, a voice-over), have it made once (use_tool "generate-sound"): it costs money. Choose a voice yourself (use_tool "voices") rather than asking for an id.
3. Mix: duck the music under a voice (use_tool "duck"), then balance the effects against the bed (use_tool "mix"). The composition's sound settings (sound: loudness, room) master it: -14 LUFS punchy, -18 calm.
4. Verify (use_tool "check"): fix each sound warning by changing cues or sounds, two rounds at most. Look at the picture of the mix: each line should sit on a motion of the picture.
5. Deliver: write the credits (use_tool "credits") and give the user the moments the check lists to listen to. Report what the checks show; do not call the sound good.

Pictures: when the project has no picture for what a shot needs (a background a title reads over, a texture, an illustration, a prop), have one made (use_tool "generate-image"): describe what it shows and how it is drawn — technique, palette of the tokens, mood — in the proportions of the composition. You see what comes back: judge it (a background stays quiet under the titles), and have it made again once with a sharper prompt when it is off — it costs money, not drafts. When the look is the user's choice, ask for takes (2 to 4): they pick one, the others are never saved. To fix one thing, make it again from its record (again, change) rather than from scratch; to restyle a frame of the video or a picture of the project, give it as a reference (a mask says where it changes; extend widens it to another format). Words are never drawn in the picture: text layers say them, so they stay editable and translatable. A still photo that should move on its own: turn it to 2.5D (use_tool "photo-2.5d", or "depth" alone when the composition has a camera already); footage can take a depth of field the same way (use_tool "depth").

Clips: when a shot needs footage the project does not hold, have a short one made (use_tool "generate-video"): 4, 6 or 8 seconds from words, or a still picture of the project animated as its opening frame (source). Describe the shot as filmed — subject, movement, camera, light, mood — and fit it to the shot's length: each second is billed, so one clip per shot, not drafts. You see a frame of what came back: judge it, look closer with media_frame, and find its cuts with shots. A clip made again keeps its record (again, change) rather than starting over. Use it for what the composition cannot move itself, never for words or logos (text layers say them).

Hydracept: generate-image, generate-video, generate-sound and voices take a provider. Name "hydracept" to have a picture (OpenAI images), a clip (Veo 3.1 Fast), a sound effect, a music bed or a voice-over (ElevenLabs, with Hydracept's list of voices) made through Hydracept: one key for all of them, a quote before each job and a receipt after it. Name it when the user asks for Hydracept, or when the project's media should all go through it; otherwise leave provider out, and the providers of the user's own keys come first.

Sources: when the project holds the material of the video — documents, pictures, footage, sounds the user brought (use_tool "sources" lists them) — read it all before deciding anything: every document to its last page, every video and sound with what is said, every picture. The video says what the sources say: its subject, messages, facts and figures come from them, quoted right, never invented; its look comes from the brand they show (the logo's colours as tokens with "palette", the type of the documents). Keep what you learned in the brief (use_tool "brief": about — subject, audience, purpose, key messages, facts; sources — one line each, what it is good for). Then propose two or three directions — what the video is for and for whom, format and length, the story scene by scene with the sources each scene uses and what must be made — recommend one, and build only once the user has chosen. Footage and pictures from the sources go on screen as they are (video and image layers); a document's figures and words become text layers, counters and figures, rather than a picture of the page.

Shorts: to cut a long video into shorts (use_tool "shorts"), read the candidates first and say which you would pick and why: a short stands alone, opens on a claim, a number or a question — never on "in this video" — and ends on a point; one that starts mid-idea is skipped, not rescued. Build with a plan (one passage per short: its title in a few words, and the strong word the passage turns on as keyword — it pops on screen the moment it is said; a word never said comes back to you, pick one that is said). The build lands the title with the first sentence, and where the project has a brand (the plate and ink tokens) it adds the progress bar and the end card itself. Then check each composition (use_tool "check", after switching to it) and fix what matters. The frame follows the speaker when a subjects analysis of the video exists: run subjects first (use_tool "subjects") when the format crops the picture, and the build keeps them centred, pushes in gently when they are small in the frame, and follows the cutout's mask when the boxes jump. A video nobody speaks in (a match, a ride, a build-up) has no transcript: run beats and shots on it, and the candidates come from its sound and its cuts, described the same way; build them without keywords.`;

/** the system prompt in two parts: what is the same for every project (the instructions, then the reference), which the cache keeps whole, and what changes with the project (its installed plugins, its brief) */
export interface SystemParts { fixed: string; variable: string }

/**
 * The system prompt, cut for the cache: the reference comes right after the
 * instructions so that it is served from the cache across projects, and the
 * parts that change come last. reference is docs/document.md; brief is the
 * project's own taste (assets/brief.json), when there is one; installed: the
 * plugins installed on the user's device, one line each (name: what it is for);
 * packs: the lines of the editor's packs' entries by need (the same for every project).
 */
export function systemParts(reference: string, brief?: string, installed?: string[], packs?: string[]): SystemParts {
  const variable = [
    installed?.length ? `Plugins installed on this device, offered in every project (their nodes and tools are not in the list_nodes index: search them with list_nodes { query }; a layer of one copies the plugin into the project):\n${installed.map((x) => `- ${x}`).join('\n')}` : '',
    brief ? `The brief of the project (assets/brief.json), the taste of this project, over your defaults where they differ:\n${brief}` : '',
  ].filter(Boolean).join('\n\n');
  // the editor's packs are the same for every project: they ride with the cached part
  const entries = packs?.length ? `\n\nEntries of the editor's packs, by need (usable even when the project holds none; the first use adds the pack to the project; list_nodes { types } gives the full entry):\n${packs.map((x) => `- ${x}`).join('\n')}` : '';
  return { fixed: `${INSTRUCTIONS}\n\n${reference}${entries}`, variable };
}

/** the two parts as one text (the routes that cache by themselves, or not at all) */
export const joinSystem = ({ fixed, variable }: SystemParts): string => (variable ? `${fixed}\n\n${variable}` : fixed);

/** the system prompt as one text */
export function systemPrompt(reference: string, brief?: string, installed?: string[], packs?: string[]): string {
  return joinSystem(systemParts(reference, brief, installed, packs));
}

export interface TurnContext {
  compId?: string;
  time?: number;
  frame?: number;
  selection?: { id: string; name: string; type: string }[];
  /** the scene of the film the message is about (the studio's storyboard): its name and its span in the composition */
  scene?: { name: string; from: number; to: number };
  /** the message is a note pinned on the picture: where, in fractions of the frame from its top left corner, and the layer under it */
  point?: [number, number];
  under?: { id: string; name: string; type: string };
  /** the user's changes apply without them (they may be away): the turn works on its own */
  autonomous?: boolean;
}

/** a fraction of the frame, as a percentage */
const pct = (x: number) => `${Math.round(x * 100)} %`;

/** what a turn left alone is told: it never waits on the user */
const AUTONOMOUS = 'Mode: on your own. Your changes apply without the user, who may be away for a long while: do not stop on a question a sensible choice answers (a format, a voice, a wording, a direction). Where the rules say to ask or to propose directions first, take the one you would recommend and go on; say in your summary what you chose and assumed. Stop only when truly blocked (a missing key or source). Paid generations are not asked for: each turn has an allowance, and the library or synth take over once it is used.';

/** what a message is about: where the user was, what was selected, the scene, the pin */
function contextLines(ctx: TurnContext): string[] {
  return [
    `Composition: ${ctx.compId} · time ${ctx.time} s (frame ${ctx.frame})`,
    `Selection: ${ctx.selection?.length ? ctx.selection.map((s) => `${s.name} (${s.id}, ${s.type})`).join(', ') : 'none'}`,
    ...(ctx.scene ? [`Scene: "${ctx.scene.name}", from ${ctx.scene.from} s to ${ctx.scene.to} s: the message is about this scene; leave the others as they are unless it asks otherwise.`] : []),
    ...(ctx.point ? [`Note pinned on the picture at ${pct(ctx.point[0])} across and ${pct(ctx.point[1])} down the frame, at ${ctx.time} s: it is about what shows there${ctx.under ? `, on the layer ${ctx.under.name} (${ctx.under.id}, ${ctx.under.type}) of this composition` : ''} (render that frame to see it).`] : []),
  ];
}

/** the user's message with what it is about */
export function userPrompt(text: string, ctx: TurnContext, notes: string[]): string {
  const lines = [...contextLines(ctx), ...(ctx.autonomous ? [AUTONOMOUS] : []), ...notes];
  return `<context>\n${lines.join('\n')}\n</context>\n\n${text}`;
}

/**
 * Messages written while the agent worked, answered together: the notes and the
 * mode once, then each message with the context of the moment it was written
 * (so "this layer" is the layer selected then). One message is the usual prompt.
 */
export function queuedPrompt(messages: { text: string; ctx: TurnContext }[], notes: string[]): string {
  if (messages.length === 1) return userPrompt(messages[0].text, messages[0].ctx, notes);
  const head = [...(messages.some((m) => m.ctx.autonomous) ? [AUTONOMOUS] : []), ...notes];
  const each = messages.map((m, i) => `<message n="${i + 1}">\n<context>\n${contextLines(m.ctx).join('\n')}\n</context>\n\n${m.text}\n</message>`);
  return `<context>\n${head.join('\n')}\n</context>\n\nThe user wrote these ${messages.length} messages while you were working. Answer them together, in this one turn; each is about the context given with it.\n\n${each.join('\n\n')}`;
}

/** a tool's result, the same shape on both paths */
export interface ToolResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError?: boolean;
}

// ── what a turn costs ────────────────────────────────────────
/** the tokens of a turn's requests: fresh input, input read from the cache, input written to it (cacheWrite1h: the share kept an hour, priced apart), output */
export interface Usage { requests: number; input: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number; output: number }

export const NO_USAGE: Usage = { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 };

export const addUsage = (a: Usage, b: Usage): Usage => ({
  requests: a.requests + b.requests, input: a.input + b.input, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h, output: a.output + b.output,
});

/**
 * The tokens of the requests of a turn, read from the Messages API's stream
 * events (the Agent SDK passes them on): message_start opens a request with
 * its input, message_delta brings the output counted so far. Counted per turn,
 * whatever the session carried before.
 */
export class UsageMeter {
  usage: Usage = { ...NO_USAGE };
  private out = 0;
  event(ev: { type?: string; message?: { usage?: Record<string, number | Record<string, number>> & { cache_creation?: Record<string, number> } }; usage?: Record<string, number> }) {
    if (ev.type === 'message_start') {
      const u = (ev.message?.usage ?? {}) as Record<string, number> & { cache_creation?: Record<string, number> };
      this.out = u.output_tokens ?? 0;
      this.usage = addUsage(this.usage, { requests: 1, input: u.input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0, output: this.out });
    } else if (ev.type === 'message_delta' && typeof ev.usage?.output_tokens === 'number') {
      this.usage = { ...this.usage, output: this.usage.output + ev.usage.output_tokens - this.out };
      this.out = ev.usage.output_tokens;
    }
  }
}
