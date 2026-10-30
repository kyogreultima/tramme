# Taste and finish, step 7: scene by scene — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A long film is finished without the context or the quota running out, and each scene costs about the same. The director's turn:
1. writes the direction, the kept style frame and the scene list to the project (the brief and the film plan);
2. lays the root (one composition per scene, its timing, the music);
3. stops.

Each scene is then built in its own fresh context, which inherits only the brief, the plan and the document. Its changes are kept to its own composition. A last turn in the director's context assembles: transitions, sound, the critic, the summary. The user sees one conversation, with each scene's stages in the Studio's notes.

**Architecture:**
- **The plan:** `assets/film-plan.json` (step 3) gains each scene's `status`, `comp` and `brief`.
- **Running the scenes:** a pure planner (`scenePrompt`, `todoScenes`) and an orchestrator `runScenes` take a function that runs one fresh turn, so they can be tested without a route. `ask()` calls them after the director's attempt loop when the plan holds scenes still to build. Each scene turn uses the same `systemParts`: its fixed part is cached, so a scene pays only for its own work. It runs with no history (a new `ServerSession`, or a companion turn with no session) through the same `ToolRunner`, which is given a scope that keeps proposals to the scene's composition.
- **The conversation:** each scene's items carry the scene's name, its usage is its own line, and the Studio's thread shows a heading per scene.

**Tech Stack:** TypeScript (Node 24, vitest, happy-dom), `apps/editor` (`apps/editor/src/ai/`, `apps/editor/src/studio.ts`, `apps/editor/src/ui/thread.tsx`), `@tramme/assistant`, `bench/usage.ts`.

**Spec:** [docs/superpowers/specs/2026-10-29-taste-and-finish-design.md](../specs/2026-10-29-taste-and-finish-design.md), section "7. Scene by scene". It builds on step 3 (the film plan: `FilmPlan`, `PlanScene`, `parsePlan`, `planText`, the `film-plan` tool) and step 6 (`consult`'s fresh contexts on every route; `critique` used by the assembly turn).

Decided here, from the spec's "Left to the builder":
- **Order:** scenes run one after another, not in parallel. A user on a subscription has one quota, and parallel turns would only reach its limit sooner.
- **Fresh context:** on the server and chat routes, a new `ServerSession`. On the companion, a turn with no `sessionId`, whose session id is not kept as the conversation's.
- **Scope:** the scope is the scene's composition and its takes.

## Global Constraints

- One mechanism: the scene builder works with the same tools as the director, through the same runner. The document changes only through `propose_changes`, and a scene's proposal adds to the same pending proposal: the user decides once, or the turn applies it when the assistant works alone.
- A scene builder never changes another scene's composition, the root's order, or a token another scene uses. It may add assets, files and tokens of its own. The runner refuses the rest with a text saying why.
- Cost: the fixed part of the system prompt is the same text in every scene turn, so the cache covers it. What a scene turn adds to the variable part is the brief, the plan and its scene's brief only. Every scene turn ends with its own usage line, carrying the scene's name.
- Bounded:
  - `scenesApart` (setting: `auto` or `off`, default `auto`): on `auto`, scenes are built apart when the plan has at least 3 scenes to build.
  - Each scene turn keeps the turn engine's own step cap (`MAX_STEPS`, 40 in `apps/editor/src/ai/server.ts`; the companion's engines keep theirs).
  - A scene that fails once is marked `failed` and the next one starts; the assembly turn is told.
- The user can stop at any time: the turn's signal stops the scene running and those after it, and what is built is kept.
- New user-visible strings go through `t()` (en and fr, French in "vous"); no em dash in user-visible text; the thread's scene heading is the scene's name alone, with no number, eyebrow or connector (user's standing rules).
- Shared modules, no copies. Reuse:
  - `systemParts` and `joinSystem` (`@tramme/assistant`);
  - `ServerSession` and `companionTurn` (the turn engine);
  - `consult`'s route choice (step 6), with one shared function for "a fresh turn on this route";
  - `parsePlan` and `planText` (step 3).

  Audit your diff for duplication before handing over.
- Nothing tuned on one video; the test briefs stay unseen; dev runs on the trial server (port 8790), a quota-spending run waits for the user's go.
- Commits carry no Claude attribution; one commit per task. Use Edit or Write for code holding backslashes.

## Review Focus

- A scene builder that proposes an operation on another composition, on `/compositions/<root>/order` or on an existing token: refused in that call with the reason, while its other operations of the same call are not applied either (one call, one validation, as today).
- The user rejects the pending proposal while scenes are being built: the run stops, and the next message starts from the document as it is. The plan's statuses say which scenes were built, so asking again builds only those left.
- A plan whose scenes have no `comp`, or name a composition that does not exist: those scenes are not run, and the assembly turn is told which and why.
- A turn in which the director did not write or change the plan: no scene run, whatever the plan says (an old plan does not start a run on an unrelated message).
- Two films' worth of scenes (24 scenes): the cost per scene stays flat. The bench's per-scene lines show it, and no scene turn's prompt grows with the scenes before it.
- A scene turn cut by a passing error (an overloaded server): it resumes with the same resume note and waits as the director's turn does, at most the same number of times.

---

### Task 1: Scenes with a state, a composition and a brief

**Files:**
- Modify: `apps/editor/src/filmplan.ts` (`PlanScene` gains `status?: 'todo' | 'built' | 'failed'`, `brief?: string`, and `comp` becomes the composition the scene is built in; tool `scene-done`; `planText` shows each scene's status), `apps/editor/src/vocabulary.ts`, `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/filmplan.test.ts`

**Interfaces:**
- Produces:
  - `todoScenes(plan: FilmPlan, doc: TrammeDoc): { run: PlanScene[]; skipped: { scene: PlanScene; why: string }[] }`. `run` holds the scenes whose status is `todo` or absent and whose `comp` exists in `doc`. `skipped` holds the others, with why: no composition, or already built.
  - `setStatus(plan: FilmPlan, id: string, status: PlanScene['status']): FilmPlan`
  - tool `scene-done` with input `{ scene: string; note?: string }`. It marks the scene `built` in the plan file and returns the plan's operation. Its text says the scene is done and the builder should stop.
  - `film-plan` input scenes gain `brief`: what the builder of that scene needs beyond the plan (the words, names and figures it shows, the sources it uses, its length and where it sits in the root).
- [ ] **Step 1: Write the failing tests**:
  - `todoScenes` of a plan with scenes `todo` with an existing comp, `built`, and `todo` naming a missing comp gives one `run` and two `skipped` with their reasons.
  - `scene-done { scene: 'price' }` writes the plan with `price` built and returns the plan's `replace` operation. An unknown scene is an error naming the plan's scene ids.
  - `planText` shows `built` beside a built scene.
  - A `film-plan` call that keeps a scene's name keeps its status (scenes matched by id).
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/filmplan.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(direction): each scene of the plan with its composition, its brief and its state`

### Task 2: A scope for a scene builder

**Files:**
- Modify: `apps/editor/src/ai/tools.ts` (`ToolRunner.scope: { comp: string; root: string; tokens: string[] } | null`; `propose` checks every operation against it before validating)
- Test: `apps/editor/test/scope.test.ts` (new; a runner built as `apps/editor/test/assistant-tools.test.ts` builds one)

**Interfaces:**
- Produces: `outOfScope(op: Op, scope: NonNullable<ToolRunner['scope']>, doc: TrammeDoc): string | null`, a pure function returning the reason or null. The allowed paths:
  - `/compositions/<comp>` and `/compositions/<comp>~take*`, with everything under them;
  - `add` under `/assets/` and `/tokens/` for an id the document does not have;
  - `/markers` of the scene's own composition.

  Refused:
  - any other `/compositions/<id>`, the root's `order` and layers included;
  - `replace` or `remove` of a token or an asset that existed before the scene turn;
  - `/root`, `/plugins` (the plugins are added by the tools that need them, through an `add` to `/plugins/-`, allowed).
- [ ] **Step 1: Write the failing tests** for `outOfScope`:
  - `add /compositions/price/layers/title`: allowed.
  - `replace /compositions/main/order`: refused, naming `main`.
  - `add /tokens/accent2` when absent: allowed. `replace /tokens/accent`: refused.
  - `add /compositions/price~take2`: allowed. `remove /assets/brief`: refused.
  - `add /plugins/-`: allowed.
  - A runner with a scope refuses a `propose_changes` holding one refused operation among three, applies none, and answers with the reason. A runner without a scope behaves as today.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests and `npx vitest run apps/editor/test/assistant-tools.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): a scene builder keeps to its scene`

### Task 3: One fresh turn on any route, shared

**Files:**
- Modify: `apps/editor/src/ai/consult.ts` (step 6: its route choice moves into `freshTurn`, and `consult` becomes `freshTurn` with tools off, read to its text), `apps/editor/src/ai/index.ts` (`freshTurn` exported for `runScenes`)
- Test: `apps/editor/test/consult.test.ts`

**Interfaces:**
- Produces: `freshTurn(o: { prompt: string; system: SystemParts; tools: boolean; images?: { mediaType: string; data: string }[]; model: string; effort?: Effort; signal: AbortSignal }): AsyncGenerator<AiEvent>`. On the server and chat routes it uses a new `ServerSession`; on the companion, `companionTurn` without `sessionId` and with an `onSession` that keeps nothing. It uses the same `runner` as the conversation.
- [ ] **Step 1: Write the failing tests**: `freshTurn` on the server route with `tools: true` posts the tool specs and no earlier message, even when `session.server.messages` holds a conversation. On the companion route it sends no `sessionId` and `session.companion` is unchanged after it. `consult`'s tests (step 6) pass unchanged.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/consult.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(assistant): one fresh turn on any route, for the critic and the scenes`

### Task 4: Running the scenes

**Files:**
- Create: `apps/editor/src/ai/scenes-run.ts`
- Modify: `apps/editor/src/ai/index.ts` (after the director's attempt loop: when `scenesApart` allows it and this turn wrote the plan, `runScenes`, then the assembly), `apps/editor/src/settings.ts` (`scenesApart: 'auto' | 'off'`, default `auto`), `apps/editor/src/ui/Settings.tsx` (a `Seg` row in the assistant's section), `apps/editor/src/api.ts` (`ChatItem.building?: string`, the scene an assistant item was made for; `TurnUsage.scene?: string`), `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/scenes-run.test.ts`

**Interfaces:**
- Consumes: `todoScenes`, `setStatus`, `planText` (Task 1); `ToolRunner.scope` (Task 2); `freshTurn` (Task 3).
- Produces:
  - `scenePrompt(plan: FilmPlan, scene: PlanScene, doc: TrammeDoc): string`. It says:
    - which scene to build and in which composition, its idea, its kind and its brief;
    - the names of the scenes before and after it (for continuity: what leaves the previous scene, what the next one starts with);
    - the target frame's path;
    - that the other scenes are built apart, so the builder must not touch them;
    - that the builder must end with `scene-done`, in one message, without a summary to the user.

    It holds no other scene's brief.
  - `runScenes(o: { plan: FilmPlan; doc: () => TrammeDoc; turn: (prompt: string, scene: PlanScene) => AsyncGenerator<AiEvent>; save: (plan: FilmPlan) => Promise<void>; signal: AbortSignal }): AsyncGenerator<AiEvent, { built: string[]; failed: { id: string; why: string }[]; skipped: { id: string; why: string }[] }>`. Each scene's events are passed on, with `building` set on their items; its usage item is passed on with `scene`. After each scene, the plan is saved with its status: `built` when the turn called `scene-done`, else `failed`.
  - `assemblyNote(r: Awaited<ReturnType<typeof runScenes>>): string`, the prompt of the director's last turn. It says which scenes were built, failed or skipped, then to assemble: the transitions between scenes, the sound, the film reviewed with `critique`, then the summary.
- [ ] **Step 1: Write the failing tests**, with `turn` stubbed as a generator that yields a text item, then a `use_tool scene-done` effect or not, then a usage item:
  - Three scenes run in order. Each item yielded carries `building` with its scene's name, and each usage item carries `scene`.
  - The saved plan marks two `built` and the one whose stub never called `scene-done` `failed`. The result lists them.
  - An aborted signal after the first scene stops the run, and the first stays built.
  - `scenePrompt` names the scene's composition, its brief and the neighbours' names, and holds none of the other scenes' briefs.
  - A plan of 24 scenes gives prompts whose lengths differ by under 20 % (none grows with the scenes before it).
  - `assemblyNote` names the failed scene and `critique`.
  - In `ask()` (with routes stubbed as `ask-usage.test.ts` does): a director turn that did not write the plan runs no scene. One that wrote a plan of three todo scenes runs three scene turns, then one assembly turn, and the conversation's session is the director's at the end. With `scenesApart: 'off'`, no scene turn runs.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/scenes-run.test.ts apps/editor/test/ask-usage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it. In `ask()`:
  - "this turn wrote the plan" is the plan file's `updated` being later than the turn's start;
  - each scene turn is `freshTurn` with tools on, the same `system`, and the runner's scope set to the scene's composition (cleared after it, also on error);
  - each scene turn resumes after a passing failure as the director's turn does, by moving the attempt-and-resume loop into one function both use;
  - the assembly turn goes on in the director's own session (`attempt(assemblyNote(r))`).
- [ ] **Step 4: Run** the tests and `npx vitest run apps/editor/test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): each scene built in a fresh context, then the film assembled`

### Task 5: The scenes in the Studio's notes

**Files:**
- Modify: `apps/editor/src/studio.ts` (`liveScene(work: ChatItem[]): string | null`, the scene being built now), `apps/editor/src/ui/thread.tsx` (a heading with the scene's name before the first item of each `building` run; the stages of each scene from `stagesOf` of its items), `apps/editor/src/ui/Notes.tsx` (the live line reads `t('studio.building', { scene })` while a scene runs), `apps/editor/src/screens/studio.css` (theme tokens only), `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/studio-direction.test.ts` (step 3's file)

- [ ] **Step 1: Write the failing tests**:
  - `liveScene` of work items whose last running one has `building: 'Price'` is `Price`, and null after the scene's usage item.
  - The thread rendered with items of two scenes shows two headings, each the scene's name alone, in order, and the stages of each under it.
  - Without `building`, the thread renders as today.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests and `npx vitest run apps/editor/test/i18n.test.ts`. Expected: PASS. On the trial server, check the thread in light and dark with a recorded conversation (a chat file of a dev run).
- [ ] **Step 5: Commit** `feat(studio): the stages of each scene in the notes`

### Task 6: The guide, and the bench's per-scene lines

**Files:**
- Modify: `packages/assistant/src/index.ts` (`INSTRUCTIONS`: `Whole films:` gains the scene-by-scene bullets), `packages/assistant/test/fixtures/system-before.txt`, `bench/usage.ts` (a turn's scene lines grouped under it: tokens and cost per scene, their spread), `bench/README.md`
- Test: `packages/assistant/test/system.test.ts`, `bench/cost.test.ts`

- [ ] **Step 1: Write the failing tests**:
  - `.fixed` holds in `Whole films:` the words `scene-done`, `built apart`, `brief of each scene`, `assemble`.
  - `bench/usage.ts` on a conversation with three scene usage lines prints them under their turn with the spread of their costs (largest over smallest).
- [ ] **Step 2: Run** `npx vitest run packages/assistant bench/cost.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write** three bullets in `Whole films:`:
  - A long film is directed, then built scene by scene. Write the plan with a brief for each scene (what it shows, its words and figures, its sources, its length), lay the root (a composition per scene in order, the music), and stop: the scenes are built apart, each in its own context.
  - Building a scene, you build that one alone, in its composition, to the plan and the target, with continuity with its neighbours. End with scene-done.
  - When the scenes are built, assemble: the transitions, the sound, the review, the summary.
- [ ] **Step 4: Update the fixture**; implement the bench lines. Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): direct, build apart, assemble; the bench prices each scene`

### Task 7: Docs, a long dev run, whole-branch check

**Files:**
- Modify: `docs/document.md` (the plan's scene fields, `scene-done`), `docs/taste-finish-roadmap.md` (tick step 7, link this plan), `CHANGELOG.md`

- [ ] **Step 1: Document and tick.**
- [ ] **Step 2: Verify** `npm run typecheck`, `npm test`. Expected: all pass.
- [ ] **Step 3: Audit the diff for duplication.** Look for a second attempt-and-resume loop, a second route choice beside `freshTurn`, a second plan writer, and the scene name passed by two fields. Fix what you find.
- [ ] **Step 4: With the user's go**, on the trial server, run one dev brief asking for a 60 s film (8 scenes or more) with `scenesApart` on and off. Note in the PR:
  - whether each run finished every scene;
  - the cost per scene and its spread;
  - the total against the run without scenes apart;
  - the time.
- [ ] **Step 5: Commit** `docs: scene by scene, the roadmap and the changelog`
