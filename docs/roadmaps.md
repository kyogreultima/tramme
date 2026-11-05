# The roadmap of roadmaps

Every roadmap in `docs/`, in the order they should be worked. Open boxes counted on 2026-11-05 (`- [ ]` against `- [x]`); the platform line comes from [accounts.md](accounts.md) and [billing.md](billing.md), to confirm.

Status: this order replaces the queue of [roadmap-loop.md](roadmap-loop.md), most of whose items are done.

## Order

| # | Roadmap | State | Why here |
|---|---|---|---|
| 1 | [Safe projects](safe-projects-roadmap.md) | 20 open, 0 done | Marked "now" in its file. It blocks opening unknown projects, removing the code-execution question, the commercial launch and the isolation of web scenes |
| 2 | [Web scenes](web-scenes-roadmap.md) | planned | Lifts the ceiling on what a film can look like. Step 0 runs alongside 1; steps 5 and after wait for its boundary |
| 3 | [Taste and finish](taste-finish-roadmap.md) | 10 open, 19 done; steps 1 to 5 built, waiting for their measure | The autonomy goal. Run the measure first: it says whether the limit is the tools or the prompt, and sets the baseline before web scenes |
| 4 | Platform: server, accounts, billing ([accounts](accounts.md), [billing](billing.md)) | in progress; payment provider last | Needed for the commercial launch under FSL-1.1-ALv2 |
| 5 | [Installed plugins](installed-plugins-roadmap.md) | 5 open, 26 done; the marketplace waits for the API | Unblocked by 4 |
| 6 | [Sound parity](sound-parity-roadmap.md) | 29 open, 0 done | Catch-up on a competitor: useful, not blocking |
| 7 | Loose ends | [Generation](generation-roadmap.md) 2, [Editing](editing-roadmap.md) 2, [Sound](sound-roadmap.md) 2, [Components](components-roadmap.md) 1, [Packs](packs-roadmap.md) 1 (decision 4), [Plugins](plugins-roadmap.md) 1 | Small leftovers. The Plugins one is the isolation work of item 1 |

## Done

[Motion](motion-roadmap.md), [Performance](performance-roadmap.md), [Polish](polish-roadmap.md), [Shorts](shorts-roadmap.md), [Taste](taste-roadmap.md): no open box. Performance should be re-read once web scenes exist, since a scene adds a render path the load cases do not cover.

## Rules

- A roadmap moves up when another one needs it, and down when it only catches up.
- Safe projects comes before anything that runs code a user did not write.
- The macOS download stays withheld until Apple signs the app (`WITHHELD` in `apps/desktop/downloads.ts`): a launch item, not a roadmap.
