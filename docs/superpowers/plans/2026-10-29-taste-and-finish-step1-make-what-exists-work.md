# Taste and finish, step 1: make what exists work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The assistant can put an interface built in layers inside the phone or browser frame that ships, finds the vocabulary that already ships (pack entries by need), searches before it writes a plugin, gets a check it can act on (grouped, capped, fewer false positives, a coverage check for talking videos), is told not to argue with warnings, harvests the plugins it wrote, and reads what a tool's context offers. The result is verified on the bilal dev project.

**Architecture:** The walkthrough pack's `ui.device` draws its frame without a screenshot, and a new tool of the pack lays the frame with a content group clipped to its screen through the engine's layer `clip` (no engine change). Pack entries are generated into `plugins/index.json` from the modules' `ai.when` notes and injected into the cached fixed part of the system prompt. The check's output goes through one pure grouping function in `@tramme/core` used by the `check` tool for both the model's text and the user's notice, and by a new `tramme check` command. Two checks change or arrive in `packages/core/src/checks.ts`. Guide text lands as one new paragraph of `INSTRUCTIONS`. Harvest is a pure note built in `answers.ts` and emitted by `ask()`.

**Tech Stack:** TypeScript (Node 24 type stripping, vitest), `@tramme/core`, `@tramme/assistant`, `@tramme/cli`, `apps/editor`, `plugins/walkthrough.js`, `scripts/packs`.

**Spec:** [docs/superpowers/specs/2026-10-29-taste-and-finish-design.md](../specs/2026-10-29-taste-and-finish-design.md), section "1. Make what exists work". Steps 0 and 2 to 8 are out of this plan: step 0 (the baseline) spends the user's quota and needs their blind scoring, so it is theirs to start, but Task 0 pins the code it must measure; every other step gets its own plan after step 1 is measured.

## Global Constraints

- One mechanism for the assistant and the user: capabilities are tools of the vocabulary; document changes go through operations (spec, Constraints).
- Shared modules, no copies: reuse existing helpers; audit your own diff for duplication before handing over (user's standing rule).
- Never a colour outside the theme tokens; no eyebrow labels, step numbers or connector dashes in any UI text added (user's standing rules).
- New user-visible strings go through `t()` with an English key in `apps/editor/src/i18n/en.json` and its French in `fr.json` (`apps/editor/test/i18n.test.ts` fails on a missing one). User-visible text names actions as the user sees them (the `/` menu titles), never a tool's internal name.
- The test briefs of `bench/briefs.json` stay unseen; nothing here is tuned on one video, `bilal` or marketing included (bilal is a dev project: verifying on it is allowed, fitting thresholds to it is not).
- Cost: the pack entries ride in the cached part of the prompt; the lines stay short (at most 110 characters each, at most 6 000 characters in all).
- Commits carry no Claude attribution (user's standing rule); one commit per task.

## Review Focus

- A check run with no issue, or with sound issues only: the text still opens `No issue found by the checks.` or the sound lines, unchanged.
- A group of one issue prints exactly the line it printed before (no "×1").
- A group whose issues sit in nested compositions names those compositions (read from the layer ids), not the checked one.
- Coverage: no full-frame video, or a video under 12 s: silent. The speaker cut into many layers: one run, not one per cut. A full-frame picture, another clip, an illustration composition: they cover the speaker. Captions, sound, adjustment layers, a logo on screen the whole film: they do not.
- Contrast: text half on a card and half off it falls back to its composition's background, not the card; text on a layer whose colour is unknown (a plugin node, a composition): silent.
- `ui.device` with a screenshot draws exactly as before (the walkthrough tool's output and pictures unchanged).
- A pack with no node or tool (a11y, rhythm) or whose notes hold a newline or a quote: no empty entry, one line per entry.
- Harvest: a plugin written twice in a turn is listed once; a refused write is not listed; a turn that wrote nothing says nothing.

---

### Task 0: Pin the baseline

**Files:**
- Commit: `docs/superpowers/specs/2026-10-29-taste-and-finish-design.md`, this plan

The baseline (spec, step 0) must measure today's code. It runs later, at the user's pace, so the code it measures is pinned now.

- [ ] **Step 1: Commit** the spec and this plan: `git add docs/superpowers && git commit -m "docs: taste and finish, the design and the plan of step 1"`.
- [ ] **Step 2: Tag** that commit (documents only, so its code is today's): `git tag taste-baseline`. The baseline runs from a worktree of the tag (`git worktree add ../tramme-baseline taste-baseline`, then `npm install` and the editor built there), never from a branch where this plan's tasks have landed.

### Task 1: An interface built in layers inside the device frame

**Files:**
- Modify: `plugins/walkthrough.js` (a shared `screenOf`, the frame drawn without a screenshot, a `part` prop, the `device-screen` tool, the module's `messages`, `meta.version` 1.2.0 so projects holding the older copy are offered the update), `plugins/index.json` and `docs/packs.md` (regenerated)
- Test: `apps/editor/test/packs.test.ts`

Today `ui.device` returns before drawing anything when it has no screenshot (`if (!iw || !ih) return;`), and its `screen` prop takes an image asset only: an interface built in layers cannot sit in it. The engine already clips a layer by another layer's path in the same parent space (`Layer.clip`, `packages/core/src/types.ts`).

**Interfaces:**
- Produces: `screenOf(p: { size: [number, number]; device: 'phone' | 'browser' | 'window' }): { x: number; y: number; w: number; h: number; radius: number }` (exported from the pack: the screen's rectangle in the frame's local space, the same numbers the drawing uses today); prop `part: 'whole' | 'under' | 'over'` (default `'whole'`, today's drawing: `under` is the shadow, the bezel and the screen's fill; `over` is what sits over the screen, the notch and the home bar on a phone, the bar on a browser or a window); prop `fill` (colour, default `#FFFFFF`, the screen when there is no screenshot); tool `device-screen` with input `{ device?: 'phone' | 'browser' | 'window'; height?: number; name?: string; at?: number; duration?: number }`.

- [ ] **Step 1: Write the failing tests** in `apps/editor/test/packs.test.ts` (a new `describe('the device frame around built layers')`):
  - `screenOf({ size: [560, 1120], device: 'phone' })` equals the rectangle and radius computed by today's drawing code (write the expected numbers from the current `canvas2d` before extracting it).
  - The node's `canvas2d` with `screen: null` draws (a recording context receives fill calls), with `part: 'under'` it does not draw the notch, with `part: 'over'` it does not fill the screen.
  - `device-screen` with `{ device: 'phone', name: 'Phone' }` on a 1920×1080 composition proposes, in this order inside a group named `Phone`: a `ui.device` layer with `part: 'under'`, a hidden `shape.rect` named `Phone · screen` with `screenOf`'s size and radius, an empty group named `Phone · content` whose `clip` is that rectangle's id, a `ui.device` layer with `part: 'over'`; the phone is 86 % of the composition's height by default; the tool's text names the content group and the screen's width and height in px, and says that layers built in the content group use the screen's centre as their origin.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/packs.test.ts` — expected: FAIL.
- [ ] **Step 3: Implement** `screenOf` and use it in `canvas2d` (the screenshot path draws the same picture: the existing walkthrough tests keep passing); draw the frame and fill the screen with `fill` when there is no screenshot; honour `part`.
- [ ] **Step 4: Implement** `device-screen` (sizes from `screenOf`, the clip on the content group, `at` and `duration` on the group as the other pack tools do) and its `messages` (en and fr) for its title and labels.
- [ ] **Step 5: Rewrite the notes** in the pack's voice. `ui.device`'s `ai.when`: a phone, browser or window frame around an interface: a screenshot in `screen`, or an interface built in layers (lay it with the `device-screen` tool). `device-screen`'s `ai.when`: an interface built in layers inside a phone or a browser: build the screen's layers in the content group, which the screen clips.
- [ ] **Step 6: Run** `npm run packs:index` (the new tool joins the pack's commands), then `npx vitest run apps/editor/test/packs.test.ts` and `node scripts/packs/index.ts --check` — expected: PASS and `packs index up to date`.
- [ ] **Step 7: Commit** `feat(walkthrough): an interface built in layers inside the device frame`

### Task 2: Pack entries by need, generated

**Files:**
- Create: `scripts/packs/entries.ts`
- Modify: `scripts/packs/index.ts`, `apps/editor/src/packs.ts` (type only), `plugins/index.json` and `docs/packs.md` (regenerated)
- Test: `apps/editor/test/packs.test.ts`

**Interfaces:**
- Produces: `needLine(item: { ai?: { when?: string }; description?: string; title?: string; name?: string; type?: string }): string` (in `scripts/packs/entries.ts`); `PackEntry.entries?: { name: string; kind: 'node' | 'tool' | 'effect'; line: string }[]` (in `apps/editor/src/packs.ts`).

- [ ] **Step 1: Write the failing tests** in `apps/editor/test/packs.test.ts` (a new `describe('the packs\' entries by need')`):
  - `needLine({ ai: { when: 'a phone or browser frame for an interface. Then more detail' } })` is `'a phone or browser frame for an interface'` (first sentence).
  - `needLine` of a `when` over 110 characters ends with `…` and is at most 110 long; of a `when` with a newline or a double quote, one line with the quote kept; with no `when`, the `description`; with neither, the `title`.
  - Over the real `plugins/index.json`: every pack that exports nodes or tools has `entries`; every `line` is non-empty and at most 110 long; the entries named `ui.device` (`kind: 'node'`) and `device-screen` (`kind: 'tool'`) exist under `walkthrough.js`; the lines add up to at most 6 000 characters.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/packs.test.ts` — expected: FAIL (`needLine` and `entries` missing).
- [ ] **Step 3: Implement `needLine`** in `scripts/packs/entries.ts`: take `ai.when`, else `description`, else `title`; collapse whitespace; cut at the first sentence end (`. ` or `;`); clip to 110 with `…`.
- [ ] **Step 4: Extend `scripts/packs/index.ts`**: each pack gets `entries` from its module's `nodes`, `tools` and `effects` (name is `type` for nodes and effects, `name` for tools), in that order; the interface `Entry` in the script and `PackEntry` in `apps/editor/src/packs.ts` gain the field. Run `npm run packs:index`.
- [ ] **Step 5: Run** the test file, then `node scripts/packs/index.ts --check` — expected: PASS and `packs index up to date`. Read the generated lines of `walkthrough.js`, `icons.js`, `handmade.js`, `charts.js` and `kinetic.js`: where a line does not say the need (what it is for), sharpen that node's `ai.when` in the pack, regenerate. The `ui.device` line must not read as screenshots only.
- [ ] **Step 6: Commit** `git add scripts/packs plugins apps/editor/src/packs.ts apps/editor/test/packs.test.ts docs/packs.md && git commit -m "feat(packs): the index carries each pack's entries by need"`

### Task 3: The entries in the system prompt

**Files:**
- Modify: `packages/assistant/src/index.ts` (`systemParts`, `joinSystem` untouched), `apps/editor/src/packs.ts`, `apps/editor/src/ai/index.ts:455-462`, `apps/editor/src/ai/answers.ts:92`
- Test: `packages/assistant/test/system.test.ts`, `apps/editor/test/packs.test.ts`

**Interfaces:**
- Consumes: `PackEntry.entries` (Task 2).
- Produces: `packLines(packs: PackEntry[]): string[]` in `apps/editor/src/packs.ts`, each line `` `${name} (${pack.name}): ${line}` ``; `systemParts(reference: string, brief?: string, installed?: string[], packs?: string[]): SystemParts`, where `packs` lines go in `fixed`, after the reference, under the heading `Entries of the editor's packs, by need (usable even when the project holds none; the first use adds the pack to the project; list_nodes { types } gives the full entry):`.

- [ ] **Step 1: Write the failing tests.** In `system.test.ts`: `systemParts(REF, undefined, undefined, ['ui.device (UI walkthrough): a phone frame']).fixed` contains the line and the heading, after `REF`; `fixed` stays equal for two different briefs given the same packs; with no `packs` argument `fixed` is exactly what it was (the existing tests keep passing untouched). In `packs.test.ts`: `packLines` over the real index has one line per entry and contains `ui.device (UI walkthrough): `.
- [ ] **Step 2: Run** both files — expected: FAIL.
- [ ] **Step 3: Implement** `packLines` and the fourth parameter of `systemParts`/`systemPrompt`. In `ai/index.ts`, replace the `Packs of the editor: names…` line pushed to `mine` by `packLines(packs)` passed as the fourth argument of `systemParts`. In `answers.ts:92` the hidden-entries sentence now says the packs' entries are listed in the instructions and `list_nodes { query }` gives their schemas; update the assertion at `assistant-tools.test.ts:83` to the new sentence.
- [ ] **Step 4: Run** `npx vitest run packages/assistant apps/editor/test/packs.test.ts apps/editor/test/assistant-tools.test.ts` — expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): the packs' entries by need ride in the cached prompt`

### Task 4: A check that can be acted on

**Files:**
- Create: `packages/core/src/check-report.ts` (exported from the package index)
- Modify: `packages/core/src/checks.ts` (`QualityIssue.rank`, text-size sets it), `apps/editor/src/review.ts:77-93`, `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `packages/core/test/check-report.test.ts`, `apps/editor/test/review.test.ts`

Checks see the layers of nested compositions too: a placed layer's id carries the composition layers it sits in as a prefix (`s2/title`: the layer `title` inside what the composition layer `s2` plays; a distribution adds its rank, `cards#3/title`; see `place` in `checks.ts`). An issue does not say its composition; the report reads it from the ids.

**Interfaces:**
- Produces: `QualityIssue.rank?: number` (higher is worse; `text-size` sets `min / px`); `compositionOf(doc: TrammeDoc, compId: string, layerId: string): string` (the id of the composition the layer sits in, following the prefix from `compId`; the instance rank ignored); `groupIssues(issues: QualityIssue[]): IssueGroup[]` with `IssueGroup = { check: string; severity: 'warning' | 'info'; count: number; worst: QualityIssue; layers: string[]; from?: number; to?: number }`, grouped by `check` + `severity`, warnings first then by count descending, `worst` the highest `rank` (else the first); `reportLines(groups: IssueGroup[], opts: { doc: TrammeDoc; compId: string; max?: number }): { lines: string[]; hidden: number }`, `max` default 12 groups.

- [ ] **Step 1: Write the failing tests** in `check-report.test.ts`:
  - `compositionOf` of `title` is the checked composition, of `s2/title` the composition `s2` plays, of `s2/inner/title` the one two levels down, of `cards#3/title` the one `cards` plays.
  - 38 `text-size` warnings with ranks 1.1 to 2.4, their layers in the composition played by `s2` (named "Illustration 2"), give one group with `count: 38` and `worst` the rank 2.4 issue; its line is `- [warning] text-size x38 in "Illustration 2" (0.5 s to 5.75 s), worst: <worst.message> (layers: a, b, c, d, e, +33 more)`; when the layers span two compositions the line names both (`in "Illustration 2", "Illustration 3"`), and at most three before `+n more`.
  - A one-issue group prints `- [warning] ${message}` plus ` (layers: …)` exactly as `review.ts` does today.
  - 20 groups with `max: 12` give 12 group lines, `hidden: 8`, and the 13th line names how many groups and issues were left out and by which checks.
- [ ] **Step 2: Run** `npx vitest run packages/core/test/check-report.test.ts` — expected: FAIL.
- [ ] **Step 3: Implement** `compositionOf`, `groupIssues` and `reportLines`; set `rank` in `textSize`.
- [ ] **Step 4: Use them in `check`** (`review.ts`): the model's `lines` come from `reportLines(groupIssues(issues), { doc: ctx.doc, compId: ctx.compId })`, the head keeps counting every warning and note (not groups). The user's `notice`: one line per shown group, the `worst.say` text, and for a group of more than one the key `review.similar` ("{n} similar") appended; add the key in en and fr. `keyTimes` still receives all issues.
- [ ] **Step 5: Add to `review.test.ts`** a test over `check` pieces that can run without a browser (if the tool's `run` needs the canvas, test through `reportLines` with an issue list shaped like the bilal case: 496 warnings and 29 notes spread over eight nested compositions give at most 13 lines plus the head).
- [ ] **Step 6: Run** `npx vitest run packages/core apps/editor/test/review.test.ts apps/editor/test/i18n.test.ts` — expected: PASS.
- [ ] **Step 7: Commit** `feat(check): issues grouped by cause, ranked and capped`

### Task 5: Contrast against what the text really sits on

**Files:**
- Modify: `packages/core/src/checks.ts` (`textContrast`, around lines 371-403)
- Test: `packages/core/test/checks.test.ts`

**Interfaces:**
- Consumes: `paintLuma(paint, tokens)`, `overlapArea` (same file); `compositionOf` (Task 4).

A nested composition draws its own background plate (`packages/render/src/renderer.ts`, the nested frame), so text inside one sits on that plate, not on the checked composition's.

- [ ] **Step 1: Write the failing tests** (the file's `doc`/`text` helpers; a `shape.rect` layer is the card, below the text in `order`, with a `fill` prop):
  - Dark ink `#111` on a `#f4f4f4` card over a `#101010` composition background gives no `text-contrast`; light ink `#f4f4f4` on the same light card gives one.
  - Text half on the card and half off it is judged against its composition's background (as today).
  - Text covered at 90 % by an opaque layer of a node the check cannot read a colour from (a test node registered with no `fill`, opacity 1, under the text) gives no issue, whatever the background.
  - Dark ink inside a nested composition whose background is `#f4f4f4`, played in a composition whose background is `#101010`: no issue.
- [ ] **Step 2: Run** — expected: the first, the third and the fourth FAIL.
- [ ] **Step 3: Implement**, in this order, the ground of a text: a media layer with a space analysis still wins as today; else the topmost non-text layer under the text (earlier in the sample's order) with `opacity >= 0.5` whose box covers at least 90 % of the text's box: a `shape.*` with a `fill` whose luminance `paintLuma` reads is the ground; any other such layer (a plugin node, a composition, a picture without analysis) means the ground is unknown and the text is not judged; else the background of the composition the text sits in (`compositionOf`), the checked one's at the top.
- [ ] **Step 4: Run** `npx vitest run packages/core/test/checks.test.ts` — expected: PASS.
- [ ] **Step 5: Commit** `fix(check): contrast is measured against what the text sits on`

### Task 6: Coverage check for a talking video

**Files:**
- Modify: `packages/core/src/checks.ts` (a new `coverage: CheckType`, added to `BUILTIN_CHECKS`), `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `packages/core/test/checks.test.ts`

**Interfaces:**
- Produces: check `coverage`; issue messages `Only the speaker is on screen from ${from} s to ${to} s (${len} s): put a title, an illustration or a keyword on it.` with `say.text` `Only the speaker is on screen from {from} s to {to} s ({len} s)`; `texts` lists the template (the i18n key test reads it).

- [ ] **Step 1: Write the failing tests** (a full-frame `video` layer over 6 s needs a longer composition: set `duration` in the test's doc):
  - A 40 s composition with only the video and a captions layer gives one `coverage` warning from 0 to 40.
  - The same media cut into four `video` layers back to back (as `cut_media` leaves it) gives the same single warning, not four.
  - A title at 0 to 3 s and at 20 to 23 s: the gap 3 to 20 s (17 s) is an `info`; a gap over 20 s is a `warning`.
  - A full-frame picture from 10 to 14 s, or a full-frame clip of another media from 25 to 30 s, or a composition layer from 30 to 36 s, splits the run: each covers the speaker.
  - A logo in a corner on screen for the whole 40 s, or an adjustment layer over everything, does not.
  - A composition with no full-frame video gives none; a video under 12 s gives none.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement** `coverage`:
  - The speaker is one media: among the `video` layers placed at the top of the checked composition, the media whose layers together cover at least 60 % of the frame in the most samples. The composition is a talking video when that media does so in at least half of the samples.
  - Layers that never count: the speaker media's layers, `audio` and `captions` nodes, adjustment layers (a node that `composes: 'adjust'`), and any layer visible (opacity above 0.3) in more than 80 % of the samples (a logo, a frame, a progress bar).
  - A sample is bare when no other layer is visible with opacity above 0.3. Runs of bare samples: `warning` over 20 s, `info` from 12 to 20 s, one issue per run, `t` its start.
- [ ] **Step 4: Translate** the template in `fr.json` the way `text-size`'s is (grep its template there); run the i18n test.
- [ ] **Step 5: Run** `npx vitest run packages/core apps/editor/test/i18n.test.ts` — expected: PASS.
- [ ] **Step 6: Commit** `feat(check): coverage, the longest stretch with only the speaker on screen`

### Task 7: The guide

**Files:**
- Modify: `packages/assistant/src/index.ts` (`INSTRUCTIONS`, one new paragraph before `Motion:`), `packages/assistant/test/fixtures/system-before.txt` (the same paragraph at the same place)
- Test: `packages/assistant/test/system.test.ts`

- [ ] **Step 1: Write the failing test**: `systemParts(REF).fixed` contains, as words, `search the vocabulary`, `two or three words`, `never dismissed`, `20 s`, `library`.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Add the paragraph** `Finish:` with these four bullets, in the file's voice:
  - before writing a plugin, search the vocabulary with two or three words of the need (`list_nodes { query }`) and read the packs' entries listed below; write a plugin only when nothing fits, and when you write one, say in the summary what you searched and why nothing fitted;
  - a warning of the check is fixed, or raised to the user in the summary with its reason; it is never dismissed in your own reasoning (a warning "at the same scale as the example" is still a warning); the check groups issues by cause: fix the cause once (a component, a style, a token), not each line;
  - in a video where someone speaks, no stretch of more than 20 s with only the speaker on screen: the check says where;
  - the plugins you wrote are listed to the user at the end of the turn, who may keep them in the library for other projects; do not repeat that list.
  Put the same paragraph in the fixture; the "same words as before" test compares paragraphs and the instruction prefix.
- [ ] **Step 4: Run** `npx vitest run packages/assistant` — expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): search before writing, warnings are fixed or raised, coverage`

### Task 8: Harvest the plugins written in a turn

**Files:**
- Modify: `apps/editor/src/ai/answers.ts`, `apps/editor/src/ai/tools.ts` (the runner: record plugin paths written by `write` and by `ctx.writeFile`), `apps/editor/src/ai/index.ts` (emit before the usage item, around line 499), `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/assistant-tools.test.ts`

**Interfaces:**
- Produces: `harvestNote(paths: string[]): string` in `answers.ts` — empty for none; otherwise the key `ai.harvest` text listing the file names (once each, sorted) and naming the `/` menu action that keeps a plugin in the library, by its title as the user sees it; runner field `wrotePlugins: Set<string>`, emptied when a turn starts (where `runner.clear()` runs in `ask`).

- [ ] **Step 1: Write the failing tests**: `harvestNote([])` is `''`; `harvestNote(['plugins/b.js', 'plugins/a.js', 'plugins/a.js'])` names `a.js` and `b.js` once each, in that order, and contains the translated title of the `library-add` tool (`t('Keep a plugin in the library')`), not the string `library-add`.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement** `harvestNote` with `t('ai.harvest', { files, action: t('Keep a plugin in the library') })` (en: `Plugins written in this turn: {files}. To use them in your other projects: / menu, {action}.`; fr: `Plugins écrits pendant ce tour : {files}. Pour les réutiliser dans tes autres projets : menu /, {action}.`). Record in the runner only writes that succeed under `plugins/` (the refused ones throw before). In `ask()`, after the attempts loop and before the usage item, `yield` an assistant `item` with the note when it is not empty.
- [ ] **Step 4: Run** `npx vitest run apps/editor/test/assistant-tools.test.ts apps/editor/test/i18n.test.ts` then `npm run typecheck` — expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): the plugins written in a turn are listed and offered to the library`

### Task 9: The plugin runtime, documented

**Files:**
- Modify: `docs/document.md` (the `Tools` section, the comment at line ~319)
- Test: `apps/editor/test/plugin-runtime-doc.test.ts`

- [ ] **Step 1: Write the failing test**: read `packages/core/src/tools.ts`, take the member names of `interface ToolContext { … }`, and assert each appears in `docs/document.md` between `### Tools` and the next `###` heading.
- [ ] **Step 2: Run** — expected: FAIL (`selection`, `time`, `registry`, `signal`, `progress`, `packFile` are not all named).
- [ ] **Step 3: Rewrite the `ctx:` comment** as a short list of every member with one clause each (taken from the doc comments in `tools.ts`), and add three sentences from `docs/plugin-isolation.md` (stages 1 and 2, done) on where a project plugin's tools run (a worker: no DOM, no page rights, `OffscreenCanvas` for drawing, the network only through `ctx.fetch` with the permissions declared in `meta.permissions`), so no run probes it again.
- [ ] **Step 4: Run** the test — expected: PASS.
- [ ] **Step 5: Commit** `docs: everything a tool's context offers, and where a plugin runs`

### Task 10: Verify on the bilal dev project

**Files:**
- Create: `packages/cli/src/check.ts`
- Modify: `packages/cli/src/main.ts` (the `check` command, its line in the header and the usage), `README.md` (the Commands block)
- Test: `packages/cli/test/check.test.ts`

The unit tests prove the parts; this task proves step 1 on the real case, first without spending quota, then with one run.

**Interfaces:**
- Produces: `tramme check <doc> [--comp <id>]`: loads the document and its plugins the way `validate` does (`registryOf` in `main.ts`), runs the picture checks of `@tramme/core` (`runChecks`; the sound report needs the browser and is left out, said in the output), prints the head and `reportLines` (Task 4).

- [ ] **Step 1: Write the failing test** in `packages/cli/test/check.test.ts`: on a small fixture document (a 40 s composition, a full-frame video asset reference, two titles), the command's output opens with the warnings and notes count and holds a `coverage` line.
- [ ] **Step 2: Run** `npx vitest run packages/cli/test/check.test.ts` — expected: FAIL.
- [ ] **Step 3: Implement** `check.ts` and wire the command.
- [ ] **Step 4: Run** the test — expected: PASS.
- [ ] **Step 5: Check bilal without quota.** Unpack the version that made `bilal.mp4` (`node packages/cli/src/main.ts unpack out/ammm/bilal.tramme --out <scratch folder>`; the copy in `Documents/Tramme/projects` changed since) and run `tramme check` on it (the command is new, so the before is the run of 2026-10-28 as its conversation recorded it: 496 warnings and 29 notes, the contrast warnings at 1.3:1 on texts over white cards). Expected:
  - the issues read in at most 13 lines plus the head;
  - no `text-contrast` on texts over the white cards and the phones' screens;
  - `coverage` warnings on the stretches the rendered film shows with only the speaker, about 0:45–1:15, 1:25–1:55 and 2:50–3:10 (within 5 s).

  Write the output and the comparison in the PR description. A number off from this is a finding to fix or to explain, not to tune the thresholds on.
- [ ] **Step 6: One dev run, with the user's go** (it spends their quota): on the trial server (port 8790, `.wrangler/state-trial`, never the user's dev on 8787), a new project with bilal's material and their request as they wrote it, left alone to the end of the turn. Note in the PR: whether a plugin was written for the phone or the icons, whether `device-screen` and the icons pack were used, the check's length as the assistant read it, and the cost (`node bench/usage.ts`), against the run of 2026-10-28 (25 requests, 36 tool calls, 15 images, 24 min).
- [ ] **Step 7: Commit** `feat(cli): tramme check, the picture checks of a project from the command line`

### Task 11: Roadmap, changelog, whole-branch check

**Files:**
- Create: `docs/taste-finish-roadmap.md` (boxes to tick, the steps of the spec; step 1 ticked as its tasks land)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the roadmap file** in the shape of `docs/taste-roadmap.md`: one section per step 0 to 8 of the spec with its bullets as boxes, step 0 marked as the user's runs from the `taste-baseline` tag, a line on how each step is measured.
- [ ] **Step 2: Add the changelog entry** under the unreleased heading, in the file's style.
- [ ] **Step 3: Verify** `npm run typecheck`, `npm test`, `node scripts/packs/index.ts --check` — expected: all pass.
- [ ] **Step 4: Audit the diff for duplication** (a second grouping helper, a second clip function, a second walk of the layer id prefixes, the screen's geometry computed twice in the pack, strings repeated between the check and the notice) and fix.
- [ ] **Step 5: Commit** `docs: roadmap for taste and finish, step 1 done`
