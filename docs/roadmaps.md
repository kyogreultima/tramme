# The roadmap of roadmaps

The only thread: every roadmap in `docs/`, in the order they should be worked, and how an agent works through them. Open boxes counted on 2026-11-05 (`- [ ]` against `- [x]`), counted again before this was last read: the figures below match the files.

## Order

| # | Roadmap | State | Why here | By an agent |
|---|---|---|---|---|
| 1 | [Safe projects](safe-projects-roadmap.md) | **In progress:** 18 open, 2 done. Forced cancellation and separate workers for each plugin's tools and checks are complete; the opaque frame, network policy, CLI declaration isolation, font transfer and initial bridge limits are built. Full path coverage and security gates remain open | Marked "now" in its file. It blocks opening unknown projects, removing the code-execution question, the commercial launch and the isolation of web scenes | Steps 1 to 5: the boundary is chosen (an opaque-origin sandboxed iframe, see Decisions). What only a device shows (WebView2, WKWebView) is the user's to check. Step 6 ends on an independent security review and devices: the user's, and the general code question stays until then |
| 2 | [Web scenes](web-scenes-roadmap.md) | planned, 32 open | Lifts the ceiling on what a film can look like. Step 0 runs alongside 1; steps 5 and after wait for its boundary | Step 0's three prototype boxes, with the figures; the user then writes its decision. After it: steps 1 to 4 and 6 to 8, and step 9 for desktop and CLI (no rendering service, see Decisions). Step 5, the isolation, waits for item 1's boundary. Step 10 is a blind scoring on the user's quota |
| 3 | [Taste and finish](taste-finish-roadmap.md) | 10 open, 19 done; steps 1 to 5 built, waiting for their measure | The autonomy goal. Run the measure first: it says whether the limit is the tools or the prompt, and sets the baseline before web scenes | No. Every open box is a run on the user's quota ("waits for the user's go") or a blind scoring |
| 4 | Platform: accounts backend and billing | in progress; payment provider last | Needed for the commercial launch under FSL-1.1-ALv2 | Not in this repository. It lives in the private `tramme-platform` (`docs/accounts.md`, `docs/billing.md` there). Built since the first version of this file: the beta deployment of both repositories, the accounts in the web and desktop apps, the account mails. Left there: the payment provider, the sign-in with Google and GitHub, the cloud storage of projects |
| 5 | [Installed plugins](installed-plugins-roadmap.md) | 5 open, 26 done; the marketplace waits for the API | Unblocked by 4 | No. The five boxes are the marketplace: catalogue, author accounts and signatures, reviews, revocation. They need the platform's API and decisions on who reviews |
| 6 | [Sound parity](sound-parity-roadmap.md) | **Agent work complete:** 25 done, 4 open; steps 1–6 built, step 7 outside this queue | Catch-up on a competitor: useful, not blocking | Yes, all six steps. The providers are answered by fakes in the tests; trying them for real costs money and is the user's |
| 7 | Loose ends | [Generation](generation-roadmap.md) 2, [Editing](editing-roadmap.md) 2, [Sound](sound-roadmap.md) 2, [Components](components-roadmap.md) 1, [Packs](packs-roadmap.md) 1 (decision 4), [Plugins](plugins-roadmap.md) 1 | Small leftovers. The Plugins one is the isolation work of item 1 | See below |

The loose ends, one by one:

- Generation: the palette tool box, yes. The checks that read a picture wait for the OCR perception step, which does not exist yet.
- Editing: no. Voice and music apart has no known ONNX export of Demucs to build on, and HDR waits by design for Canvas 2D above 8 bits.
- Sound: no. The recorded whooshes are chosen and judged by hand; trying the real providers costs money.
- Components: no. The volume view is written as "later" and nothing asks for it.
- Packs: no. Extruded text waits for a font reader (decision 4).
- Plugins: the isolation, which is item 1.

## Done

A roadmap with no open box is removed from `docs/`, and from the site's menu: its record is the changelog and the history. Five went that way (motion, performance, polish, shorts, taste). The performance figures they leave behind are in [bench/README.md](../bench/README.md): once web scenes exist, a load case for a scene is added there, since a scene is a render path the load cases do not cover.

## Decisions

- 2026-11-05, safe projects: the boundary is an opaque-origin sandboxed iframe with a Content-Security-Policy that denies the network, hosting the worker. A dedicated origin only if a supported webview fails the proof. The independent security review comes later, and until it has happened the code question stays.
- 2026-11-05, web scenes: the web editor does not render scenes through a server; their export is for the desktop app and the command line, and the web editor says so. The engine (reuse HyperFrames, reuse it with limits, or write Tramme's own capture) is decided after step 0's measures.

## What an agent can work

Of the open boxes of items 1 to 7, the ones an agent can land alone, in the order to take them:

1. Sound parity, steps 1 to 6. Nothing waits for the user.
2. Safe projects, steps 1 to 5. Nothing waits for the user to start; the devices' checks come back to them.
3. Web scenes, step 0's three prototype boxes at once. Its decision is the user's to write from the figures; then steps 1 to 4 and 6 to 8, step 9 for desktop and CLI, and step 5 after item 2 above.
4. The Generation palette-tool box.

Everything else above waits for the user: a decision, a run on their quota, a blind scoring, a device, an independent review or a hand-picked set of recordings. The agent lists those as blocked and does not start them. The one decision still ahead is the web scenes engine, written from step 0's figures.

## Rules of the order

- A roadmap moves up when another one needs it, and down when it only catches up.
- Safe projects comes before anything that runs code a user did not write.
- The macOS download stays withheld until Apple signs the app (`WITHHELD` in `apps/desktop/downloads.ts`): a launch item, not a roadmap.
- The accounts backend and the billing are in the private repository: nothing in these roadmaps asks for them, and an agent working on this repository does not look for them.

## Running it

An agent works through the queue above, one box after the other, in this session or a fresh one. The roadmaps' checkboxes are the state; nothing else has to be explained to it.

**Where.** One branch for the whole run, made from the latest `develop` by the first iteration (`feat/roadmaps`) and pushed after every iteration, never `develop` or `main`: a push to `develop` deploys the beta site and the beta app (`beta.yml`), and a change of the app's version there builds the beta desktop app (`desktop-beta.yml`). Nothing is merged along the way. When the queue is done or blocked, one pull request is opened against `develop`, not merged: what each roadmap gained with its commits, what is blocked and why, what is to check on a device. The checks run on pull requests and on pushes to `develop` and `main`, not on this branch, so `npm run typecheck` and `npm test` before every push are the gate.

**One iteration** lands one box, or a few of one step that only make sense together. Never a whole roadmap.

1. Sync: pull the branch, fetch `develop`, merge it in if it moved (a merge, never a rebase) and run the checks.
2. Pick the first unticked box of the queue that is not blocked.
3. Read the box, its step, its roadmap's principles, the files it names, and the nearest existing feature, built the same way.
4. Build it with its tests (vitest, next to the existing ones). The house rules: rendering stays a pure function of `t`; every new property comes from a schema (`npm run schema` after a change of the document format); every new tool is a tool of the editor's vocabulary with its `ai` notes; every new string in English and French; no colour outside the theme's tokens; no model packed in the bundle.
5. Check: `npm run typecheck` and `npm test` pass, and `npm run site:build` when a page of the docs changed. A failure is fixed, not skipped. After three honest attempts at the same one, revert the work in progress, put the box in the blocked list with the reason, and take the next.
6. Write it down: tick the box and update its roadmap's status line, add what was left out under it, add a line to `CHANGELOG.md` under `Unreleased` written for the people who use Tramme (no box is ticked without it), and put what could not be checked here under the box as "to check on a device", and again in the pull request. That never blocks a box.
7. Commit (Conventional Commits, the code, its tests, the ticked box and the changelog line together; the commits are the user's, never Claude as author or co-author) and push.
8. Report one line: the box landed, its commit, what is next.

**It stops and asks** when a roadmap leaves a product decision open (a default the user would notice, a change of the document format that is not an addition, a dependency over 1 MB in the editor's bundle), when a model's or library's licence is unclear or forbids commercial use, when a box contradicts a principle of its roadmap or another, when `develop` has failing checks it did not cause, and when every box is ticked or blocked.

**It never** pushes to `main` or `develop`, force-pushes, merges anything, deletes or rewrites a roadmap's plan to make a box easier (a plan that turns out wrong is a question for the user), pushes a commit whose checks fail, or adds a provider, a key, an account or a server to a feature that is kept local.

## Blocked

Boxes the agent could not land, with why. It adds to this list; the user clears it.

- The boxes marked "No" in the order above, for the reasons given there.
