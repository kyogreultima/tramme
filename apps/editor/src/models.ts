// The models the editor runs on this machine (docs/editing-roadmap.md, step
// 1): one catalogue per task, the default first, each model with its adapter
// (what picture or sound it takes, what it gives back), because a model is not
// swapped by its name alone. The choice is per computer, like the preview's
// quality: the models live in the browser's cache. Nothing here is bundled;
// each model downloads the first time its tool runs, or from the settings.
//
// `checked` marks the models the tools were tried with. The others come from
// their model cards (licence, size, input) and are listed in
// docs/roadmap-loop/to-validate.md until they are tried.

export type ModelTask = 'cutout-person' | 'cutout-any' | 'detection' | 'depth' | 'transcription' | 'vad' | 'face' | 'upscale';
export const MODEL_TASKS: ModelTask[] = ['cutout-person', 'cutout-any', 'detection', 'depth', 'transcription', 'vad', 'face', 'upscale'];

/** a matte network read with onnxruntime: a square picture in, a matte out */
export interface MatteAdapter {
  kind: 'matte';
  /** side of the square the picture is squeezed into */
  side: number;
  mean: [number, number, number];
  std: [number, number, number];
  /** the picture divided by its brightest value (rembg's U²-Net) rather than by 255 */
  byMax: boolean;
  /** the output: probabilities already (a sigmoid), or values stretched to 0..1 from their range */
  output: 'prob' | 'range';
}

/** a model run through a transformers.js pipeline */
export interface PipelineAdapter {
  kind: 'pipeline';
  pipeline: 'object-detection' | 'depth-estimation' | 'automatic-speech-recognition';
  /** the precisions tried, in order: on the GPU (WebGPU), and on the processor */
  gpu: ('fp32' | 'fp16' | 'q8')[];
  cpu: 'fp32' | 'q8';
}

/** a voice activity detector read with onnxruntime: windows of sound in, the probability of speech out (Silero) */
export interface VadAdapter {
  kind: 'vad';
  /** the sample rate it listens at */
  rate: number;
  /** samples a window */
  window: number;
}

/** a MediaPipe task file (its graph and weights in one), run by MediaPipe's own runtime */
export interface MediaPipeAdapter { kind: 'mediapipe' }

/** the core's own engine (Lanczos): no model, nothing to download; what a task falls back on */
export interface EngineAdapter { kind: 'engine' }

/** a super-resolution network read with onnxruntime: a fixed square tile in, the tile four times as large out (esrgan.ts cuts the picture in tiles); `more` are the other files of the model, its weights beside the graph */
export interface EsrganAdapter { kind: 'esrgan'; tile: number; pad: number; more: string[] }

export interface ModelEntry {
  id: string;
  task: ModelTask;
  name: string;
  /** a file's URL (matte) or a model hub id (pipeline) */
  source: string;
  /** the hub revision the URL or id is pinned to; 'main' follows the repository */
  revision: string;
  /** about how much it downloads, MB (the size the settings show before a download is measured) */
  mb: number;
  /** its licence's SPDX name; empty for a model the user named (its own licence) */
  licence: string;
  /** whether its licence allows commercial use; null when unknown (a model the user named) */
  commercial: boolean | null;
  /** tried with the tool in this version (what to know before choosing the others: the settings' notes) */
  checked: boolean;
  adapter: MatteAdapter | PipelineAdapter | VadAdapter | MediaPipeAdapter | EngineAdapter | EsrganAdapter;
}

/** the files a model keeps in the cache: its source, and the others of a model in several files; none for the built-in engine */
export const filesOf = (m: ModelEntry): string[] => (m.adapter.kind === 'engine' ? [] : [m.source, ...(m.adapter.kind === 'esrgan' ? m.adapter.more : [])]);

const U2NET: MatteAdapter = { kind: 'matte', side: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], byMax: true, output: 'prob' };
const ISNET: MatteAdapter = { kind: 'matte', side: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1], byMax: false, output: 'range' };
const DETECT: PipelineAdapter = { kind: 'pipeline', pipeline: 'object-detection', gpu: ['fp32'], cpu: 'q8' };
const DEPTH: PipelineAdapter = { kind: 'pipeline', pipeline: 'depth-estimation', gpu: ['fp16', 'fp32'], cpu: 'q8' };
const ASR: PipelineAdapter = { kind: 'pipeline', pipeline: 'automatic-speech-recognition', gpu: ['fp32'], cpu: 'q8' };

const hub = (repo: string, revision: string, file: string) => `https://huggingface.co/${repo}/resolve/${revision}/${file}`;

export const MODELS: ModelEntry[] = [
  // the cut-out of a person: U²-Net trained on people (rembg's u2net_human_seg.onnx, the same bytes;
  // BritishWerewolf/U-2-Net-Human-Seg holds U²-Netp's file under that name)
  {
    id: 'u2net-human-seg', task: 'cutout-person', name: 'U²-Net human segmentation', revision: 'f5c523ea3d391bf2f366ba98a84b280b6bd23c61',
    source: hub('jellybox/u2net-human-seg', 'f5c523ea3d391bf2f366ba98a84b280b6bd23c61', 'u2net-human-seg_320.onnx'),
    mb: 168, licence: 'Apache-2.0', commercial: true, checked: true, adapter: U2NET,
  },
  {
    id: 'u2netp-person', task: 'cutout-person', name: 'U²-Netp (small)', revision: '7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8',
    source: hub('BritishWerewolf/U-2-Netp', '7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8', 'onnx/model.onnx'),
    mb: 4.6, licence: 'Apache-2.0', commercial: true, checked: true, adapter: U2NET,
  },
  // the cut-out of any subject
  {
    id: 'u2netp', task: 'cutout-any', name: 'U²-Netp (small)', revision: '7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8',
    source: hub('BritishWerewolf/U-2-Netp', '7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8', 'onnx/model.onnx'),
    mb: 4.6, licence: 'Apache-2.0', commercial: true, checked: true, adapter: U2NET,
  },
  {
    id: 'u2net', task: 'cutout-any', name: 'U²-Net (full)', revision: 'c08042b462485d8597c89d3ce831d00be8582c5c',
    source: hub('BritishWerewolf/U-2-Net', 'c08042b462485d8597c89d3ce831d00be8582c5c', 'onnx/model.onnx'),
    mb: 168, licence: 'Apache-2.0', commercial: true, checked: true, adapter: U2NET,
  },
  {
    id: 'isnet-general', task: 'cutout-any', name: 'IS-Net general use', revision: '9783722d9f964c0286a411e7e8e6fede947d5a53',
    source: hub('BritishWerewolf/IS-Net', '9783722d9f964c0286a411e7e8e6fede947d5a53', 'onnx/model.onnx'),
    mb: 170, licence: 'Apache-2.0', commercial: true, checked: true, adapter: ISNET,
  },
  // detection: boxes of people and things
  { id: 'yolos-tiny', task: 'detection', name: 'YOLOS tiny', source: 'Xenova/yolos-tiny', revision: 'main', mb: 26, licence: 'Apache-2.0', commercial: true, checked: true, adapter: DETECT },
  { id: 'yolos-small', task: 'detection', name: 'YOLOS small', source: 'Xenova/yolos-small', revision: 'main', mb: 120, licence: 'Apache-2.0', commercial: true, checked: true, adapter: DETECT },
  { id: 'detr-resnet-50', task: 'detection', name: 'DETR ResNet-50', source: 'Xenova/detr-resnet-50', revision: 'main', mb: 167, licence: 'Apache-2.0', commercial: true, checked: true, adapter: DETECT },
  // depth
  { id: 'depth-anything-v2-small', task: 'depth', name: 'Depth Anything v2 small', source: 'onnx-community/depth-anything-v2-small', revision: 'main', mb: 99, licence: 'Apache-2.0', commercial: true, checked: true, adapter: DEPTH },
  { id: 'depth-anything-small', task: 'depth', name: 'Depth Anything v1 small', source: 'Xenova/depth-anything-small-hf', revision: 'main', mb: 99, licence: 'Apache-2.0', commercial: true, checked: true, adapter: DEPTH },
  { id: 'depth-anything-v2-base', task: 'depth', name: 'Depth Anything v2 base', source: 'onnx-community/depth-anything-v2-base', revision: 'main', mb: 390, licence: 'CC-BY-NC-4.0', commercial: false, checked: true, adapter: DEPTH },
  // transcription: Whisper, in the companion or in the browser (the model cards of the Hugging Face ports say Apache 2.0, OpenAI's code MIT)
  { id: 'whisper-small', task: 'transcription', name: 'Whisper small', source: 'Xenova/whisper-small', revision: 'main', mb: 250, licence: 'Apache-2.0', commercial: true, checked: true, adapter: ASR },
  { id: 'whisper-base', task: 'transcription', name: 'Whisper base', source: 'Xenova/whisper-base', revision: 'main', mb: 80, licence: 'Apache-2.0', commercial: true, checked: true, adapter: ASR },
  { id: 'whisper-tiny', task: 'transcription', name: 'Whisper tiny', source: 'Xenova/whisper-tiny', revision: 'main', mb: 40, licence: 'Apache-2.0', commercial: true, checked: true, adapter: ASR },
  // where someone speaks (the hesitations the transcript leaves out)
  {
    id: 'silero-vad', task: 'vad', name: 'Silero VAD', revision: 'e71cae966052b992a7eca6b17738916ce0eca4ec',
    source: hub('onnx-community/silero-vad', 'e71cae966052b992a7eca6b17738916ce0eca4ec', 'onnx/model.onnx'),
    mb: 2.2, licence: 'MIT', commercial: true, checked: true, adapter: { kind: 'vad', rate: 16000, window: 512 },
  },
  // the landmarks of faces (the skin tool)
  {
    id: 'face-landmarker', task: 'face', name: 'MediaPipe Face Landmarker', revision: 'float16/1',
    source: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    mb: 3.8, licence: 'Apache-2.0', commercial: true, checked: true, adapter: { kind: 'mediapipe' },
  },
  // the export that gives the cross attentions: onnx-community/whisper-large-v3-turbo has none, so it cannot time the words
  { id: 'whisper-large-v3-turbo', task: 'transcription', name: 'Whisper large v3 turbo', source: 'onnx-community/whisper-large-v3-turbo_timestamped', revision: 'main', mb: 1090, licence: 'MIT', commercial: true, checked: true, adapter: ASR },
  // enlarging a picture: the core's Lanczos by default (the fallback of every other row), a network for the fine texture Lanczos cannot invent; a video stays with the engine (a network over every frame would take hours)
  { id: 'lanczos-enlarge', task: 'upscale', name: 'Lanczos (built in)', source: '', revision: 'builtin', mb: 0, licence: '', commercial: true, checked: true, adapter: { kind: 'engine' } },
  {
    id: 'realesr-general-x4v3', task: 'upscale', name: 'Real-ESRGAN general x4 v3', revision: '4c80f3da1a8a85f0757a9e7f79e08d0307220eb5',
    source: 'https://huggingface.co/TheGuy444/Real-ESRGAN-ONNX/resolve/4c80f3da1a8a85f0757a9e7f79e08d0307220eb5/onnx/model.onnx',
    mb: 4.9, licence: 'BSD-3-Clause', commercial: true, checked: true, adapter: { kind: 'esrgan', tile: 128, pad: 8, more: ['https://huggingface.co/TheGuy444/Real-ESRGAN-ONNX/resolve/4c80f3da1a8a85f0757a9e7f79e08d0307220eb5/onnx/model.data'] },
  },
];

/** the models known for a task, the default first */
export const modelsFor = (task: ModelTask) => MODELS.filter((m) => m.task === task);
export const defaultModel = (task: ModelTask) => modelsFor(task)[0];

/** the pipeline of the tasks that take any model hub id of it (the advanced field); none for the mattes, which need their adapter */
export const PIPELINE_OF: Partial<Record<ModelTask, PipelineAdapter>> = { detection: DETECT, depth: DEPTH, transcription: ASR };

/** a choice written in the settings for a model hub id rather than a known model */
export const HUB_PREFIX = 'hub:';

/** a model hub id: owner/name, letters, digits, dots, dashes and underscores */
export const isHubId = (s: string) => /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/.test(s);

/**
 * The model a choice stands for: a known one by its id, a model hub id
 * ("hub:owner/name") for a task that goes through a pipeline, or the default
 * when the choice is empty, unknown or does not fit the task.
 */
export function resolveModel(task: ModelTask, choice?: string | null): ModelEntry {
  if (choice?.startsWith(HUB_PREFIX)) {
    const id = choice.slice(HUB_PREFIX.length), adapter = PIPELINE_OF[task];
    if (adapter && isHubId(id)) return { id: choice, task, name: id, source: id, revision: 'main', mb: 0, licence: '', commercial: null, checked: false, adapter };
  }
  return modelsFor(task).find((m) => m.id === choice) ?? defaultModel(task);
}

/** what an asset made by a model records: the model and the version of its files */
export const madeBy = (m: ModelEntry) => `${m.id}@${m.revision}`;

/** the cache key a model's files are kept under (the URL of a matte; the hub path of a pipeline model) */
export function cachePrefix(m: ModelEntry): string {
  return m.adapter.kind !== 'pipeline' ? m.source : `https://huggingface.co/${m.source}/resolve/`;
}
