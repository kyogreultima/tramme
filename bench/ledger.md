# Ledger of the bench runs

What each series of `bench/run.ts` cost, brief by brief, and what changed
between two series. Costs are dollars at the API's prices (`bench/prices.ts`),
read from Claude Code's transcripts: the quota of a subscription is spent in
proportion, roughly. One run per brief: a single brief can move by half either
way from one run to the next, so a change is judged on the four together, and
on the films (watched side by side), never on the cost alone.

All runs: Claude Opus 5.5 through the companion, the changes applied without
the user, a cap of $6 per run.

## Series

| Brief | baseline | levers | medium |
|---|---|---|---|
| `logo-sting` (5 s logo intro, 16:9) | $2.17, 35 req., 14.6 min | $0.98, 22 req., 3.9 min | $0.69, 25 req., 3.8 min |
| `kinetic-quote` (12 s kinetic type, 9:16) | $1.71, 31 req., 7.1 min | $2.65, 44 req., 9.2 min | $0.84, 20 req., 4.3 min |
| `data-short` (15 s data film, 16:9) | $4.82, 98 req., 17 min | $3.01, 51 req., 14.2 min | $1.35, 31 req., 5.6 min |
| `fitness-app` (15 s vertical ad) | $6.10 (stopped at the cap), 98 req., 33.2 min | $3.06, 66 req., 11.5 min | $2.73, 64 req., 10.4 min |
| In all | $14.80 (at least) | $9.70 (−34 %) | $5.61 (−62 %) |

- **baseline** (2026-11-11, editor at `22b8ff1`, effort high): before the cost work.
- **levers** (2026-11-11, editor at `4f12eb5`, effort high): the system prompt no longer
  changes with the project; guides read on demand (the fixed prompt 94 400 → 59 500
  characters); the inputs of the tools the prompt names in the cached prompt; lean
  vocabulary entries; checks in a proposal's answer; tool inputs repaired; images
  sized by their longest side; partial film plans, `write_file` with `find`,
  `remove-bg` with several images; scenes no longer re-read the plan.
- **medium** (editor at `c31137e`, effort medium): the levers, the checks in a
  proposal's answer cut to their first warnings, and the effort lowered to medium.

## Where the money goes

The share of each cost centre on `data-short`, before and after the levers:

| Cost centre | baseline | levers |
|---|---|---|
| fixed prompt read again by each request | $1.56 | $0.37 |
| output: thinking, text, tool inputs | $1.39 | $1.35 |
| the model's own output read again | $0.68 | $0.68 |
| text tool results read again | $0.67 | $0.37 |
| pictures read again | $0.45 | $0.20 |

After the levers, generating (the thinking above all) is half of the cost: the
effort is the next lever, and the one that can move the quality.

2026-11-11: the user judged the films of the medium series at least as good as the baseline's; medium became Claude's default effort.

## Films to watch

The projects stay on the trial server (`.wrangler/state-bench`, port 8790),
`run.json` of each run holds its link.

## Scores

Scored by the user on 2026-11-14, 1 to 10 against the marketing (Axiom) promo,
seeing which series made each film (not blind). The taste series (2026-11-12,
effort medium) is the one after the taste study.

| Brief | baseline | levers | medium | taste |
|---|---|---|---|---|
| `logo-sting` | 4 | 4 | 4 | 5 |
| `kinetic-quote` | 5 | 6 | 5 | 6 |
| `data-short` | 5 | 7 | 5 | 6 |
| `fitness-app` | 5 | 6 | 6 | 6 |
| Mean | 4.75 | 5.75 | 5.0 | 5.75 |
| `talking-head` | | | | 4 |

- The levers did not cost quality (5.75 against 4.75); the medium effort did
  (5.0 against 5.75 at high, the same code otherwise), and the taste series won
  it back at medium (5.75).
- No film reaches 8. The best is `data-short` with the levers (7).
- The talking head (a YouTube video edited from its rushes): "the level of an
  amateur trying the app". The timing and the use of some elements are wrong;
  even a simple edit has a level to reach.

### The talking videos on their words (2026-11-14, effort medium)

After the charter, the moments and the talking-video checks (`d08e22f`,
series `talking`), the same prompt, no asset given but the footage:

| Brief | Before | After | Cost | Time |
|---|---|---|---|---|
| `talking-head` | 4 | 7 | $3.97 | 19 min |
| `talking-head-2` (unseen) | | 7 | $3.21 | 15 min |

- Both runs set a charter and read the moments; neither holds still (the
  first `talking-head` held 3.5 s).
- The user's next lever: a precise brief and the assets it needs (logos,
  screens) given with the footage.
