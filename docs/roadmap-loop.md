# The roadmap loop

How an agent works through the roadmaps that have not started, one item after the other, until every box is ticked: in this session or in a fresh one, with nobody re-explaining the plan. This file is the agent's brief. It is read at the start of every iteration; the roadmaps' checkboxes are the state.

All the work goes on one branch, `feat/roadmap-loop`, made from the latest `develop`. Every item lands there as its own commits; nothing is merged along the way. When every box is ticked or blocked, the loop opens one pull request against `develop`, and the user reviews the whole of it.

## Scope

Four roadmaps, every unticked box in them:

- [performance-roadmap.md](performance-roadmap.md)
- [components-roadmap.md](components-roadmap.md)
- [editing-roadmap.md](editing-roadmap.md)
- [installed-plugins-roadmap.md](installed-plugins-roadmap.md)

The others (generation, sound, shorts, plugins) keep their own pace and are out of the loop.

## The queue

The order the items are taken in. It follows what each one needs from the others; within a step, the boxes are taken top to bottom.

1. Performance, step 1 — the measures: every later "faster" is checked against them.
2. Performance, step 5 — the decoder pool and one asset per file: the transitions of Editing need them.
3. Editing, step 1 — models in the settings: every model step after it registers there.
4. Editing, steps 2 to 9 — the edit in code: speed curves, transitions, keying, masks, colour, stabilisation, proxies, voice effects.
5. Components, steps 1 to 5.
6. Performance, step 3 — the Evaluator for many instances, once components exist to measure it on.
7. Performance, step 2 — parallel export.
8. Editing, steps 10 to 14 — a clean voice, hesitations, faces, the long jobs, 10-bit exports.
9. Installed plugins, steps 1 to 7.
10. Performance, step 4 — only what the measures point at.
11. Components, step 6 — the cut per pixel, said in its roadmap to come later.
12. Installed plugins, step 8 — the marketplace: blocked until tramme has its API. The loop does not start it; it lists it as blocked and stops there.

## One iteration

One iteration lands one box, or a few boxes of the same step when they only make sense together. Never a whole roadmap at once.

1. **Sync.** Check out `feat/roadmap-loop` (create it from the latest `develop` on the very first run) and pull it. Fetch `develop`; if it moved, merge it into the branch (a merge, never a rebase: the branch is shared by every run) and run the checks before going on.
2. **Pick.** The first unticked box in the queue's order that is not listed under "Blocked" at the end of this file.
3. **Read.** The box, its step, the roadmap's principles, the files it names, and the code around them. Look at how the nearest existing feature is built (a tool, a node, an effect, a setting) and build the new one the same way.
4. **Build.** The feature with its tests (vitest, next to the existing ones). The house rules, from the roadmaps and the repository:
   - Rendering stays a pure function of `t`; a model runs at authoring time and its result is saved as an asset.
   - Same pixels: an optimisation leaves exports identical, or the difference is understood and written in the pull request.
   - Every new property comes from a schema (the inspector and the validator follow); `npm run schema` regenerates the JSON schema when the document format changes.
   - Every new tool is a tool of the editor's vocabulary (`use_tool` and the `/` menu) with its `ai` notes.
   - Every new string of the interface in English and French (`apps/editor/src/i18n/`).
   - No model packed in the bundle: downloaded on first use, chosen in the settings once Editing step 1 exists.
   - No provider and no key for anything in these four roadmaps: they run on the user's machine.
   - Rust only as WebAssembly, only where a measure of Performance step 1 points; never a rewrite.
5. **Check.** `npm run typecheck` and `npm test` pass; `npm run site:build` too when a page of the docs changed. A failure is fixed, not skipped. After three honest attempts at the same failure, the work in progress is reverted from the branch (kept as a patch under `docs/roadmap-loop/` only if it is worth resuming), the box goes under "Blocked" with the reason, and the loop takes the next box. The branch's checks always pass.
6. **Write it down.**
   - Tick the box in its roadmap, update the roadmap's "Status" line, and add under the box what was left out, if anything.
   - A line in `CHANGELOG.md`, under `Unreleased`, for every box, always: under `Added`, `Changed` or `Fixed`, written for the people who use tramme (what they can now do, or what got faster and by how much), the way the existing entries are written. No box is ticked without its changelog line.
   - The README when a visible feature changes what it says.
   - What could not be checked here (a phone, a Mac, iOS's Files app, a real GPU, HDR on a screen) said under the box: "to check on a device", and gathered in the final pull request. It does not block the box.
7. **Commit and push.** The code, its tests, the ticked box and the changelog line in the same commit (or a few, for a large box), its message in Conventional Commits (`feat(editor): speed curves on video and sound layers`), then push `feat/roadmap-loop`. The commits are the user's: before the first one, `git config user.name KYOGRE` and `git config user.email aziz@kyogre.dev`, never Claude as author or committer. No `Co-Authored-By` line, no mention of Claude in commits or in the pull request. Nothing is left unpushed at the end of an iteration.
8. **Report.** One line to the user: the box landed, its commit, what is next. Then the next iteration.

## When to stop and ask

The loop stops and asks the user, instead of choosing, when:

- the roadmap leaves a product decision open (a default the user would notice, a change to the document format that is not an addition, a new dependency over 1 MB in the editor's bundle);
- a model's or a library's licence is unclear or forbids commercial use;
- a box contradicts a principle of its roadmap or of another one;
- `develop` has failing checks the loop did not cause.

It also stops when every box of the queue is ticked or blocked. Then it opens the pull request (see "The end").

## What the loop never does

- Push to `main` or to `develop`, force-push anything (`feat/roadmap-loop` included: every run builds on what the previous one pushed), merge anything into `develop`.
- Delete or rewrite a roadmap's plan to make a box easier; a plan that turns out wrong is a question for the user.
- Push a commit whose checks fail.
- Add a provider, a key, an account or a server to a feature these roadmaps keep local.

## The end

When the queue is done, the loop opens one pull request from `feat/roadmap-loop` against `develop`, titled `feat: the roadmap loop` (or what the work turned out to be), and does not merge it. Its body: what each roadmap gained, step by step, with the commits; the figures of Performance step 1 before and after; what is blocked and why; what must be checked on a device. The user reviews it and merges it.

The CI runs on pull requests only, so until then `npm run typecheck` and `npm test`, run by the loop before every push, are the only gate: they are never skipped.

## How the loop runs

Three ways, the same brief:

- **A scheduled task (recommended).** A fresh session every few hours, each doing as many iterations as fit, then stopping cleanly. Each run starts from what is pushed, so nothing is lost when a session ends, and each starts with a clean context. The prompt of the task:

  > Work on the tramme repository (kyogreultima/tramme). Read `docs/roadmap-loop.md` on `develop` and follow it: work on the branch `feat/roadmap-loop` (create it from the latest `develop` if it does not exist yet), run iterations one after the other, each landing one box of the queue with its changelog line, until the run's time is nearly spent or the loop says to stop. Leave nothing unpushed. Do not open the pull request before every box is ticked or blocked.

- **This session, with `/loop`.** The same prompt, paced by the agent; it lasts as long as the session.
- **By hand.** The same prompt pasted into a new session, one run at a time.

Before the first run, the environment must install and test the repository: Node 22.18 or newer, `npm ci`, and Chrome for the tests that render (the cloud environment has Chromium; Playwright finds it). A session start hook that runs `npm ci` saves each run that time.

## Blocked

Boxes the loop could not land, with why. The loop adds to this list; the user clears it.

- Installed plugins, step 8 (the marketplace): waits for tramme's API.
- Editing, step 12, voice and music apart (Demucs in ONNX): no ONNX export of Demucs whose inputs are known could be fetched or checked from the loop's container; it needs one, then runs through the long-job runner of step 13.
- Editing, step 14, HDR (PQ, HLG): waits by design for Canvas 2D above 8 bits; exports stay SDR, at 10 bits where possible.
- Components, step 5, the volume view: written in its roadmap as "later"; nothing in the queue asks for it yet.
