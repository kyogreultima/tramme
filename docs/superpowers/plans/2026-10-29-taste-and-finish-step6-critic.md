# Taste and finish, step 6: the critic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate review, run in a fresh context by the strongest model with eyes on the route. It is given the style frame, the direction and strips of the film in motion around every transition and entrance, and judges them against a grid calibrated on marketing's level of finish. It answers "done", or "not yet" with the three things that matter most. A definition of done is enforced by measure, so "done" cannot be said while a scene lacks material, sound is missing or text is unreadable. A scene that fails twice gets two or three takes, and the best is kept. The number of rounds is a setting.

**Architecture:**
- **A fresh call:** `consult` makes one request with no tools and no history, on whichever route the turn runs. On the server and chat routes it is a new `ServerSession` with tools off. On the companion it is a turn with no session and no MCP server.
- **The `critique` tool:**
  - gathers the evidence in the editor (`evidence.ts`: moments, strips, the target, the plan);
  - runs the measured definition of done (`done.ts`, pure, over the document and the plan);
  - sends the grid and the evidence to `consult`, and parses a strict JSON verdict;
  - merges the verdict with the measured issues, so the verdict is "not yet" while any remain;
  - counts its rounds and each scene's failures within the turn.
- **Takes of a scene:** a `scene-takes` tool copies a scene composition into takes for the assistant to rebuild differently. `critique { takes }` compares them in one call, and `scene-takes { keep }` swaps the kept one in and removes the others.
- **Cost:** each consult's usage is added to the turn's usage line, counted apart, so the bench sees what the critic costs.

**Tech Stack:** TypeScript (Node 24, vitest), `apps/editor` (the turn engine `apps/editor/src/ai/`), `@tramme/assistant`, `@tramme/cli` (the companion `packages/cli/src/agents.ts`), `bench/usage.ts`.

**Spec:** [docs/superpowers/specs/2026-10-29-taste-and-finish-design.md](../specs/2026-10-29-taste-and-finish-design.md), section "6. The critic". It builds on:
- step 1: the coverage check and the grouped check report;
- step 3: the film plan `assets/film-plan.json`, its `target` and `formLines`;
- step 5: `likeness` and the `compare` tool.

Decided here, from the spec's "Left to the builder":
- **Input:** the critic sees strips on every route. No route sends video today, and strips are what every provider with eyes takes. A video input for a provider that takes one is left for when the bench shows strips miss motion faults.
- **Model:** the critic's model is Opus 5.5 on the companion's Claude engine and on the server. On every other route it is the turn's own model.
- **Takes:** takes of a scene are compositions, not Studio proposals. A proposal holds a whole document, so three of them cannot be compared side by side in one call.

## Global Constraints

- One mechanism: the critic is a tool of the vocabulary (`use_tool` and the `/` menu, title "Review the film"). The takes are a tool too. The document changes only through returned operations.
- Bounded: `criticRounds` (setting, 0 to 4, default 2; 0 turns the critic off) counts the consults of one turn. Past it, the tool answers without calling a model. The default is revisited from the bench (Task 8), never raised to make a run pass.
- The critic judges the level of finish, never resemblance to one look: its grid says so, and it is never shown marketing's frames, only the grid in words (spec, anti-goals).
- A warning is never argued with: the measured definition of done cannot be overruled by the model's verdict.
- Cost is measured: every consult's tokens are in the turn's usage, and `bench/usage.ts` prints them apart.
- New user-visible strings go through `t()` (en and fr, French in "vous"); no em dash in user-visible text; UI text names `/` menu titles.
- Shared modules, no copies. Reuse `stills`, `sheetOf` and `keyTimes` (`apps/editor/src/review.ts`), `runChecks` and `groupIssues` (`@tramme/core`), `scenesOf` (`apps/editor/src/scenes.ts`), `parsePlan` and `formLines` (step 3), `likeness` (step 5). Audit your diff for duplication before handing over.
- Nothing tuned on one video: the grid is written from the spec's list, not from a dev film's faults. The test briefs stay unseen. Dev runs on the trial server (port 8790); a quota-spending run waits for the user's go.
- Commits carry no Claude attribution; one commit per task. Use Edit or Write for code holding backslashes.

## Review Focus

- A route whose model has no eyes (a local text model): `critique` says the critic needs a model that sees pictures and runs only the measured definition of done. No consult is made.
- The consult fails (overloaded, a session limit, the companion cut): the tool reports the error and counts no round. The turn goes on, and nothing is lost.
- The critic answers prose instead of JSON, or JSON with more than three fixes: the parser keeps the first three, and "done" in prose without JSON counts as "not yet" with the text quoted.
- A film of one composition with no scene markers: one scene, the whole film, still judged. A talking video: the moments are its illustrations' entrances and the coverage gaps, not every caption word.
- `scene-takes { keep }` on a take that a root layer does not show, or after the user removed a take: an error naming it, nothing removed.
- The user stops the turn during a consult: the consult is aborted with the turn's signal and no usage is lost.

---

### Task 1: A call in a fresh context

**Files:**
- Create: `apps/editor/src/ai/consult.ts`
- Modify:
  - `apps/editor/src/ai/server.ts` (`TurnOptions.tools?: boolean`; when false the request sends no `tools` and `turn` ends after the first answer);
  - `apps/editor/src/ai/companion.ts` (the request gains `tools?: boolean`);
  - `packages/cli/src/agents.ts` (`TurnRequest.tools?: boolean`; when false: `runClaude` passes no MCP server, `maxTurns: 1`, and no `resume`; `runCodex` and `runAntigravity` get no MCP address);
  - `apps/editor/src/api.ts` (`TurnUsage.consults?: Usage & { n: number }`);
  - `bench/usage.ts` (the consults' tokens priced inside the turn and printed apart).
- Test: `apps/editor/test/server-session.test.ts`, `packages/cli/test/agents.test.ts`, `apps/editor/test/consult.test.ts`, `bench/cost.test.ts`

**Interfaces:**
- Produces:
  - `consult(req: { system: string; text: string; images: { mediaType: string; data: string }[]; model?: string; effort?: Effort; signal: AbortSignal }): Promise<{ text: string; usage: Usage }>`. It routes by `aiRoute`, never touches `session` (the conversation's history) or `runner`, and throws with the route's message on failure.
  - `criticModel(route: Route, turnModel: string): string`: `claude-opus-5-5` for `companion` with the Claude engine and for `server`; `turnModel` otherwise.
  - `seesPictures(model: string): boolean`: false for `local:` models unless their name says vision (`llava`, `vision`, `vl`), true otherwise.
  - `addConsult(usage: TurnUsage, u: Usage): TurnUsage`
- [ ] **Step 1: Write the failing tests**:
  - `ServerSession.turn` with `tools: false` posts a body without `tools` and stops after one answer, even when the stub answers with a tool use (which becomes an error event).
  - `runClaude` with `tools: false` is called with no `mcpServers.tramme` and `maxTurns: 1` (stub `query` as `agents.test.ts` does).
  - `consult` on the server route returns the stub's text and usage, and leaves `session.server.messages` as it was.
  - `criticModel('server', 'claude-sonnet-5-5')` is `claude-opus-5-5`; `criticModel('remote', 'openai:gpt-5')` is `openai:gpt-5`.
  - `seesPictures('local:llama3.1:8b')` is false and `seesPictures('local:llava:13b')` is true.
  - `bench/usage.ts` prices a turn with consults at the sum of both and prints a `critic` column.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/server-session.test.ts packages/cli/test/agents.test.ts apps/editor/test/consult.test.ts bench/cost.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): a request in a fresh context, without tools, on every route`

### Task 2: The evidence

**Files:**
- Create: `apps/editor/src/critic/evidence.ts`
- Test: `apps/editor/test/critic.test.ts`

**Interfaces:**
- Consumes: `scenesOf`, `stills`, `sheetOf`, `parsePlan`, `FILM_PLAN_PATH`, `planText`.
- Produces:
  - `momentsOf(doc: TrammeDoc, compId: string, registry: Registry): { t: number; why: string; scene: string }[]`. These are:
    - every boundary between two scenes, centred, with why `cut from <a> to <b>`;
    - the first entrance in each scene of a visible layer covering at least 5 % of the frame (`<layer> enters`);
    - every marker of kind `hero`;
    - in a talking video, every illustration's entrance and the middle of every coverage gap the check reports.

    They are sorted, merged when closer than 0.4 s, and capped at 12, scene boundaries kept first.
  - `gather(ctx: ToolContext, compId: string): Promise<{ strips: { url: string; caption: string }[]; target: string | null; plan: string | null; facts: string }>`:
    - each moment is a strip of 4 frames over 0.6 s centred on it (one `sheetOf` row, 320 px cells);
    - the strips are put 3 to a picture, 4 pictures at most;
    - `target` is the plan's target as a data url;
    - `facts` holds the format, the duration, the scene list with times and kinds, and the sound layers' count.
- [ ] **Step 1: Write the failing tests**:
  - `momentsOf` of a film of three scene compositions over 9 s gives two cuts at the boundaries plus each scene's first big entrance.
  - Fifteen candidates are capped at 12 with both cuts kept.
  - Two moments 0.2 s apart are merged.
  - A hero marker is kept.
  - A composition with no layer gives no moment except its scene boundaries.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/critic.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(critic): the film in motion around every cut and entrance, with its target and plan`

### Task 3: The definition of done, measured

**Files:**
- Create: `apps/editor/src/critic/done.ts`
- Test: `apps/editor/test/critic.test.ts`

**Interfaces:**
- Produces: `doneIssues(doc: TrammeDoc, compId: string, registry: Registry, plan: FilmPlan | null, issues: QualityIssue[]): { id: string; scene?: string; line: string }[]`. `issues` is what `runChecks` gave. The ids and their rules:
  - `material`: a scene with no visual layer other than text and flat-filled shapes. Images, videos, shaders, models, solids, charts, pack nodes and their components count.
  - `hierarchy`: the film's texts hold fewer than two sizes in a ratio of at least 1.6, or a scene with three texts or more has one size only.
  - `coverage`: the check's coverage warnings (over 20 s).
  - `hero`: no plan scene marked `hero` and no marker of kind `hero`. Markers take any `kind`; a hero cue is computed by the sound tools and is not stored, so it does not count.
  - `ending`: the last scene lasts under 1.5 s or holds no text and no logo or image.
  - `transitions`: two consecutive scenes with neither a transition (montage transition, `fx.transition`) nor an animated overlap, nor a cut within 0.05 s of a beat when the project has beats.
  - `sound`: no audio layer, or a sound check's warning.
  - `provisional`: a text matching `/lorem|ipsum|placeholder|todo|tbd|xxx|\[[^\]]*\]/i`, an image or video layer with no asset, or a layer named `placeholder`.
  - `readable`: the small-text and text-time check's warnings.
- [ ] **Step 1: Write the failing tests**, one small document per rule that breaks it alone and one that passes all. Also:
  - a talking video with a 24 s bare stretch gives `coverage`;
  - a single-scene film gives no `transitions`;
  - a scene of an image and a title gives no `material` issue;
  - a text `Prix : [à venir]` gives `provisional`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(critic): what done means, measured before any opinion`

### Task 4: The grid and the verdict

**Files:**
- Modify: `packages/assistant/src/index.ts` (exports `CRITIC_SYSTEM` and `parseVerdict`)
- Test: `packages/assistant/test/critic.test.ts`

**Interfaces:**
- Produces:
  - `CRITIC_SYSTEM: string`, the critic's instructions. Its first line: "You review a motion design film made by another assistant. You have not seen it being made." It holds:
    - the grid of the level of finish asked, in words, from the spec's list: one idea per shot and many shots; the subject shown up close; light as a material; restrained type; continuity between shots; palette discipline; density, real-looking detail, no empty placeholder; an ending; plus motion craft: eased moves, staggered entrances, nothing static for long;
    - "Judge the level of finish, never the look: a film in any style, palette or genre can reach it; never ask for a look you prefer, and never reward resemblance to any one style";
    - when a target frame is given, the film reaches its level of finish, not its content;
    - the answer as strict JSON: `{ "verdict": "done" | "not yet", "score": 1-10, "fixes": [{ "scene": "<name>", "what": "<the change, concrete>", "why": "<what it gains>" }] }`, at most three fixes, the most important first, no fix about a matter of taste the brief leaves open.
  - `parseVerdict(text: string): { verdict: 'done' | 'not yet'; score: number | null; fixes: { scene?: string; what: string; why: string }[]; raw?: string }`
- [ ] **Step 1: Write the failing tests**:
  - `parseVerdict` of the JSON inside a fenced block gives its fields.
  - Five fixes are cut to three.
  - A score of 12 is clamped to 10.
  - Prose with no JSON gives `not yet`, `score: null`, no fixes and `raw` holding the prose.
  - `{"verdict":"done","fixes":[{...}]}` with fixes is `not yet` (a done verdict has no fix).
  - `CRITIC_SYSTEM` holds `never the look` and `at most three`.
- [ ] **Step 2: Run** `npx vitest run packages/assistant/test/critic.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): the critic's grid, calibrated on a level of finish, and its verdict`

### Task 5: The critique tool

**Files:**
- Create: `apps/editor/src/critic/tool.ts` (exports `CRITIC_TOOLS`)
- Modify:
  - `apps/editor/src/vocabulary.ts`;
  - `apps/editor/src/settings.ts` (`criticRounds: number`, 0 to 4, default 2);
  - `apps/editor/src/ui/Settings.tsx` (a `Level` row in the assistant's section);
  - `apps/editor/src/ai/index.ts` (the turn's critic state reset at the start of `ask()`, the consults' usage added to the usage item);
  - `apps/editor/src/studio.ts` (`REVIEWING` gains `critique`);
  - `apps/editor/src/i18n/en.json`, `fr.json`.
- Test: `apps/editor/test/critic.test.ts`

**Interfaces:**
- Consumes: `consult`, `criticModel`, `seesPictures` (Task 1); `gather` (Task 2); `doneIssues` (Task 3); `CRITIC_SYSTEM`, `parseVerdict` (Task 4); `likeness` (step 5).
- Produces:
  - `criticTurn: { rounds: number; failures: Map<string, number>; usage: Usage[] }` (module state, `resetCritic()` called by `ask()`)
  - tool `critique` with input `{ compId?: string; takes?: string[] }`. Its text is, in order:
    1. the measured issues (`doneIssues`), each with what to do;
    2. the verdict: `done` only when there is no measured issue and the critic said done, else `not yet`;
    3. the score, and up to three fixes with their scene, what and why;
    4. the likeness with the target, when there is one (score and words, one line);
    5. the rounds left.

    A scene named in fixes for the second time in the turn adds the line `<scene> failed twice: make two or three takes of it (use_tool "scene-takes") rather than fixing it again`. Past `criticRounds`, there is no consult and the text says to finish and raise what is left in the summary.
- [ ] **Step 1: Write the failing tests**, `consult` stubbed:
  - with no measured issue and a stub answering done: `done`;
  - with a measured `sound` issue and the stub answering done: `not yet`, the sound line first;
  - the stub named the scene `Price` in two calls: the second text holds `Price failed twice`;
  - with `criticRounds: 1`, the second call makes no consult and says the rounds are used;
  - with `criticRounds: 0`: no consult, only the measured issues;
  - with a local model without eyes: no consult and the line saying why;
  - a consult that throws: the error in the text and the round not counted;
  - the usage of two consults appears in the turn's usage item as `consults.n: 2`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** it. The consult's text is `facts` and the plan, then `Moments:` with each strip's caption. The images are the target first, labelled, then the strips.
  - `ai.when`: when the film or the dressing is built, before the summary; again after fixing what it said.
  - `ai.avoid`: calling it after every change, and arguing with its measured issues.
- [ ] **Step 4: Run** the tests and `npx vitest run apps/editor/test/i18n.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(critic): a review in a fresh context that says done or the three things that matter`

### Task 6: Takes of a scene

**Files:**
- Modify: `apps/editor/src/critic/tool.ts` (tool `scene-takes`; `critique { takes }`), `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/critic.test.ts`

**Interfaces:**
- Produces: tool `scene-takes` with input `{ scene: string; make?: 2 | 3; keep?: string }`.
  - `make` copies the scene's composition into `<comp>~take2` (and `~take3`). The copies use the document's components and copy operations, not a hand-written deep copy. The text says each take must be built differently: another kind of picture or another composition, not the same scene in other colours. The root keeps showing the original.
  - `keep: '<comp id>'` points the root's comp layer at the kept composition and removes the other takes and, when a take is kept, the original. It is an error when the id is not a take of that scene.
  - `critique { takes: [ids] }` consults once with each take's strip side by side. Its verdict names the best take and why; it counts as one round.
- [ ] **Step 1: Write the failing tests**:
  - `make: 2` on scene `price` adds `price~take2` with the same layers under fresh ids, and the root still plays `price`.
  - `keep: 'price~take2'` makes the root's layer source `price~take2` and removes `price`. Validated afterwards, the document has no dangling reference.
  - `keep: 'other'` is an error.
  - `critique { takes: ['price', 'price~take2'] }` sends one consult with two labelled strips.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(critic): takes of a scene that failed twice, compared and one kept`

### Task 7: The guide

**Files:**
- Modify: `packages/assistant/src/index.ts` (`INSTRUCTIONS`: the `Finish:` paragraph gains the critic; the first rule's "run the check tool" stays for single changes), `packages/assistant/test/fixtures/system-before.txt`
- Test: `packages/assistant/test/system.test.ts`

- [ ] **Step 1: Write the failing test**: `.fixed` holds in `Finish:` the words `critique`, `three things`, `scene-takes`, `rounds`.
- [ ] **Step 2: Run** `npx vitest run packages/assistant`. Expected: FAIL.
- [ ] **Step 3: Write** three bullets in `Finish:`:
  - A film or a dressing is reviewed by a critic who did not make it (use_tool "critique"), once it is built. Fix the three things it names, then ask again; what it measures is never argued with.
  - A scene it names twice is made again as two or three takes built differently (use_tool "scene-takes"). The critic compares them, and you keep the best.
  - When its rounds are used, stop polishing: say in the summary what the critic still asks for.
- [ ] **Step 4: Update the fixture.** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): a film is finished when the critic says so, or the summary says why not`

### Task 8: Docs, the default from the bench, whole-branch check

**Files:**
- Modify: `docs/document.md` (the critic and the takes), `bench/README.md` (the critic column; how to compare rounds), `docs/taste-finish-roadmap.md` (tick step 6, link this plan), `CHANGELOG.md`

- [ ] **Step 1: Document and tick.**
- [ ] **Step 2: Verify** `npm run typecheck`, `npm test`. Expected: all pass.
- [ ] **Step 3: Audit the diff for duplication.** Look for a second strip builder beside `stills`/`sheetOf`, the definition of done re-deriving what a check already reports (it reads `issues`), and a second usage adder. Fix what you find.
- [ ] **Step 4: With the user's go**, on the trial server, run two dev briefs (one launch, the bilal dressing) at `criticRounds` 0, 1 and 2. Compare cost and the user's blind scores (`node bench/usage.ts --compare`). Write the numbers in the PR and propose the default; the user sets it.
- [ ] **Step 5: Commit** `docs: the critic, the bench's critic column, the roadmap and the changelog`
