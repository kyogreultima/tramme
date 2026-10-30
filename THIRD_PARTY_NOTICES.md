# Third-party notices

Tramme is released under the [Functional Source License 1.1, ALv2 Future License](LICENSE) from the version after 0.16.0, and was released under the [Apache License 2.0](LICENSE-APACHE) up to that version. It relies on the open source packages below, which keep their own licenses. None of them is copied into this repository: npm installs them from the registry.

## Contributions that keep the Apache License

One contributor outside the project's author, **jklappstein** (GitHub), wrote the Hydracept provider and the Veo clips between 2026-10-20 and 2026-10-27, under the Apache License 2.0, which the project then used. Those contributions stay under it, in the parts he wrote, inside a work that is otherwise distributed under the Functional Source License. They are:

- the files he created: `apps/editor/src/media.ts`, `apps/editor/src/videos.ts`, `apps/editor/test/videos.test.ts`, `packages/api/src/videos.ts`;
- his changes to `apps/editor/src/ai/index.ts`, `apps/editor/src/api.ts`, `apps/editor/src/images.ts`, `apps/editor/src/settings.ts`, `apps/editor/src/sound.ts`, `apps/editor/src/ui/Providers.tsx`, `apps/editor/src/ui/Settings.tsx`, `apps/editor/src/vault/page.tsx`, `apps/desktop/src-tauri/src/api.rs` and the two interface catalogues (`apps/editor/src/i18n/`).

The repository's history (`git log --author=jklappstein`) says exactly which lines are his.

## Bundled into the editor

These packages end up in the editor's build (`apps/editor/dist`). The build also writes their license comments next to the bundle (`*.LEGAL.txt`).

| Package | License | Use |
|---|---|---|
| [preact](https://github.com/preactjs/preact) | MIT | Interface |
| [@preact/signals](https://github.com/preactjs/signals) | MIT | Editor state |
| [driver.js](https://github.com/kamranahmedse/driver.js) | MIT | Guided tours |
| [mediabunny](https://github.com/Vanilagy/mediabunny) | MPL-2.0 | Video decoding and encoding (MP4, WebM) |
| [gifenc](https://github.com/mattdesl/gifenc) | MIT | GIF export |
| [fflate](https://github.com/101arrowz/fflate) | MIT | `.tramme` archives, PNG sequences |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | Apache-2.0 | Reading PDF documents (the sources of a project); its worker is copied beside the editor (`pdf.worker.mjs`) |
| [@fontsource-variable/geist](https://github.com/fontsource/font-files) (`@fontsource-variable/geist-mono`) | OFL-1.1 | Geist and Geist Mono, the interface fonts (bundled as `.woff2`) |

**About mediabunny (MPL-2.0).** The MPL is a file-level copyleft: if you modify mediabunny's own files and distribute the result, those files must stay under the MPL and their source must be available. Using it unmodified, as Tramme does, places no requirement on Tramme's own code.

## Data shipped beside the packs

The packs carry their data in the repository (`plugins/<pack>/`), read at authoring time; only what a tool used is written into a project.

| Data | License | Use |
|---|---|---|
| [Lucide](https://lucide.dev) (`plugins/icons/lucide.json`) | ISC | The icons pack's pictograms (converted from the SVG set) |
| [Caveat](https://fonts.google.com/specimen/Caveat) (`plugins/handmade/Caveat-Medium.woff2`, the latin subset, weight 500) | OFL-1.1 | The handmade pack's handwritten typeface |
| [Natural Earth](https://www.naturalearthdata.com) (`plugins/maps/*.json`, converted by `scripts/packs/maps.ts`) | Public domain | The maps pack's countries, regions and populated places |
| [STIX Two Math](https://www.stixfonts.org) (`plugins/math/STIX2Math.otf` and its extracted `glyphs.json`) | OFL-1.1 | The math pack's formula typeface |

## Command line and local tools

| Package | License | Use |
|---|---|---|
| [puppeteer-core](https://github.com/puppeteer/puppeteer) | Apache-2.0 | Headless Chrome for offline rendering |
| [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | GPL-3.0-or-later | Downloads an ffmpeg binary for video encoding |
| [ws](https://github.com/websockets/ws) | MIT | Frame transfer from the render page |
| [pngjs](https://github.com/pngjs/pngjs) | MIT | Image comparisons |
| [@huggingface/transformers](https://github.com/huggingface/transformers.js) | Apache-2.0 | Local speech transcription (Whisper) |
| [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) | Proprietary (Anthropic) | The assistant's local companion (`tramme agent`) |

**About ffmpeg-static (GPL).** ffmpeg runs as a separate program, called by the CLI. It is not linked into Tramme, so the GPL does not extend to Tramme's code. If you redistribute the ffmpeg binary itself, follow the ffmpeg license.

**About the Claude Agent SDK.** It is not open source. Its use is subject to [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance). It is only needed for the local companion; the editor, the engine and the CLI renderers work without it.

## Development only

esbuild (MIT), TypeScript (Apache-2.0), Vitest (MIT), Wrangler (MIT OR Apache-2.0), lottie-web (MIT, used to check Lottie exports), and type packages.

## Models

No model is packed with the editor, the desktop app or the command line: each is downloaded from the model hub the first time its tool runs and kept in the browser's cache (the companion: the user's cache). The defaults, listed with the others in `apps/editor/src/models.ts` and in the settings' Models section, all allow commercial use. A model the user picks instead (in the settings) is under its own licence, which the settings show.

| Model | License | Use |
|---|---|---|
| [U²-Net](https://github.com/xuebinqin/U-2-Net) human segmentation and U²-Netp, rembg's weights in ONNX (`jellybox/u2net-human-seg`, `BritishWerewolf/U-2-Netp`) | Apache-2.0 | Cut-out of a person, of any subject |
| [YOLOS](https://github.com/hustvl/YOLOS) tiny (`Xenova/yolos-tiny`) | Apache-2.0 | Detection (people and things, for the cut-out and the tracking) |
| [Depth Anything v2](https://github.com/DepthAnything/Depth-Anything-V2) small (`onnx-community/depth-anything-v2-small`) | Apache-2.0 | Depth (parallax, depth blur). The base and large sizes are CC-BY-NC-4.0: offered in the settings, marked not for commercial work |
| [Whisper](https://github.com/openai/whisper) small (`Xenova/whisper-small`) | Apache-2.0 (the model card; OpenAI's release is MIT) | Transcription in the companion and in the browser |
| [Silero VAD](https://github.com/snakers4/silero-vad) (`onnx-community/silero-vad`) | MIT | Where someone speaks (the fillers tool) |
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) general x4 v3, in ONNX (`TheGuy444/Real-ESRGAN-ONNX`) | BSD-3-Clause | Enlarging a picture with fine texture (the upscale tool, a choice in the settings; the default is the built-in Lanczos) |
| [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) | Apache-2.0 | The faces' skin (the skin tool) |

## Fonts and media

The editor bundles Geist and Geist Mono ([@fontsource-variable](https://fontsource.org), SIL Open Font License 1.1); it works offline. The example projects in `examples/` (drawings, thumbnails) are part of Tramme and under the same Apache 2.0 license.

The sound library in `sounds/` (copied into the editor's build) holds recordings by [Kenney](https://www.kenney.nl) from the packs Impact Sounds, Interface Sounds, Digital Audio, UI Audio, Music Jingles and Sci-fi Sounds, released under [Creative Commons Zero (CC0 1.0)](http://creativecommons.org/publicdomain/zero/1.0/): public domain, free for any use, crediting welcome but not required (`sounds/LICENSE.txt`). The sounds written as code (`apps/editor/src/sound-presets.ts`) are part of Tramme.

## Services

The assistant can call third-party services (Anthropic, OpenAI, Google Gemini, OpenRouter, ElevenLabs, Cloudflare Workers AI), each under its own terms, with keys provided by whoever deploys Tramme. Sounds made by a provider fall under that provider's terms of use.
