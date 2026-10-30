# Tramme

A motion design engine and editor. The document (JSON) is the source of truth; the editor and the AI change it through the same operations API. Rendering is deterministic: every frame is a pure function of `t`.

## Principles

- Document = scene graph: nestable compositions, layers, groups, assets, design tokens, markers, sound. The format is described in [docs/document.md](docs/document.md), with a JSON schema in [schema/tramme-1.schema.json](schema/tramme-1.schema.json).
- A project = the document and its files (assets, plugins), in a defined format: [docs/project.md](docs/project.md). It is exchanged as a `.tramme` archive.
- Every property is static, keyframed, an expression or a link, with an optional stack of modifiers (wiggle, loop, spring, stagger, noise, smoothing).
- Open vocabulary: each layer type is a node that declares its property schema. The inspector and the validator are generated from it. A project can add its own nodes, effects and modifiers through plugins (JS modules).
- The same engine for preview and export.
- The AI is a first-class user: the same operations as the editor, the same undo and redo.

## Getting started

Node 24 or newer. Chrome for command-line renders.

```sh
npm install
npm test                      # the engine, the operations, the format, the interop, the editor's logic, the Worker, the API and the desktop storage
npm run typecheck

npm run dev                   # the editor on http://localhost:8787/ (local Worker, projects in .wrangler/state)
npm run site                  # the landing page and the docs (Astro) on http://localhost:4321/
npm run desktop:dev           # the editor as a native window (Tauri 2), projects in Documents/Tramme
```

`npm run dev` rebuilds the editor on every change and runs the Worker locally (`wrangler dev`): R2 storage simulated on disk, no Cloudflare Access. It also starts the assistant's companion, which pairs with this editor by itself (`TRAMME_NO_COMPANION=1` to go without it). The home screen starts a film from words: describe it, add its material if there is any, pick a format, and the project opens in the studio with the assistant at work. A blank project, a video, a `.tramme` file, a Lottie animation and the examples are there too.

For the assistant with another local page, in a second terminal:

```sh
npm run tramme -- agent      # companion: Claude with this machine's Claude Code login
```

then paste the token it prints in the editor (Assistant, settings). See [The assistant](#the-assistant).

## The desktop app

The same editor in a native window ([Tauri 2](https://v2.tauri.app/); Windows, macOS and Linux, unsigned installers): `npm run desktop:dev`. A custom protocol serves the built editor and its `/api` routes from Rust, so the editor runs unmodified and its projects live in folders (`Documents/Tramme` by default, changed in the settings), without a server. Videos over 95 MB are sent in parts like on the web, a `.tramme` double-clicked in the file explorer opens in the running window, and the storage passes the same contract suite as R2 and the browser. The assistant works without a server too: the provider keys live in the system keychain, the provider routes run in the page and their requests leave through Rust (transcription included, with the OpenAI key); the companion `tramme agent` also works from the app, with its origin (`npm run tramme -- agent --origin http://tramme.localhost`). The whole picture, and what comes next, in [docs/desktop-and-mobile-apps.md](docs/desktop-and-mobile-apps.md).

## Deploying

On Cloudflare, in one of two modes. **Private**: the Worker serves the editor and the API, projects live in R2, Cloudflare Access protects the whole. **Personal** (`npm run deploy:personal`): a public deployment anyone uses without an account; projects stay in each visitor's browser, keys in a key vault the editor cannot read, and the browser calls the providers itself. Step by step in [docs/deploy.md](docs/deploy.md). The private mode, in short:

```sh
npx wrangler r2 bucket create tramme-projects
# Cloudflare Access: an application on the domain, then ACCESS_TEAM_DOMAIN and ACCESS_AUD in apps/worker/wrangler.jsonc
npm run deploy
# optional: provider keys (Anthropic, OpenAI, Gemini, OpenRouter, Z.AI, ElevenLabs, Hydracept with its project ID, custom) in the editor's Settings, Providers
```

## Commands

```
tramme validate <doc>                                 structure, references, types, plugins included
tramme check    <doc> [--comp id]                     the picture checks, issues folded by cause
tramme still    <doc> --t 0.5,1.2 [--samples n]       PNG stills
tramme render   <doc> [--format mp4|mov|webm|gif|png] [--from s --to s] [--samples n] [--mute] [--pages n] [--depth 8|10]
tramme export   <doc> --format lottie|svg|wav [--t s] vector export, or sound only
tramme import   <animation.json> [--out folder]       Lottie to a Tramme project
tramme pack     <folder> [--out project.tramme]        a project folder as a .tramme archive (checked)
tramme unpack   <project.tramme> [--out folder]        a .tramme archive as a project folder (checked)
tramme nodes    [<doc>]                               the available vocabulary
tramme agent    [--origin https://…] [--port 4317]    the assistant's local companion
tramme compare  <ref> <test> [--diff folder]          PSNR and an image of the differences
tramme check-export <doc> --format lottie|svg --t …   export read back (lottie-web, Chrome) against Tramme
tramme bench    <url of an open project>              how the editor holds up: playback, drag, hover
tramme load     [case…] [--json file] [--before file] the load cases of bench/load: where a frame's time goes
tramme schema                                         regenerates the JSON schema
```

(`tramme` = `node packages/cli/src/main.ts`, or `npm run tramme -- <command>`. `<doc>` is a project folder or a document file.)

## Layout

```
apps/
  editor/    the editor (Preact): the home (a film from words), the studio (the film directed in notes), the atelier (viewport, timeline, curves, inspector), the assistant, exports
  worker/    the Cloudflare Worker: serves the editor; private mode: projects in R2, assistant relay, Cloudflare Access check; personal mode: the key vault's page and its relay
  desktop/   the native app (Tauri 2): one window on the editor, the /api storage answered from the local folders in Rust
  site/      the project's site (Astro, static, light and dark): the landing page (no engine on the page; the examples as videos in src/videos, placeholders until they are there) and the docs under /docs/ (Starlight, made from docs/ and this README: src/lib/docs.ts)
packages/
  core/      document, properties, keyframes, expressions, modifiers, evaluation, operations, validation
  nodes/     built-in nodes: shapes, path, image, sequence (drawn animation), video, text, captions, counter, event tag and receipt, callout, group, composition, particles, shader, follow, code, sound; effects
  render/    rendering: Canvas2D backend, WebGL2 compositor (motion blur, linear color, finishing), assets
  interop/   Lottie and SVG export, Lottie import (browser and Node)
  project/   the tramme-project/1 project format: manifest, allowed paths, checks, .tramme archive
  assistant/ what the assistant can do: models, prompt, tools (shared by the editor and the companion)
  plugin/    the types of a plugin (nodes, effects, tools…) and definePlugin(), for completion and checks while writing one
  api/       the /api routes wherever they run: storage over any bucket (R2, IndexedDB), providers reached with the user's keys
  cli/       command line: offline renders (headless Chrome + ffmpeg), exports, project format, companion
examples/
  launch-film/ "Launch film": 45 s on the beat, nested compositions, a 2.5D camera, sound-reactive motion, music and sound written as code
  showreel/    "Showreel": made by the assistant, kinetic type, shapes, a counter, a shader smoke, particles, a camera look
  anime/       "Evening Breeze": example anime, frame by frame drawings in sequences, three shots (made by scripts/anime-example.ts)
```

## The editor

- Home: the direction box first. Words describe the film (subject, tone, length; ideas to start from under it), material joins them (documents, pictures, footage, sounds, a whole folder, picked or dropped), a format is chosen (16:9, 9:16, 1:1, 4:5), and the project opens in the studio with the assistant already at work: words alone start the assistant on the film, words with material are read first (`/analyze`), one video is dressed as the words say. Under it, your films with their thumbnails and the examples; a blank project (formats, frame rate), a video (at its size, frame rate and length), a `.tramme` file or a Lottie animation are under "Other ways in" (or dropped on the page). Each project can be renamed, duplicated, saved to the computer as `.tramme`, or deleted.
- Two views of a project, one switch in the top bar (and in the settings): the **studio**, where you direct, and the **atelier**, where you craft. The studio is the default.
- Studio: the film in front, directed in words. The direction bar under the picture takes what you want, as you would tell an editor ("the intro drags", "a bolder title here"); a click on the picture pins the note there (the assistant is told the point and the layer under it), a click on a scene of the storyboard puts it in focus (the notes and the suggestions are about it until the focus goes). Suggestions over the bar change with the moment: ideas for an empty film, the whole film's (review, rhythm, palette, sound, a 9:16 version), the scene's (more impact, calmer, another layout, shorter, redo). While the assistant works, the stage it is at shows over the film (reading, directing, building, sound, reviewing) and a light runs around the picture; its result arrives as a **take**, to compare before and after, keep, set aside, or do again in another direction. The storyboard under the film: the scenes (the composition's scene markers, or the compositions a film plays) as strips of their own frames with their names, the sound (music and voice drawn, effects as ticks), the notes at their moments, a press to seek and a drag to scrub. Beside the film, the notes, each with its moment, its scene and its pin, the assistant's work under it (its stages, its steps one click away, the frames it looked at, its take), and the direction it follows: the film's idea, the brief (about, tone, rules: edited here, it wins over the assistant's habits), the palette and type, the material. Keys: N writes a note, P pins it, Escape lets go, Space plays.
- Atelier: the classic editor, for the detail; the same project, the same conversation.
- An imported file is checked before it enters storage: format structure, document, loaded plugins, present assets. An imported project always gets a new id.
- Top bar: back to projects, name, autosave (refused if the document changed in another tab), the view, undo and redo (Ctrl+Z, Ctrl+Shift+Z), composition, format, frame rate, export (in the studio, the format, frame rate and length in one menu).
- Left: layer tree (drag and drop, rename, hide, precompose), compositions and assets (import by drag and drop, Lottie included), brand tokens.
- Packs: general-purpose plugins ship with the editor — charts, kinetic type, physics, stick figures, icons, diagrams, UI walkthrough, accessibility checks, localization, code view, rhythm, screencast, handmade, chat, emoji, maps, math, matter, print, QR codes, logos in 3D — and the Code section of the left panel adds one to the project in a click. Plugins can bring their own translations: [docs/i18n.md](docs/i18n.md).
- Languages: English and French (settings, Appearance; automatic from the browser). Plugins can bring their own translations: [docs/i18n.md](docs/i18n.md).
- Guided tours (? button): the home screen and the editor introduce themselves the first time they open; the other tours (the tricks, drawn animation, sound, looks, cutting on tracks, speech, the tools of the / menu, the assistant, making the editor one's own) wait in the help menu. A plugin or a script can add its own: [docs/tours.md](docs/tours.md).
- Settings (gear, Ctrl+,): dark, light gray or system theme; the pictures a provider makes (provider, quality, size at most); the clips a provider makes (provider, length); preview quality per computer, while playing (automatic from the frame rate reached, full, half, quarter) and when still (displayed size or full resolution), preview motion blur (document, limited, off), playback at the composition's frames; the assistant's model and access. Exports always stay at full quality. The preview stays sharp when still, and its final image is computed in slices without freezing the interface.
- Viewport: the engine's preview, zoom (Ctrl+wheel), pan (Space or middle button), safe zones, grid, click to select, move, scale and rotate handles. A path's vertices drag with their tangents (Shift keeps the two tangents mirrored; Alt+click on the stroke adds a vertex, Delete takes the selected one out), and the anchor cross moves with the layer staying put on screen (Alt moves the anchor alone).
- Transport and timeline: playback with sound, editable timecode, layer bars to move or trim, keyframes to drag, markers. The right click opens the timeline's own menus (never the browser's): on a clip, split, trim the start or the end or bring it to the playhead, then the layer's menu; on an empty place or the ruler, the playhead or a marker there, the composition ending there or at its content, a layer, select all, the whole timeline in view; on a marker, go there or delete it; on a keyframe, its curve.
- Tracks: a composition can be a sequence, its clips on lanes (locks, magnets, mute, solo), cut with the keys of an editor (Ctrl+B, Q and W, Shift+Delete, insert and overwrite, roll, slip, slide), fed from a media panel with bins, tags, a source monitor and sub-clips, with a mixer, multicam, voice-over recording and a guided publication: [docs/montage.md](docs/montage.md).
- Curves: values over time, Bézier handles per segment, curve presets and tokens, final curve with modifiers.
- Inspector generated from the schemas: each property can be fixed, animated, an expression or a link; stackable modifiers and layer effects.
- Drawn animation: the "Image sequence" layer plays drawings frame by frame, held "on twos" or driven by an exposure sheet (`1-4/2, 5/6, 4-1/2, x/3`), looping, once or ping-pong; a drawing can be forced with hold keyframes (a mouth). Numbered drawings imported together (`eye_01.png`, `eye_02.png`…) go in their own folder; right click, "Animate the folder", turns them into a sequence. Motion blur never mixes two drawings.
- Video: the "Video" layer plays an MP4, WebM or MOV file frame by frame (WebCodecs, range requests, never loaded whole), at the exact frame on export; its sound goes into the preview and the exports. Each layer can start further into the file (`start`): an edit is a series of layers. Files larger than 95 MB are uploaded in parts (4 GiB at most).
- Sound: "Sound" layers with volume (animatable: fades, ducking), fades, low and high cut, a three-band equaliser (low shelf, mid bell with its frequency, high shelf), reverb and speed, mixed by one mixer in the preview, the exports and the command line. A library of 421 recorded sounds (Kenney, CC0) and sounds written as code ships with the editor; your own sounds go into a library shared by the projects.
- Speech: nothing is transcribed on its own. The Transcribe button (on a file joined to a message, on the material of the film, in the assets, in the "Speech" section of the inspector of a sound or video layer, in their menus) makes the transcript (words and times), a JSON asset; when the assistant needs one that is missing, it asks first. The "Captions" layer shows it a few words at a time, the spoken word highlighted (color, pill or scale).
- Event lists: a story that keeps score (money spent, laughs, points) writes its events once (`/events`: `3.1 Petrol cash -18 | full tank`). Counters in a corner roll at each change (`/event-counter`), a tag pops up at each event (`/event-tags`), a receipt lists them all at the end (`/event-receipt`), and expressions read the running totals with `events()`. They all read the list: change it and they follow.
- Tracked callouts: draw a rectangle over something filmed (or name it: a car, a person), `/track` follows it through the shot and `/callout` puts brackets and a label on it that stay on it; expressions read where it is with `track()`.
- Export in the browser, with the preview's engine: MP4 (H.264), WebM (VP9 with alpha), GIF, PNG sequence (zip), Lottie, SVG of the current frame, WAV. The file is saved to the computer or kept in the project's `renders/`.
- Responsive and touch: under 760 px, the studio puts the film, then the storyboard, then the notes one under the other, the direction bar at the thumb; the atelier's panels become tabs under the picture; the header gathers composition, format, frame rate, view, help and settings in a "⋯" menu; the home screen goes to one column. With a finger, pinch to zoom, two fingers move the view, one finger on the background too. The editor can be installed on a phone's home screen (web manifest).

## The assistant

It works on the selection and the current time, reads the document, renders frames to check its work, and proposes its changes as a batch of operations shown in the preview, to apply or reject, then undoable. It can write node plugins (`plugins/`) and data (`assets/*.json`) in the project, never the document itself. Each conversation is saved in the project (`.tramme/chats/`); the history (clock button) lists them, reopens them to continue or deletes them, and "+" starts another one without erasing the previous ones.

Its tools run in the editor (document, engine, project files). It talks with the AI the user connects, from any device, phones included:

- **An AI account, first**: Claude (Anthropic), ChatGPT's models (OpenAI), Gemini, OpenRouter, Z.AI (GLM) or a **custom provider** (any service of the OpenAI chat format, by its base URL), each with the key of its account pasted once in Settings, Providers (kept by the Worker, never sent back to the browser; Cloudflare secrets such as `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` work too). One is enough: when the chosen model cannot be reached but another AI is connected (only a Gemini key, say), the assistant takes that AI's strongest model and says so. For Claude, the Worker relays the Messages API (Opus 5.5 by default, Sonnet 5.5, Haiku 5.5, Haiku 4.5); the others are listed by the Worker (for OpenRouter, the models that accept tools), and a model missing from the list can be typed in full (`openai:model-name`, `zai:glm-4-plus`, `custom:<id>:model-name`). A ChatGPT subscription does not include a key: it comes from the OpenAI platform.
- **The local companion, for those who run an agent on their computer**: `tramme agent` runs one of the agents installed on the machine, each on its own login, no key: **Claude Code** (the Claude Agent SDK and the Claude Code login), **Codex** (the Codex CLI and a ChatGPT login: `npm install -g @openai/codex`, then `codex login`) or **Antigravity** (the Antigravity CLI, which replaced the Gemini CLI, and a Google login: `irm https://antigravity.google/cli/install.ps1 | iex` on Windows, `curl -fsSL https://antigravity.google/cli/install.sh | bash` elsewhere, then `agy` once). The companion finds the command lines on its own (`codex` and `agy` on the `PATH`) and the model menu offers them as "ChatGPT (Codex)" and "Antigravity", their default model or one typed in full (`codex:gpt-5-codex`), and for Antigravity the models it lists for the login (`agy models`). Each agent gets Tramme's tools and nothing else: no shell, no files, no web search; the two command lines reach the tools as an MCP server the companion serves at an address that holds for one turn (`/mcp/<key>`), and run in folders of their own (`~/.tramme/engines/`), where their sessions are found again for the next message (Antigravity with a home of its own there, so the user's plugins, skills and MCP servers stay out; of the files, it reads only the images joined to the message). It listens on `127.0.0.1:4317`, accepts only pages from the origins given with `--origin` (and localhost), and requires a pairing token (kept in `~/.tramme/companion.json`, `--renew` makes a new one). An editor whose address is given with `--origin` gets this token by itself; another local page must be given it by hand, in the assistant's access settings (under "Local companion"). It has no files and no terminal: only Tramme's tools, run by the editor. For Claude, in automatic mode, the editor takes the companion if it answers and the Anthropic key otherwise; the assistant's header shows the path taken. Phones never see it offered.
- **Local models** (Ollama, LM Studio), called directly by the browser at the address set in the access settings (Ollama: `http://127.0.0.1:11434/v1`). For the online editor, Ollama must accept its address (`OLLAMA_ORIGINS`).

All of them speak OpenAI's chat format: the same tools, the same loop in the editor, the same conversation (you can switch models midway; a model that cannot read images gets a note in their place). Small local models follow tools less well than Claude.

Images, sounds, videos and PDF documents can be attached to a message (paperclip, drag and drop, paste). Each file enters the project (`assets/chat/`), and images, sounds and videos become assets; the assistant sees the images, reads what sounds and videos say once they are transcribed (a Transcribe button on the file), and reads documents page by page.

**From sources.** Material joined to the home's direction box (files or a whole folder, chosen or dropped on it) makes a project of what a video is made from: PDF documents, pictures, footage, sounds, kept in `assets/sources/`. A kit among them (a `brief.json` of kind `tramme-kit`, as an agent writes it from a project's repository: about, tokens, fonts, tone, rules, sources, features, facts, video ideas) sets up the project: its colours and curves become the tokens (`plate` and `ink` also the background and text), the fonts it names and brings font assets, its about, sources, tone and rules the brief; the whole kit stays at `assets/sources/kit.json`, its paths pointing at the files as imported, and the assistant reads it first. The sounds and videos are transcribed, and the analysis starts at once with the words given (without words, `/analyze` waits in the message box): the assistant lists the sources (`sources`: a contact sheet of them all), reads every one (a document's pages as text and as pictures, a video's frames across its length with what is said), takes the brand's colours (`palette`), writes what it learned in the brief (`about`: subject, audience, purpose, messages, facts; `sources`: what each one is good for), then proposes two or three directions for the video (format, length, scene by scene, the sources each scene uses) and builds the one you pick. Documents are read in the browser with pdf.js.

**Dressing a video.** A video in the home's direction box (or "From a video" under "Other ways in") creates the project at its size (its speech is transcribed with the Transcribe button on the video); with words, the assistant starts on them, without, it asks what you want: format, cuts, style, words to highlight. It reads what is said (`get_transcript`: timed sentences, pauses, hesitations), looks at the video (`media_frame`), cuts (`cut_media`: the kept passages placed end to end, the transcript remapped to the edit, the captions reconnected) and dresses with templates in the project's colors (`apply_template`: captions, section title, keyword, name and role lower third). Everything arrives as one proposal, checked with rendered frames, to apply or reject.

**Sound design.** The assistant gives a video its sound (`/sound-design`), the way [opus-sound-layer](https://github.com/Bodila51/opus-sound-layer) does it: it reads the cues from the animation's own timing (cuts, moves, landings, appearances, the heroes among them: `cues`), places real recordings on them, the hit of each on the frame (`sfx`, a hero stacked with the music stopping before it), finds CC0 recordings the library lacks and judges them (`sound-find`), lowers music under a voice (`duck`), balances each effect against the bed band by band (`mix`), and checks the mix as an engineer would: the master at its loudness and true peak, each effect on its cue and heard, the music under the voice, with a picture of the mix and moments to check by ear (`check`). Sound effects, music beds and voice-overs come from a provider when there is a key (`generate-sound`: ElevenLabs v4, OpenAI, Gemini; `voices` picks the voice). Every export is mastered to the composition's loudness (-14 LUFS by default). See [docs/sound-roadmap.md](docs/sound-roadmap.md).

**Pictures.** When the project holds no picture for what a shot needs, the assistant has one made (`generate-image`: OpenAI, Gemini, Z.AI): a background a title reads over, a texture, an illustration, a prop, described by its prompt and drawn in the proportions of the composition. The file and what made it join the project, the picture is proposed as an image layer, and the tool answers with the picture, so the assistant judges what came back. Words are never drawn in the picture: text layers say them. See [docs/generation-roadmap.md](docs/generation-roadmap.md).

**Clips.** When a shot needs footage the project does not hold, the assistant has a short clip made (`generate-video`: Veo 3.1 Fast through Hydracept): a 4, 6 or 8 second shot from words, or a still picture of the project animated as its opening frame. The file and its record (`.video.json`) join the project, the clip is proposed as a video layer at the playhead, and the tool answers with a frame of it, so the assistant can judge it; `shots` finds its cuts and `media_frame` looks closer. It costs money by the second, so the user says yes first. See [docs/generation-roadmap.md](docs/generation-roadmap.md).

Transcription runs first on the Worker (Workers AI, Whisper large v3 turbo), otherwise through the local companion (Whisper small, downloaded on first use). The sound is extracted in the browser and sent in 28 s slices.

## Milestones and checks

1. **Core and Canvas2D rendering.** Checked by replaying, from a document, an existing animation written in code: seven scenes through the `code` node that wraps the original code, one scene rewritten with built-in nodes. Of 28 frames compared with the original, 21 are bit-identical (grain, glow and motion blur included) and the 7 of the native scene differ by at most 2 levels out of 255 (PSNR ≥ 91.7 dB), at the same rendering speed.
2. **Editor v1.** Viewport, timeline, inspector, undo and redo, assistant; tried end to end (AI proposal, preview, apply, save).
3. **Curves and modifiers.** Bézier curve editor; modifiers as pure functions of `t`, tested.
4. **Plugins.** Layer effects (blur, shadow, glow, color, tint), GLSL shaders, deterministic particles, nested compositions with time remapping; project plugins (nodes, effects, modifiers).
5. **Export and interop.** On the command line: MP4, MOV ProRes 4444 and WebM VP9 with alpha, GIF, PNG sequence, WAV. In the browser: MP4, WebM with alpha, GIF, PNG, WAV. Lottie (read back by lottie-web: 39 to 61 dB on shapes, remaining differences due to text); SVG of a frame (50 to 59 dB); Lottie import (round trip validated).
6. **Projects and deployment.** `tramme-project/1` format and `.tramme` archive (tests, pack/unpack round trip); Worker tried locally (`wrangler dev`): creation, validated writes, partial reads, streamed `.tramme` export read back by the CLI; in Chrome: home screen, copy of an example, opening, save read back after reload, Lottie and GIF exports; assistant through the local companion (rendered frame, proposal, apply); server path covered by tests on a simulated stream.
7. **Drawn animation.** `sequence` node (exposure sheet, hold, loops, forced drawing; tested), exported to Lottie (one precomposition per sequence, read back by lottie-web: 52 to 53 dB on shots without effects) and to SVG; example anime "Evening Breeze" (28 drawings with a boiling line, 9 s at 24 fps).
8. **Video and speech.** `video` and `captions` nodes; exact frame at cuts (compared with ffmpeg); transcription by the Worker and by the companion (timed words); multipart upload (Worker test); in Chrome: project from a video, transcription in 12 s for 17 s of speech, dressing by the assistant (Sonnet 5.5, 20 s: two silences cut, captions, keyword), MP4 export with the edit's sound.

## Known limits

- Layer rendering has a single backend, Canvas2D; the compositor and shaders use WebGL2. A WebGL or WebGPU layer backend remains to be written.
- Without a layer effect, a group's opacity applies to each child; with an effect, the group is composited as one block.
- Expressions are isolated to stay deterministic; this is not a security sandbox. Importing a project that carries plugins or expressions asks first, and lists what it would run: they execute with the editor's rights, so only accept projects from someone you trust.
- Lottie: a single weight per text, no finishing effects, no motion blur, no nodes drawn by code. SVG: the same, as a still image.
- Browser export: no ProRes (the CLI does it); GIF is computed frame by frame, slow at large sizes.
- A single user, no accounts: access is controlled by Cloudflare Access. Files of 95 MB at most (the Workers request limit), except sounds and videos uploaded in parts (4 GiB).
- Video: the browser must be able to decode the codec (H.264, VP9, AV1 depending on the case; no ProRes). No crossfade between takes; automatic reframing on the subject (the biggest person, from a subjects analysis) happens in shorts only, not in the editor.
- Drawn animation: no brush in the editor yet (drawings come from a drawing app), and no bone or mesh deformation. Each loaded drawing takes its own memory: prefer drawings at the size you need.

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). For a security issue, follow [SECURITY.md](SECURITY.md) rather than opening a public issue. Changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## License

[Functional Source License 1.1, ALv2 Future License](LICENSE) (FSL-1.1-ALv2) © 2026 Aziz Chanou, from the version after 0.16.0. The source is available: you can use it, modify it and redistribute it for any purpose except offering a competing commercial product or service, and each version becomes Apache 2.0 two years after it is released. Versions up to 0.16.0 stay under the [Apache License 2.0](LICENSE-APACHE). Dependencies keep their own licenses: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
