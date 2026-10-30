# Taste and finish, step 4: material — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scene gets the material it needs, with no asset given:
- objects and illustrations made as transparent assets in the film's style;
- textures and light drawn by the engine, free and deterministic;
- CC0 textures, environment maps, models, and licensed photos and clips, found with a contact sheet and kept with their credits;
- real logos and pictures of real people or products only with the user's yes, listed in the summary when nobody is there.

**Architecture:**
- **Objects:** `generate-image` gains an `object` mode. It asks for a single subject on a flat ground, then cuts it out with the matte of `remove-bg`, moved into a shared `cutoutBlob`.
- **Textures and light:** a `surface` tool lays a `shader` layer from a set of GLSL presets, its colours linked to the palette tokens.
- **Free libraries:** a `stock` tool searches Poly Haven, ambientCG, Openverse images and Pexels (photos and clips, through a server-held key). It answers with a contact sheet and keeps the chosen file under `assets/stock/` with a record holding the licence. Poly Haven models are packed to `.glb` for `model.3d`.
- **Credits:** the `credits` tool covers every asset whose record carries a licence, not only the sounds.
- **Real logos and pictures:** a gated `real` kind of `stock` asks the user. In a turn left alone it records the want, and the turn's end lists it like the harvest note.

**Tech Stack:** TypeScript (Node 24, vitest), `apps/editor`, `packages/api` (Worker routes and keyed providers), `@tramme/nodes` (`shader`, `model.3d`), GLSL ES 3.0.

**Spec:** [docs/superpowers/specs/2026-10-29-taste-and-finish-design.md](../specs/2026-10-29-taste-and-finish-design.md), section "4. Material". It builds on step 3 ([plan](2026-10-29-taste-and-finish-step3-direction.md)): objects are made "in the film's style", from the kept style frame when there is one (`assets/film-plan.json`, `target`).

## Global Constraints

- One mechanism: every capability is a tool of the vocabulary (`use_tool` and the `/` menu); the document changes only through returned operations.
- Rendering stays a pure function of time: surfaces are shaders of `uTime` and the layer's props, with no random state and no `Date`.
- Everything made or fetched is a file of the project with its record: provider, id, author, licence, landing page, the url fetched. The project stays self-contained once fetched.
- Rights: only what may be used, shown and changed. CC0 and public domain (Poly Haven, ambientCG, Openverse `cc0`, `pdm`), CC BY with the credit kept (Openverse `by`), the Pexels licence. Not CC BY-SA, ND or NC. Unsplash is left out: its API terms ask for hotlinked images and a download ping, which a self-contained project cannot keep. Real brands' logos and pictures of real people or products go through the user's yes (`askUser` in `apps/editor/src/confirm.ts`). A turn left alone never fetches them.
- Paid generations keep the gate and the per-turn allowance (`payFor`). The free libraries are not paid and not gated, but each search is one network call. The contact sheet shows at most 8 entries.
- Text is never drawn into a picture that ships: `object` mode and the surfaces carry no words.
- New user-visible strings go through `t()` (en and fr, French in "vous"); no em dash in user-visible text; UI text names `/` menu titles.
- Shared modules, no copies. Reuse:
  - `sheetOf` (`apps/editor/src/review.ts`) for contact sheets;
  - `keepMedia`/`placeMedia` (`apps/editor/src/media.ts`) for kept files;
  - the Openverse call of `sound-find` for images (one helper for both);
  - `slug` (`apps/editor/src/model.ts`) for file names.

  Audit your diff for duplication before handing over.
- Nothing tuned on one video; the test briefs stay unseen; dev runs on the trial server (port 8790), a quota-spending run waits for the user's go.
- Commits carry no Claude attribution; one commit per task. Use Edit or Write for code holding backslashes (GLSL included).

## Review Focus

- A library that does not answer (offline, HTTP 429 or 5xx, Pexels without a key): `stock` says which library failed and still shows the others' results. With none left, it names what to try instead (`generate-image`, a surface), never an empty sheet.
- A search with no result in the licences allowed: the text says the licence filter left nothing. A CC BY-SA or NC result never appears, even when the library returns one.
- `stock` used twice on the same id: one file, one asset, no second copy (the record's `source` + `id` decide).
- `object` mode on a provider that returns a picture with a busy ground: the matte still runs. When the kept area is under 3 % or over 92 % of the picture, the text says the cutout looks wrong and to make it again, and the asset is kept so the user can judge.
- A surface on a 9:16 or 1:1 composition: the layer covers the frame. The presets read `uSize` and never assume 16:9.
- `credits` on a project with sounds only: the same lines as today, in the same order. With no credited asset, the same "nothing to credit" answer.

---

### Task 1: Objects on a transparent ground

**Files:**
- Modify: `apps/editor/src/removebg.ts` (extract `cutoutBlob`), `apps/editor/src/images.ts` (`object` input; prompt suffix; cutout after the take is kept), `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/images.test.ts`, `apps/editor/test/cutout.test.ts`

**Interfaces:**
- Produces:
  - `cutoutBlob(blob: Blob, subject: 'any' | 'person', progress?: (n: number, of: number, what: string) => void): Promise<{ blob: Blob; kept: number }>` in `removebg.ts`. `kept` is the share of opaque pixels, 0 to 1. `remove-bg` calls it with the same result as today.
  - `generate-image` input gains `object?: boolean`. It adds to the prompt `A single object, whole and centred, on a plain flat ground of one colour, soft even light, nothing else in the frame, no text, no shadow on the ground.` and the kept take is cut out with `cutoutBlob`. The asset is a transparent PNG whose record has `object: true, kept`. It is placed with `fit: 'contain'`, never as the background, at 60 % of the composition's shorter side by default. When `film-plan.json` has a `target`, the default `reference` is that frame and the prompt says `in the style of the reference picture: its rendering, light and palette, not its content`.
- [ ] **Step 1: Write the failing tests**, with `matting` stubbed as `cutout.test.ts` stubs models:
  - `cutoutBlob` of a 10×10 picture whose stub matte keeps the 4 centre pixels returns `kept: 0.04`.
  - `generate-image { prompt: 'a ceramic bowl of ramen', object: true }` sends a prompt ending with the object suffix and keeps a `.png` with `object: true` in its record. Its layer has `fit: 'contain'` and is not in the background.
  - With a plan holding a target, the ask carries a `reference` read from the target's path. With `object: true` and `background: true`, an error says an object is never a background.
  - A matte keeping 1 % gives a text saying the cutout looks wrong.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/images.test.ts apps/editor/test/cutout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it, and rewrite `generate-image`'s `ai.when` to name objects. Add: an object or an illustration a noun of the script stands for (a dish, a house with its price, a phone), made with `object` and placed whole; one object per idea.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(images): objects made on a transparent ground, in the style of the film's target`

### Task 2: Surfaces: textures and light drawn by the engine

**Files:**
- Create: `apps/editor/src/surfaces.ts` (exports `SURFACES` and `SURFACE_TOOLS`)
- Modify: `apps/editor/src/vocabulary.ts`, `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/surfaces.test.ts`

**Interfaces:**
- Produces:
  - `type SurfaceKind = 'grain' | 'paper' | 'halftone' | 'gradient' | 'glow' | 'ribbons' | 'grid' | 'bokeh' | 'caustics'`
  - `SURFACES: Record<SurfaceKind, { code: string; blend: 'normal' | 'add' | 'screen' | 'multiply' | 'overlay'; under: boolean; params: [number, number, number, number]; line: string }>`. `code` defines `vec4 shade(vec2 uv)` reading `uTime`, `uSize`, `uColorA`, `uColorB`, `uParams`; `under` is true for a plate under the content, false for a pass over it.
  - tool `surface` with input `{ kind: SurfaceKind; colors?: [string, string]; amount?: number; speed?: number; at?: number; duration?: number; name?: string }`:
    - it adds a `shader` layer covering the composition (`size` = its width and height, centred);
    - `colorA`/`colorB` are `@plate`/`@accent` when the tokens exist, else the given colours, else the presets' own;
    - `p1` is `amount`, `p2` is `speed`;
    - the layer is placed at the bottom of the root order when `under`, at the top otherwise, with the preset's blend.
- [ ] **Step 1: Write the failing tests**:
  - Every preset's `code` holds `vec4 shade(vec2 uv)` and uses no uniform outside `uTime, uSize, uColorA, uColorB, uParams`.
  - No preset uses `Date`, `random(` or `gl_FragCoord` (the node's `uv` is the input).
  - Every preset reads `uSize` when it draws a pattern in pixels (grain, halftone, grid, paper).
  - `surface { kind: 'glow' }` on a 1080×1920 document with tokens `plate` and `accent` proposes one `shader` layer of size `[1080, 1920]` at the centre, `colorA: '@plate'`, `colorB: '@accent'`, blend `add`, last in the order. `kind: 'paper'` is first in the order with blend `normal`.
  - Applied, `validate` reports nothing.
  - The tool's text gives one line per kind (`line`) when `kind` is missing and proposes no operation.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/surfaces.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the presets.**
  - `grain`: per-pixel hash noise animated by `floor(uTime * 24.0)`, its amount `p1` (0.02 to 0.12), so it reads on a 1080 frame.
  - `paper`: fibres from two octaves of value noise plus a faint tooth, in `colorA`, still.
  - `halftone`: a dot screen at 45° whose dot size follows a slow gradient from `colorA` to `colorB`, cell from `p3` (default 9 px).
  - `gradient`: a mesh of four soft blobs drifting on slow Lissajous paths between the two colours.
  - `glow`: two or three soft lights in `colorB` drifting slowly over transparency (the orange glows on black of the human cut of bilal are the kind, not the target).
  - `ribbons`: three thin light bands bent by sine fields, travelling, in `colorB` over transparency.
  - `grid`: a perspective floor grid fading to the horizon, its lines in `colorB` at low opacity.
  - `bokeh`: out-of-focus discs of varied size and depth drifting up.
  - `caustics`: the light of water on a floor.

  Each preset gets the `line` of when it fits. Then implement the tool.
- [ ] **Step 4: Run** the tests. Expected: PASS. Then, in a throwaway script in the scratchpad, write a document with one composition per kind and render a still of each with `node packages/cli/src/main.ts still <doc> --t 0.5,2 --comp <id> --out <scratchpad dir>`. Check each PNG by eye, and check by script that its luma varies (standard deviation above 2). A preset that compiles to an error or draws flat is fixed here.
- [ ] **Step 5: Commit** `feat(surfaces): grain, paper, halftone, gradients, glows, light ribbons, grids, bokeh and caustics drawn by the engine`

### Task 3: A Pexels key, held by the server

**Files:**
- Modify: `packages/api/src/keyed-providers.json` (`"pexels": { "origin": "https://api.pexels.com" }`), `packages/api/src/providers.ts` (a route `stock` to `PROVIDER_ROUTES`, answering `GET /api/stock/pexels/<photos|videos>?query=…&per_page=…` with the user's key in the `Authorization` header), `apps/editor/src/ui/Providers.tsx` (Pexels among the keys, its hint saying it finds photos and clips under the Pexels licence), `apps/editor/src/api.ts` (`api.stockPexels(kind, query, count, signal)`), `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `packages/api/test/stock.test.ts`

- [ ] **Step 1: Write the failing tests** (the style of `packages/api/test/images.test.ts`, a stub `fetch`):
  - `GET /api/stock/pexels/photos?query=bowl&per_page=8` with a key calls `https://api.pexels.com/v1/search?query=bowl&per_page=8` with `Authorization: <key>`.
  - `videos` calls `https://api.pexels.com/videos/search`.
  - Without a key, a 401 whose message says to connect Pexels in the settings.
  - A `kind` other than `photos` or `videos` gives a 404.
- [ ] **Step 2: Run** `npx vitest run packages/api/test/stock.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route and the client.
- [ ] **Step 4: Run** the tests and `npx vitest run apps/editor/test/i18n.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): a Pexels key held by the server, for photos and clips`

### Task 4: The free libraries

**Files:**
- Create: `apps/editor/src/stock.ts` (the libraries, the search, the keep, `STOCK_TOOLS`), `apps/editor/src/glb.ts` (`packGlb`)
- Modify: `apps/editor/src/sound.ts` (its Openverse call through the shared `openverse` helper), `apps/editor/src/vocabulary.ts`, `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/stock.test.ts`

**Interfaces:**
- Produces:
  - `type StockKind = 'photo' | 'clip' | 'texture' | 'hdri' | 'model'`
  - `interface StockHit { id: string; source: 'polyhaven' | 'ambientcg' | 'openverse' | 'pexels'; kind: StockKind; title: string; thumb: string; author: string; license: 'CC0' | 'PDM' | 'CC BY' | 'Pexels'; landing: string; files: { url: string; type: string; role?: 'color' | 'normal' | 'roughness' | 'model' | 'buffer' | 'env' }[]; size?: [number, number]; seconds?: number }`
  - `openverse(kind: 'audio' | 'images', params: Record<string, string>, signal: AbortSignal): Promise<unknown[]>`
  - `searchStock(kind: StockKind, query: string, count: number, signal: AbortSignal): Promise<{ hits: StockHit[]; failed: string[] }>`
  - `allowedLicense(raw: string): StockHit['license'] | null`
  - `packGlb(gltf: object, buffers: Record<string, ArrayBuffer>): ArrayBuffer` (one `.glb` from a glTF and the buffers it names; images left out, materials kept as base colours, which is what `model.3d` draws)
  - tool `stock` with input `{ kind: StockKind; query?: string; count?: number; use?: string; at?: number; background?: boolean; name?: string }`
- [ ] **Step 1: Write the failing tests** with a stub `fetch` answering recorded JSON (save the fixtures under `apps/editor/test/fixtures/stock/`, trimmed to three results each, read from the real APIs once while writing the test):
  - `searchStock('texture', 'concrete', 6)` asks `https://api.polyhaven.com/assets?type=textures&categories=…` and `https://ambientcg.com/api/v2/full_json?type=Material&q=concrete&limit=…`. Every hit has a licence. A hit's files hold its colour map.
  - `searchStock('photo', 'ramen bowl', 8)` asks Openverse with `license=cc0,pdm,by` and Pexels through `api.stockPexels`. Results under `by-sa` or `by-nc` from a stub that returns them are dropped (`allowedLicense` gives null).
  - When Pexels answers 401, `failed` holds `pexels` and the Openverse hits still come back.
  - `kind: 'hdri'` keeps the Poly Haven tonemapped JPG as the `env` file. `kind: 'model'` keeps the glTF and its `.bin`.
  - The tool without `use` returns a text with one line per hit (id, title, author, licence, size or length) and one contact-sheet image, and proposes no operation.
  - With `use: '<id>'`:
    - it writes the file under `assets/stock/<slug>.<ext>` and a record `assets/stock/<slug>.json` (`{ source, id, title, author, license, landing, url }`);
    - an image is placed with `placeMedia`, a clip as a video asset and layer;
    - an `hdri` becomes an image asset not placed, whose record has `env: true`;
    - a `model` becomes a `.glb` model asset and a `model.3d` layer.
  - The same `use` again adds nothing.
  - `packGlb` of a two-buffer glTF gives a buffer starting with `glTF`, version 2, its JSON chunk naming one buffer.
  - The sound tool `sound-find` still asks `https://api.openverse.org/v1/audio/` with the same parameters.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/stock.test.ts apps/editor/test/sound.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the libraries, ranked by source for each kind:
  - textures: Poly Haven, then ambientCG;
  - hdri and model: Poly Haven;
  - photo: Pexels, then Openverse;
  - clip: Pexels.

  Searches run in parallel, each with an 8 s timeout. The contact sheet is `sheetOf` of the thumbnails, labelled by id. Write the `ai.when`: a texture, an environment for a 3D object, a photo or a clip the film needs that the project lacks; search before generating. Write the `ai.avoid`: a photo of a real brand's product or a real person (that is the real kind, Task 5), and stock where a made object fits the style better.
- [ ] **Step 4: Run** the tests. Expected: PASS. Then by hand, from the trial server, run one real search of each kind and keep one of each.
- [ ] **Step 5: Commit** `feat(stock): CC0 textures, environments and models, licensed photos and clips, with a contact sheet and their records`

### Task 5: Real logos and pictures, with the user's yes

**Files:**
- Modify: `apps/editor/src/stock.ts` (kind `real`: a logo, a person, a product, searched on Wikimedia Commons), `apps/editor/src/ai/answers.ts` (`realNote`), `apps/editor/src/ai/index.ts` (cleared at the turn's start, emitted after the harvest note), `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/stock.test.ts`, `apps/editor/test/assistant-tools.test.ts` (beside the `harvestNote` tests)

**Interfaces:**
- Produces:
  - `StockKind` gains `'real'`, and the `stock` input `what?: string` (the brand, person or product, as the user would name it)
  - `realWanted: Set<string>` (exported from `stock.ts`, cleared by `ask()` like `runner.wrotePlugins`)
  - `realNote(wanted: string[]): string` (empty for none)
- [ ] **Step 1: Write the failing tests**:
  - `stock { kind: 'real', what: 'the Revolut logo' }` with the user present calls `askUser` with a text naming `the Revolut logo`. On yes it searches `https://commons.wikimedia.org/w/api.php` (`action=query&generator=search&gsrnamespace=6&prop=imageinfo&iiprop=url|extmetadata`) and keeps the file, recording its licence and that the user said yes.
  - On no it fetches nothing, and the text says to set the name in the film's type instead.
  - In a turn left alone, nothing is fetched, `realWanted` holds `the Revolut logo`, and the text says that a wordmark set in the film's type stands for a logo and a picture made for the film stands for a real one.
  - `realNote(['the Revolut logo', 'a photo of Mbappé'])` names both, in the user's language through `t()`. `realNote([])` is `''`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(stock): real logos and pictures only with the user's yes, listed when nobody is there`

### Task 6: Credits for everything fetched

**Files:**
- Modify: `apps/editor/src/sound.ts` (the `credits` tool reads the sound side files as today, then every asset of the document whose record holds `license`, and writes `assets/CREDITS.md`, sounds first. Its title becomes `Credits`; its `/` menu entry and its description say pictures, clips, textures and models too), `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/sound.test.ts`

- [ ] **Step 1: Write the failing tests**:
  - On a document with two sounds only, the lines are today's, in the same order. The file is `assets/CREDITS.md`, and `assets/sounds/CREDITS.md` is still written for projects that link it.
  - With a stock photo and a Poly Haven model, a `## Pictures, clips and models` section lists each as `name: title, author, licence <landing>`.
  - An asset made by a provider says so (`made by openai (gpt-image-2)`).
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/sound.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(credits): every fetched or made file credited beside the video`

### Task 7: The guide

**Files:**
- Modify: `packages/assistant/src/index.ts` (`INSTRUCTIONS`: a `Material:` paragraph after `Pictures:`, and `Pictures:` loses what moves there), `packages/assistant/test/fixtures/system-before.txt`
- Test: `packages/assistant/test/system.test.ts`

- [ ] **Step 1: Write the failing test**: `.fixed` holds, between `Material:` and `Clips:`, the words `object`, `surface`, `stock`, `credits`, `wordmark`, `the user's yes`.
- [ ] **Step 2: Run** `npx vitest run packages/assistant`. Expected: FAIL.
- [ ] **Step 3: Write the paragraph** `Material:` in the file's voice, five bullets:
  - A frame is made of material, not of flat shapes: every scene has something real-looking to look at.
  - When a noun of the script is something the viewer should see (a dish, a house and its price, a banknote, a phone), make it as an object (generate-image with object, in the target's style) and place it whole. One object per idea; an abstract word gets type or a diagram, not a picture.
  - Light and texture come from the engine first, free: a surface under the content (paper, a gradient, a grid) and one over it (grain, a glow, ribbons), in the palette's colours. No frame is a flat plate.
  - A photo, a clip, a texture, an environment or a model the film needs: search the free libraries (stock) before generating, and look at the sheet. What comes from a library is credited (credits before the export).
  - A real brand's logo, a real person or a real product is fetched only with the user's yes. Alone, set the name in the film's type as a wordmark and make a picture for the film, and the end of the turn lists what you would fetch.
- [ ] **Step 4: Update the fixture.** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): material in every frame: objects, surfaces, libraries, credits`

### Task 8: Docs, a dev run, whole-branch check

**Files:**
- Modify: `docs/document.md` (sections "Surfaces" and "Stock": the kinds, the libraries, the licences kept, the records), `docs/generation-roadmap.md` (objects), `docs/taste-finish-roadmap.md` (tick step 4, link this plan), `CHANGELOG.md`

- [ ] **Step 1: Document and tick.**
- [ ] **Step 2: Verify** `npm run typecheck`, `npm test`, `node scripts/packs/index.ts --check`. Expected: all pass.
- [ ] **Step 3: Audit the diff for duplication.** Look for a second Openverse client, a second contact sheet, a second record writer beside `keepMedia`, and licence strings spelled in two places. Fix what you find.
- [ ] **Step 4: One dev run with the user's go**, on the trial server: the dev dressing brief of bilal and one dev launch brief. Note in the PR:
  - how many objects, surfaces and stock files each film used;
  - whether any scene stayed a flat plate;
  - whether the summary listed real logos it would fetch;
  - the cost compared with step 3's run.
- [ ] **Step 5: Commit** `docs: material, the roadmap and the changelog`
