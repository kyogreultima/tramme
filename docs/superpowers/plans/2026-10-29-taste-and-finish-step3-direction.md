# Taste and finish, step 3: direction, kinds of picture and style frames — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before building, the assistant writes a film plan: the few kinds of picture the film alternates, assigned to scenes so no form repeats scene after scene, and one to three directions written precisely. An image model draws a style frame for each; one is kept as the film's target. Its palette becomes the tokens, its type is matched in the catalogue, its plates and objects are made again without words. The check says when the scenes as built all look alike.

**Architecture:** One record, `assets/film-plan.json` (the film plan), written by a `film-plan` tool and read into the system prompt next to the brief. A pure `planIssues` judges the plan's variety. A pure heuristic `formOf` reads what a scene composition is built of, and the `check` tool reports consecutive scenes of one form. A `style-frames` tool draws the frames through the same provider path, gate and held takes as `generate-image`, both moved into shared helpers of `images.ts`. Keeping a frame writes it under `assets/frames/` (a file with its record, never a document asset), sets the palette tokens through the colour extraction of the `palette` tool, and makes the frame usable as a `reference` of `generate-image` and as a `compare` cell of the `typefaces` sheet. The guide gets a `Direction:` paragraph; the Studio's direction panel shows the plan and the kept frame.

**Tech Stack:** TypeScript (Node 24 type stripping, vitest, happy-dom for UI tests), `apps/editor`, `@tramme/assistant`, `@tramme/core`.

**Spec:** [docs/superpowers/specs/2026-10-29-taste-and-finish-design.md](../specs/2026-10-29-taste-and-finish-design.md), section "3. Direction: kinds of picture, then style frames". Steps 1 and 2 are built ([step 1](2026-10-29-taste-and-finish-step1-make-what-exists-work.md), [step 2](2026-10-29-taste-and-finish-step2-typefaces.md)). Step 5 brings the measured comparison of a render with its style frame; step 7 adds the scenes' state to the same film plan file. This plan only creates the record and its first fields.

## Global Constraints

- One mechanism for the assistant and the user: every capability is a tool of the vocabulary (`use_tool` and the `/` menu); the document changes only through returned operations.
- Taste, not templates (the user's standing rule): kinds of picture are kinds, never layouts or shot formats. No code path picks a composition, a palette or a typeface for the assistant. The same brief twice must be able to give two films.
- Everything made is a file of the project with its record (`docs/generation-roadmap.md`). A style frame is a target, never placed in the film: it is not a document asset and never an image layer.
- Paid generations keep today's gate and per-turn allowance (`payFor` in `apps/editor/src/confirm.ts`, `paidPerTurn`); each frame counts as one generation.
- Every lever that costs is a setting with a default: the number of style frames (`styleFrames`, 0 turns them off). The default (2) is a starting value, revisited from the bench.
- No text drawn into a picture that ships: words visible in a style frame are retyped as text layers. The plates and objects made from it are asked without words.
- New user-visible strings go through `t()` (English key in `apps/editor/src/i18n/en.json`, French in `fr.json`; `apps/editor/test/i18n.test.ts` fails otherwise). French addresses the user as "vous". No em dash in user-visible text. UI text names actions by their `/` menu titles, never a tool's internal name.
- Any UI added uses the theme tokens only, with no eyebrow labels, step numbers or connector dashes (user's standing rules).
- Shared modules, no copies: audit your own diff for duplication before handing over (user's standing rule).
- Nothing is tuned on one video: `bench/briefs.json` test briefs stay unseen; dev runs use the trial server on port 8790 with a repo-local state, never the user's dev server on 8787. A run that spends the user's quota waits for their go.
- Commits carry no Claude attribution; one commit per task. Use the Edit or Write tool for any code holding a backslash (shell edits lose them here).

## Review Focus

- A film of one or two scenes, or a talking video dressed with three illustrations: `planIssues` asks for no more kinds than the scene count allows, and never blocks writing the plan.
- `style-frames` with `styleFrames` set to 0, with no image provider connected, or with the allowance used up in a turn left alone: a clear text saying to build from the direction's words, nothing written, no plan change.
- A kept frame whose colours are all close (a grey frame): the palette tokens still give an ink that reads on the plate (the `palette` tool's `inkSafe` rule holds).
- `keep` named twice, or a take id from an earlier session: the second answers that nothing is held, and the plan keeps the first frame.
- `generate-image` with `reference: 'assets/frames/x.jpg'` for a frame file that is missing: an error naming the path. An asset id or `frame` behaves exactly as before.
- A user's example: when the plan marks it, the example's kind is limited to a third of the scenes, and the guide says so.

---

### Task 1: The film plan record and its variety

**Files:**
- Create: `apps/editor/src/filmplan.ts`
- Modify: `apps/editor/src/vocabulary.ts` (register `...FILM_PLAN_TOOLS` next to `...BRIEF_TOOLS`)
- Test: `apps/editor/test/filmplan.test.ts`

**Interfaces:**
- Produces:
  - `FILM_PLAN_PATH = 'assets/film-plan.json'`
  - `PICTURE_KINDS: readonly PictureKind[]` and `KIND_LINE: Record<PictureKind, string>` (one line each, read by the model): `interface` (a product's screen up close, built in layers), `type` (kinetic type, a title or a figure set large), `object` (an object or an illustration standing for a noun of the script), `data` (a chart, a counter, a table), `diagram` (a balance, a flow, a comparison, a price line), `photo` (a photo or footage on screen), `3d` (a solid or a model), `character` (a person or a mascot drawn or made), `map` (a place, a route)
  - `interface Direction { name: string; type: string; palette: string; light: string; materials: string; framing: string }`
  - `interface PlanScene { id: string; name: string; kind: PictureKind; idea: string; hero?: boolean; comp?: string; seconds?: number }`
  - `interface StyleFrame { path: string; direction: string; scene: string; provider: string; model: string }`
  - `interface FilmPlan { version: 1; kind: 'film-plan'; updated: string; idea: string; kinds: PictureKind[]; scenes: PlanScene[]; directions: Direction[]; example?: { kind: PictureKind; what: string }; frames?: StyleFrame[]; target?: string }` (`target` is the path of the kept frame)
  - `parsePlan(raw: string | null | undefined): FilmPlan | null`
  - `planIssues(plan: Pick<FilmPlan, 'kinds' | 'scenes' | 'example'>): string[]`
  - `planText(plan: FilmPlan): string` (the plan as the model reads it in the system prompt: the idea, the kinds, one line per scene `name: kind, idea`, the kept direction in full, the target's path; at most 2 500 characters, the scenes' ideas clipped first)
  - `planOp(doc: TrammeDoc): Op` (the record `film-plan` as a `json` asset, added or replaced, like `briefOp`)
  - tool `film-plan` with input `{ idea: string; kinds: PictureKind[]; scenes: Omit<PlanScene, 'id'>[]; directions: Direction[]; example?: { kind: PictureKind; what: string } }`
- [ ] **Step 1: Write the failing tests** in `apps/editor/test/filmplan.test.ts`:
  - `planIssues` of five scenes `interface, interface, type, data, object` holds one line naming the first two scenes and `interface`.
  - Six scenes over two kinds, alternating: one line asking for at least 3 kinds. Four scenes of which three are `type`: one line saying a kind covers more than half the scenes.
  - Two scenes of two kinds: none. One scene: none.
  - A scene whose kind is not in `kinds`: one line. `kinds` of one entry or of six: one line each (2 to 5).
  - With `example: { kind: 'interface', what: 'the essaie animation' }` and four of nine scenes `interface`: one line saying the example is one kind among the others, at most 3 scenes here (`ceil(9 / 3)`).
  - The tool, with a recording `writeFile` (as `ctxOf` in `apps/editor/test/recipes.test.ts`), writes `assets/film-plan.json` and returns one `add` operation at `/assets/film-plan`. Scene ids are `slug(name)` made unique (`slug` from `apps/editor/src/model.ts`). The text lists the issues under `To fix:` when there are some.
  - Calling it again keeps `frames` and `target` from the file (as the brief keeps its `KEPT` fields) and returns a `replace` operation.
  - `planText` of a plan with 40 scenes stays under 2 500 characters and names every scene.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/filmplan.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `filmplan.ts`.** The rules of `planIssues`, with `n` the scene count:
  - no two consecutive scenes of one kind;
  - at least `min(3, n - 1)` distinct kinds when `n >= 3`;
  - no kind on more than `ceil(n / 2)` scenes when `n >= 4`;
  - the example's kind on at most `ceil(n / 3)` scenes;
  - 2 to 5 entries in `kinds`, every scene's kind among them;
  - 1 to 3 directions, each of its five fields at least 12 characters long.

  The plan is written even with issues: the text puts them under `To fix:`, and Task 2 brings them back in the check. Write the tool's `ai.when` in the file's voice: before building a film or dressing a video, after reading the sources and the brief; again when the user changes the story. Write its `ai.avoid`: one kind for every scene; a kind used as a layout.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(direction): the film plan, its kinds of picture and their variety`

### Task 2: The form each scene is built in, in the check

**Files:**
- Create: `apps/editor/src/forms.ts`
- Modify: `apps/editor/src/review.ts` (the `check` tool appends `formLines` to its text, after the grouped issues)
- Test: `apps/editor/test/forms.test.ts`

**Interfaces:**
- Consumes: `PictureKind`, `parsePlan`, `planIssues`, `FILM_PLAN_PATH` (Task 1); `scenesOf` from `apps/editor/src/scenes.ts`.
- Produces: `formOf(doc: TrammeDoc, compId: string): { kind: PictureKind | null; why: string }`; `formLines(doc: TrammeDoc, compId: string, plan: FilmPlan | null): string[]`.
- [ ] **Step 1: Write the failing tests** on small documents built in the test:
  - a scene composition holding a `ui.device` layer is `interface` with `why` naming it;
  - one holding `chart.bar` is `data`;
  - one holding only text layers and a full-frame rectangle, the largest text at least 8 % of the frame's height, is `type`;
  - an image or video layer covering at least half the frame is `photo`;
  - an image layer under half the frame is `object`;
  - a `model.3d` or `solid.3d` is `3d`;
  - a `map.*` layer is `map`;
  - an empty composition is `null`.
  - Nested groups and compositions are read two levels deep. The kind with the largest frame area wins when several are present.
  - `formLines` of a film of four scene compositions whose forms are `interface, interface, interface, type` gives one line naming the first three scenes by name and `interface (ui.device)`, and pointing at the film plan.
  - With a plan declaring the second scene `object`, it adds one line saying that scene is planned as `object` but built as `interface`.
  - With a plan holding issues, it repeats them. A single scene gives no line.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/forms.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `formOf` (the area of each layer from its evaluated bounds at the scene's middle, `Evaluator` from `@tramme/core`; `ui.*` types count as `interface`, `chart.*` and the counters as `data`, `diagram.*` as `diagram`) and `formLines`. Then in `review.ts` read the plan with `ctx.readText(FILM_PLAN_PATH)` and add the lines as notes, which the check's existing cap does not count.
- [ ] **Step 4: Run** `npx vitest run apps/editor/test/forms.test.ts apps/editor/test/review.test.ts`. Expected: PASS (the existing check tests unchanged).
- [ ] **Step 5: Commit** `feat(check): scenes built in one form after another, and a scene built off its plan`

### Task 3: Shared takes, frame files as references, the palette of a picture

**Files:**
- Modify: `apps/editor/src/images.ts`, `apps/editor/src/perception.ts`
- Test: `apps/editor/test/images.test.ts`, `apps/editor/test/perception.test.ts`

Today the takes, the paid gate and the provider call live inside `generate-image`'s `run`, and the colour extraction inside `palette`'s `run`. The style frames need both.

**Interfaces:**
- Produces, in `images.ts`:
  - `drawTakes(ctx: ToolContext, ask: ImageAsk, paid: { what: string; instead: string }): Promise<MadeImage[]>` (the `payFor` with `ask.n` counted, then `api.generateImages`)
  - `holdTakes(made: MadeImage[], extra: Record<string, unknown>): string` (returns the id `takes-…`)
  - `takeHeld(id: string): { made: MadeImage[]; extra: Record<string, unknown> } | null` (`id` is `takes-…:n` or `takes-…`; once kept, the takes are let go)
  - `takeSheet(made: MadeImage[], size?: number): Promise<string[]>`
  - `bitmapOf` accepts a project path under `assets/frames/`, read with `ctx.fileUrl`.
- Produces, in `perception.ts`: `paletteOf(g: CanvasRenderingContext2D, w: number, h: number): { colours: { rgb: [number, number, number]; share: number }[]; plate: string; ink: string; accent: string }` and `paletteOps(p: ReturnType<typeof paletteOf>, from: string): Op[]` (today's token operations, `from` in each `pictureN` description).
- [ ] **Step 1: Write the failing tests**:
  - `generate-image` with `reference: 'assets/frames/a.jpg'` reads that file through `fileUrl` (a stub `fetch` sees the url) and records `reference: 'assets/frames/a.jpg'`. With a missing frame file it throws an error naming the path.
  - `holdTakes` then `takeHeld('<id>:2')` gives the second take, and a second `takeHeld` of the same id gives null.
  - `paletteOf` over a canvas painted half `#101820` and half `#F2AA4C` gives plate `#101820` and accent `#F2AA4C`. Over a canvas of two close greys the ink is `#FFFFFF` or `#111111`.
  - Every existing test of `images.test.ts` and `perception.test.ts` passes unchanged.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/images.test.ts apps/editor/test/perception.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Extract** the helpers; `generate-image` and `palette` call them, with the same texts and the same records.
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(images): takes, the paid gate and the palette of a picture shared`

### Task 4: The style frames

**Files:**
- Create: `apps/editor/src/styleframes.ts`
- Modify: `apps/editor/src/vocabulary.ts`, `apps/editor/src/settings.ts` (`styleFrames: 0 | 2 | 3`, default 2, validated like `pictureSize`), `apps/editor/src/ui/Settings.tsx` (a `Seg` row under the pictures rows: Off, 2, 3), `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/styleframes.test.ts`

**Interfaces:**
- Consumes: `drawTakes`, `holdTakes`, `takeHeld`, `takeSheet`, `ratioOf` (Task 3); `paletteOf`, `paletteOps` (Task 3); `parsePlan`, `planOp`, `FILM_PLAN_PATH` (Task 1); `chooseAmong`, `alone` (`confirm.ts`).
- Produces:
  - `framePrompt(plan: FilmPlan, d: Direction, scene: PlanScene, format: { width: number; height: number }): string`. It describes a finished frame of a motion design film at the composition's proportions: the scene's idea, then the five fields of the direction labelled `Type`, `Palette`, `Light`, `Materials`, `Framing`, then the line `A frame from a finished, art-directed film: every element designed, nothing generic.`
  - tool `style-frames` with input `{ scene?: string; count?: 1 | 2 | 3; over?: 'frame'; keep?: string; provider?: string }`. `scene` is a plan scene id, by default the hero, else the first scene. `over: 'frame'` uses a still of the video at the scene's time as the reference: the dressing case.
- [ ] **Step 1: Write the failing tests** (stub `api.generateImages` as `images.test.ts` does):
  - With a plan of two directions and `styleFrames` 2: one generation per direction, two in all, each prompt holding its direction's five fields.
  - With one direction and `count: 3`: three takes of it.
  - With `styleFrames: 0`: no generation, and the text says the frames are off in the settings and to build from the direction.
  - With no plan file: the text asks for `film-plan` first.
  - When nobody is there to choose (`alone()`): the frames are held, the text gives `keep: "<id>:<n>"` and names each frame's direction, and nothing is written.
  - `keep` then writes `assets/frames/<plan-scene>-<direction-slug>.jpg` and its record `.json` (`{ prompt, provider, model, direction, scene }`). It updates the plan file (`frames` gets the entry, `target` the path, `directions` puts the kept one first) and returns the plan's operation plus the palette's token operations. Its text says what comes next, in order: retype the frame's words as text layers; match its lettering (`typefaces` with `compare: <path>`); make its plates and objects again without words (`generate-image` with `reference: <path>`, a `change` that removes every word and interface element, `remove-bg` for an object); rebuild the scene in layers to match; animate.
  - No operation of the result adds an image asset or an image layer.
  - With the user present, `chooseAmong` is called with one choice per frame, and the picked frame is kept the same way.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/styleframes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `framePrompt` and the tool.
  - `ai.when`: after `film-plan`, before building the first scene; for a dressing, `over: 'frame'` on the scene of an illustration.
  - `ai.avoid`: placing the frame in the film; drawing frames again to fix a detail (the frame is a target, the scene is fixed in layers).
  - Paid line: `paid: { what: t('styleFrames.paidText', …), instead: 'build from the direction\'s words' }`.
- [ ] **Step 4: Run** the tests and `npx vitest run apps/editor/test/i18n.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(direction): style frames drawn from the directions, one kept as the film's target`

### Task 5: The target beside the specimens

**Files:**
- Modify: `apps/editor/src/typefaces/specimen.ts`, `apps/editor/src/typefaces/tools.ts`
- Test: `apps/editor/test/typefaces.test.ts`

**Interfaces:**
- Produces: `specimenPlan(fonts, opts: { text?: string; width?: number; target?: boolean })`. With `target`, the first cell is `{ id: 'target', label: 'target' }`, drawn with the picture, and the fonts fill the next cells, five at most. `typefaces` input gains `compare?: string`, an image asset or a frame path; its picture is drawn in that cell, scaled to cover.
- [ ] **Step 1: Write the failing tests**: `specimenPlan(threeFonts, { target: true })` has four cells, the first with id `target`. Seven fonts with a target give six cells. Without `target` the plan is unchanged.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/typefaces.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it: `specimenSheet` takes the picture's bitmap (`bitmapOf` of Task 3), and the tool's text adds the line `The first cell is the target: pick the family whose lettering is closest to it (width, weight, contrast, the shape of a, g, R).`
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(typefaces): the style frame beside the specimens it is matched against`

### Task 6: The plan in the prompt, and the guide

**Files:**
- Modify: `packages/assistant/src/index.ts` (`systemParts` and `systemPrompt` gain a fifth parameter `plan?: string`, in the variable part after the brief; `INSTRUCTIONS` gets a `Direction:` paragraph before `Whole films:`, and the `Sources:` paragraph's "propose two or three directions" names the style frames), `packages/assistant/test/fixtures/system-before.txt`, `apps/editor/src/ai/index.ts` (`ask()` reads `FILM_PLAN_PATH` beside the brief and passes `planText`)
- Test: `packages/assistant/test/system.test.ts` (the wiring in `ask()` is checked by the typecheck and the dev run of Task 8)

- [ ] **Step 1: Write the failing tests**:
  - `systemParts(REF, undefined, [], [], 'PLAN TEXT').variable` holds `The film plan of the project (assets/film-plan.json)` and `PLAN TEXT`, and `.fixed` is unchanged by it (the cache keeps it).
  - `.fixed` holds, between `Direction:` and `Whole films:`, the words `film-plan`, `kinds of picture`, `style-frames`, `target`, `never placed`, `retyped`.
- [ ] **Step 2: Run** `npx vitest run packages/assistant`. Expected: FAIL.
- [ ] **Step 3: Write the paragraph** `Direction:` in the file's voice, five bullets:
  - A film or a dressing starts from a plan (use_tool "film-plan"): its idea, the few kinds of picture it alternates (named in the tool) and each scene with its kind and its idea. No kind twice in a row, none on more than half the scenes. These are kinds, not layouts: each scene's composition is decided when it is built.
  - An example the user gives (an animation, a video to match) is one kind among the others, never the form of the whole film; mark it as the example.
  - Write one to three directions precisely: the type, the palette, the light, the materials, the framing. Make them different from each other, and from what you would do by default. Have them drawn (use_tool "style-frames"); the user picks when they are there, you keep the strongest when they are not.
  - The kept frame is the film's target. Its palette is set as the tokens when it is kept. Its lettering is matched in the catalogue (typefaces with compare). Its plates, textures and objects are made again without words (generate-image with the frame as reference, remove-bg for an object). Each scene is then built in layers to match it and animated. The frame is never placed in the film: its words are retyped as text layers.
  - Two runs of one brief start from two different directions. The check says when scenes as built repeat one form: change the kind, not the colours.
- [ ] **Step 4: Update the fixture** with the same paragraph and the `Sources:` change; wire `ask()`. Run `npx vitest run packages/assistant` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): direct before building: the film plan, the kinds of picture, the style frames`

### Task 7: The direction panel shows the plan and the target

**Files:**
- Modify: `apps/editor/src/ui/Direction.tsx` (a section above the brief: the kept frame, the idea, the scenes each with its kind; a button that puts `t('studio.direction.otherFramesWords')` in the direction bar through `prefill`), `apps/editor/src/studio.ts` (`DIRECTING` gains `film-plan` and `style-frames`), `apps/editor/src/screens/studio.css` (theme tokens only), `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/studio-direction.test.ts` (new: `stageOf`, and a happy-dom render of `Direction` in the way `apps/editor/test/queue-ui.test.ts` renders its component)

- [ ] **Step 1: Write the failing tests**: `stageOf` of a `use_tool` item with `use: 'style-frames'` is `direct`. `Direction` rendered with a stubbed `api.readText` that returns a plan with a target shows an `img` whose `src` is the target's file url, the plan's idea, and one line per scene holding its name and its kind's label (the kinds' labels translated: `studio.kinds.<kind>`, nine keys). Without a plan the section is absent.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** it. The plan is read when the assistant is done, as the brief is. The scenes are a plain list of name and kind, with no numbering and no connector. Write the French keys addressing the user as "vous".
- [ ] **Step 4: Run** the tests and `npx vitest run apps/editor/test/i18n.test.ts`. Expected: PASS. Open the trial server (port 8790) and check the panel in light and dark.
- [ ] **Step 5: Commit** `feat(studio): the film plan and its target in the direction panel`

### Task 8: Docs, a dev run, whole-branch check

**Files:**
- Modify: `docs/document.md` (a section "Film plan and style frames": the file, its fields, the tools, where frames land), `docs/taste-finish-roadmap.md` (tick step 3's boxes, link this plan), `CHANGELOG.md`

- [ ] **Step 1: Document** the file and the tools; tick the roadmap; add the changelog lines.
- [ ] **Step 2: Verify** `npm run typecheck`, `npm test`, `node scripts/packs/index.ts --check`. Expected: all pass.
- [ ] **Step 3: Audit the diff for duplication.** Look for a second take holder, a second palette extraction, a second plan reader beside `parsePlan`, and kind labels repeated between the guide, the tool and the panel (the tool's text reads `KIND_LINE`). Fix what you find.
- [ ] **Step 4: One dev run with the user's go** (it spends their quota), on the trial server: the dev dressing brief of bilal and one dev launch brief, twice each. Note in the PR:
  - the kinds each plan chose, and whether the check found a repeated form;
  - the directions written and the frame kept;
  - whether the two runs of one brief kept different frames;
  - the cost from `node bench/usage.ts --compare`.
- [ ] **Step 5: Commit** `docs: film plan and style frames, the roadmap and the changelog`
