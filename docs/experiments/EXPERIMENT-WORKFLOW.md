# Faster strategy comparisons

## What can run in parallel

Offline trials run concurrently as separate simulator processes, using the
same seeds and rotating seats for each strategy. The current runner limits
its default concurrency to four workers and stores complete logs and parsed
results for every job.

```sh
python3 scripts/compare_strategies.py --variants liveBaseline,cash39,crunch24,reserveCap --matches 40 --seed 17 --workers 4 --both-markets
```

The game module permits one bot per team and prevents a bot joining a second
running match (`spacetimedb/src/schema.ts` Team comment;
`spacetimedb/src/index.ts` joinLobby reducer). Versions reset rating/history;
they do not create independent live competitors. Multiple clients using the
same credential would act on the same bot.

Live comparisons therefore alternate strategies between matches. A profile
is assigned once and held fixed through that match, including reconnects
within the same process. New matches consume the next rotation slot. The
initial transition match is excluded. Assignments and exact parameters are
logged separately so completed results can be grouped by method.

## Four distinct mechanisms screened

- `liveBaseline`: current bidding and holding policy.
- `cash39`: play at 39 points rather than 40 (including early long words).
- `crunch24`: cash out a qualifying word below 24 currency rather than 14.
- `reserveCap`: cap bids at spendable money rather than rejecting the raw
  valuation when an affordable smaller bid could still be submitted.

Refill bonuses stay off in every profile. Premium and other controls remain
unchanged except where the named mechanism explicitly changes a rule.

## Parallel screen — seed 17

40 matches per job, five Leader opponents, learned prices. Ordinary and
20%-stronger common-letter markets are sensitivity scenarios. Percentages
below are rounded simulator output, not live forecasts.

| Profile | Ordinary score | Ordinary place | Ordinary top three | Stress score | Stress place | Stress top three |
|---|---:|---:|---:|---:|---:|---:|
| Baseline | 81.0 | 2.13 | ~83% | 79.4 | 2.50 | 75% |
| Cash at 39 | 79.4 | 2.38 | 75% | 79.7 | 2.52 | ~73% |
| Cash below 24 | 81.3 | 2.15 | 85% | 77.0 | 2.58 | ~73% |
| Reserve caps | 83.5 | 2.30 | ~83% | 81.1 | 2.40 | 75% |

No strategy clearly dominates. Reserve caps earned a direct live comparison
because of their observed skipped-bid mechanism and higher simulated scores,
not because the screen proves a better live win rate. Full logs and commands:
`/private/tmp/scrabble-multi-screen-17/summary.json`.

## Bounded live pilot

Started PID 69288 with `BOT_PROFILES=liveBaseline,reserveCap`,
`BOT_PROFILE_GAMES=8`, `BOT_REFILL_BONUS=0`. The initial snapshot established
transition cutoff 45378. Eight subsequent assigned matches alternate
baseline/reserve caps, four each. The ninth and later matches automatically
use baseline, without another process restart.

- Bot log: `/private/tmp/scrabble-interleaved17.log`.
- Assignments: `/private/tmp/scrabble-interleaved17-assignments.jsonl`.
- Archived public snapshots: `/private/tmp/scrabble-interleaved17-trial.json`.
- Live report: [LIVE-INTERLEAVED-TRIAL.md](LIVE-INTERLEAVED-TRIAL.md).

This is a short screening pilot, not enough observations per method to prove
superiority. Alternation reduces time-related market drift, but cannot pair
starting racks or guarantee the same opponents. Retain simulation for bug
checks and screening; judge live performance with uncertainty rather than
interpreting offline top-three percentages as calibrated predictions.

Validation: 34 tests and TypeScript checks pass. Tests cover stable
whole-match assignment, rotation, unknown profiles, and independent parameter
snapshots. The collector verifies profile labels and groups results; it
collects only matches explicitly listed in the assignment log.

## Completed interleaved pilot

| Game | Match ID | Profile | Place | Score |
|---|---:|---|---:|---:|
| 1/8 | 45387 | Baseline | 5/6 | 70 |
| 2/8 | 45396 | Reserve caps | 1/6 | 81 |
| 3/8 | 45405 | Baseline | 3/6 | 82 |
| 4/8 | 45413 | Reserve caps | 4/6 | 80 |
| 5/8 | 45421 | Baseline | 1/6 | 84 |
| 6/8 | 45429 | Reserve caps | 2/6 | 64 |
| 7/8 | 45437 | Baseline | 3/6 | 82 |
| 8/8 | 45445 | Reserve caps | 4/6 | 74 |

| Method | Games | Wins | Top three | Average score | Average place | Purchases |
|---|---:|---:|---:|---:|---:|---:|
| Baseline | 4 | 1 | 3 | 79.5 | 3.00 | 10.75 |
| Reserve caps | 4 | 1 | 2 | 74.75 | 2.75 | 11.25 |

No winner is established. Reserve caps had a slightly better average place
but lower score and fewer top-three finishes. Four observations per method
are too few, and different racks and lineups remain uncontrolled. Baseline
was retained; the runtime automatically returned to it at match 45452.
The same bot process remains running (PID 69288).

The pilot validates the workflow: eight games compared two methods rather
than requiring sixteen sequential games, each match kept one profile, and
the collector grouped results against exact logged parameters. All eight
snapshots have 68 auctions and cash reconciles to 100 + score - spending.
The two parameter sets differed only in `reserveAsCap`.

## Randomness and what these tests can establish

Starting letters, letter order, and random auction tie breaks can strongly
change one match. Opponent lineups add further variation, even when their
selection is driven by lobby timing rather than a random draw. For example,
64 points placed second in 45429, while 82 placed third in 45405. In the
earlier 112-point win 45147, starting J and K helped anchor JACKAROO (63).

No measured percentage of the result can currently be attributed to RNG.
Variation across different live games mixes random draws, opponents,
strategy, and timing. Offline shared seeds hold initial racks and letter
order constant within the simulated model; they do not remove model error.
Alternating live matches reduces time drift but cannot match the racks.
Do not promote a method from a single win or these four-game averages.

## Why the refill strategy failed to show improvement

See [FAILURE-ANALYSIS.md](FAILURE-ANALYSIS.md) for the all-eight-game audit:
35 of 186 midgame common offers qualified; 15 were observed wins, not proven
extra wins caused by the bonus. Total purchases rose only from 93 to 96.
Both samples produced 13 words paying at least 20, so the rule did not
establish an extra scoring cycle. It left holding delays and liquidity
interactions unchanged. Offline evidence had also been mixed before live
testing; simulation percentages are not calibrated live forecasts.
