// The messages between the editor and the plugin sandbox: one browser worker
// per project, where the plugins' tools and checks run with no page rights
// (docs/plugin-isolation.md, stage 1). The worker imports the plugin modules,
// answers with what they declare, and runs their authoring-time code against
// a context bridged over these messages. Everything that crosses is plain
// data: live objects (elements, Path2D, functions) stay on their own side.

import type { CheckType, NodeType, EffectType, KitType, PluginMeta, PresetType, PromptType, ToolType } from '@tramme/core';

/** a plugin as the sandbox sees it: its declarations, without any function */
export interface PluginDecl {
  id: string;
  meta?: PluginMeta;
  /** the tools, without their `run` (the page wraps them) */
  tools: Omit<ToolType, 'run'>[];
  /** the checks, without their `run` */
  checks: Omit<CheckType, 'run'>[];
  /** the nodes' schemas, for the tools that read the vocabulary */
  nodes: SchemaNode[];
  effects: SchemaEffect[];
  modifiers: SchemaModifier[];
  /** the tours, as the page's tour engine reads them */
  tours: unknown[];
  /** the interface translations the module carries */
  messages: unknown;
  /** its data exports, plain already: the workflows, the style kits, the add menu's presets (an installed plugin's reach the page only this way) */
  prompts?: PromptType[];
  kits?: KitType[];
  presets?: PresetType[];
}

/** a node without its code: what a tool inside the sandbox may still read */
export interface SchemaNode {
  type: string;
  title: string;
  category: string;
  description?: string;
  ai?: NodeType['ai'];
  props: NodeType['props'];
  container?: boolean;
  /** the node declares a `path` (its outline can be read as data by the draw protocol) */
  hasPath?: boolean;
  /** the node declares viewport `handles` */
  hasHandles?: boolean;
  /** the node declares a vector `export` */
  hasExport?: boolean;
}

export interface SchemaEffect {
  type: string;
  title: string;
  category: string;
  description?: string;
  ai?: EffectType['ai'];
  props: EffectType['props'];
  stage: EffectType['stage'];
}

export interface SchemaModifier {
  type: string;
  title: string;
  params?: Record<string, unknown>;
}

/** what a tool run ships across: the document and its moment, the project's base */
export interface ToolCtxData {
  doc: unknown;
  compId: string;
  time: number;
  selection: string[];
  docUrl: string;
}

/** what a check run ships across: the sampled composition as plain data */
export interface CheckCtxData {
  doc: unknown;
  compId: string;
  comp: unknown;
  step: number;
  /** each placed layer with its node's schema in place of the node itself */
  samples: unknown[];
}

// ── the sandboxed drawing (stage 2) ───────────────────────────

/** a composition's layer as the sandboxed draw code may read it (host.layer) */
export interface LayerSnapshot {
  id: string;
  props: unknown;
  transform: { anchor: [number, number]; position: [number, number]; scale: [number, number]; rotation: number; opacity: number };
  in: number;
  out: number;
}

/** the document's side of the sandbox, shipped when it changes */
export interface SandboxDoc {
  doc: unknown;
  docUrl: string;
  /** the loaded pictures of the document's image assets (copied, not transferred) */
  images: Record<string, unknown>;
  /** the parsed json assets */
  json: Record<string, unknown>;
  /** the fonts, loaded in the sandbox's own realm */
  fonts: { url: string; family: string; weight?: string }[];
}

/** one sandboxed layer to draw for a frame */
export interface DrawItem {
  /** the layer id */
  id: string;
  /** the node type */
  type: string;
  /** the evaluated props at this instant */
  props: unknown;
  /** the simulation state at this frame, when the node simulates (the state stays computed on the page) */
  state?: unknown;
  /** composition time and frame index */
  t: number;
  frame: number;
}

/** a frame's drawing order: what every item's host may read */
export interface DrawPayload {
  frame: number;
  comp: { width: number; height: number; duration: number; fps: number };
  /** the composition's layers at this instant (host.layer) */
  layers: LayerSnapshot[];
  items: DrawItem[];
}

/** a whole composition to evaluate and draw in the sandbox */
export interface FramePayload {
  compId: string;
  t: number;
  /** canvas pixels per composition pixel (the preview draws smaller) */
  scale: number;
  width: number;
  height: number;
  /** the current picture of each video asset, decoded on the page (copied, not transferred) */
  videos?: Record<string, unknown>;
}

/** what one item drew: its picture (over its bounds), or why it failed */
export interface DrawResult {
  id: string;
  ok: boolean;
  /** the picture, of area's size in pixels (or of w × h for gl nodes) */
  bitmap?: unknown;
  /** the bounds the picture covers, in the layer's local space */
  area?: { x: number; y: number; w: number; h: number };
  /** the node's outline as SVG path data (for clips and the viewport) */
  path?: string;
  /** the node's viewport handles at these props */
  handles?: unknown[];
  err?: string;
}

// ── the messages ──────────────────────────────────────────────

/** the page asks, the sandbox answers or asks back */
export type ToWorker =
  | { kind: 'load'; plugins: { id: string; url: string }[] }
  | { kind: 'tool'; name: string; input: unknown; ctx: ToolCtxData; call: number }
  | { kind: 'check'; name: string; ctx: CheckCtxData; call: number }
  | { kind: 'doc'; doc: SandboxDoc }
  | { kind: 'draw'; call: number; payload: DrawPayload }
  | { kind: 'render'; call: number; payload: FramePayload }
  | { kind: 'export'; call: number; type: string; props: unknown }
  | { kind: 'abort'; call: number }
  | { kind: 'answer'; id: number; ok?: unknown; err?: string };

/** the sandbox speaks */
export type FromWorker =
  /** urls[i]: the address plugins[i] was loaded from (a plugin may be asked again at another one meanwhile) */
  | { kind: 'loaded'; plugins: PluginDecl[]; urls: string[] }
  | { kind: 'loadFailed'; id: string; url: string; message: string }
  | { kind: 'result'; call: number; ok?: unknown; err?: string }
  | { kind: 'drawn'; call: number; frame: number; results: DrawResult[] }
  | { kind: 'rendered'; call: number; bitmap?: unknown; err?: string }
  | { kind: 'exported'; call: number; svg?: string; lottie?: unknown; err?: string }
  | { kind: 'ask'; id: number; call: number; q: Ask }
  | { kind: 'progress'; call: number; done: number; total: number; step?: string };

/** what a running tool or check needs from the page */
export type Ask =
  | { kind: 'readText'; path: string }
  | { kind: 'packFile'; path: string }
  | { kind: 'files' }
  | { kind: 'writeFile'; path: string; data: { text: string } | { bytes: ArrayBuffer } }
  | { kind: 'renderStill'; t: number; compId?: string }
  | { kind: 'transcript'; assetId: string; ask: boolean }
  | { kind: 'data'; assetId: string }
  | { kind: 'fetch'; url: string; method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer };
