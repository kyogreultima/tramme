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

The effort stays at high by default until the films of the medium series are judged at least as good as the baseline's: a cost that drops while the films get worse is not a saving.

## Films to watch

The projects stay on the trial server (`.wrangler/state-bench`, port 8790),
`run.json` of each run holds its link.
