# Strategy evaluation — November 7, 2026

## Live market trial recovered from the previous run

The log in the prior session's scratch directory shows two completed matches
after the market learner was introduced:

| Match | Place | Score | Bought tiles | Spent |
|---|---:|---:|---:|---:|
| 43198 | 1/6 | 119 | 18 | 212 |
| 43205 | 4/6 | 75 | 13 | 163 |

Match 43212 was interrupted in the recovered log. Its final database score
cannot be treated as a complete strategy trial. Two complete games are too
few to conclude whether live learning improves placements.

## Reliability fixes

The old market learner assigned phases using callback arrival order, and
counted re-delivered results again after reconnects. The shared learner now
deduplicates auction identities and sorts auctions within each match before
assigning phases. It retains up to 60 prices per class/phase and requires
eight samples before replacing the static fallback.

The simulator previously never supplied learned prices to the bidding
strategy. `--live-market` now carries the same learner across matches in
each independent variant trial. It learns only from completed auctions;
each variant starts with a fresh learner. Unlike the production subscription,
the simulator observes only its own sequence of matches, so it warms up more
slowly and cannot model changes in the real field by itself.

## Screening experiment

Command: `node --import tsx src/sim/run.ts --leaders --live-market --matches 40 --ab`

All variants use the same 40 seeds and rotate seats. Opponents are five
calibrated Leader models. These are simulated results, not live win rates.

| Variant | Average score | Average place | Top three |
|---|---:|---:|---:|
| Current settings with learned prices | 83.8 | 2.40 | 80% |
| No market floor | 82.1 | 2.50 | 78% |
| No price pushing | 84.1 | 2.42 | 78% |
| Lighter spending reserves | 80.7 | 2.60 | 78% |
| Cash out at 32 rather than 40 | 75.0 | 2.95 | 65% |
| Market multiplier 1.15 | 84.0 | 2.38 | 75% |
| Market multiplier 1.30 | 84.5 | 2.30 | 75% |
| Multiplier 1.30, tie bump 6 | 83.0 | 2.45 | 78% |

None of the parameter changes improved the requested top-three rate in
this screening run. Keep the existing parameters pending stronger evidence.

## Fresh-seed check

80 matches per mode, `--leaders --seed 2 --variant base`, with and without
`--live-market`. This seed block was not used in the screening run.

| Mode | Average score | Average place | Top three |
|---|---:|---:|---:|
| Static fallback prices | 85.0 | 2.15 | 69/80 (86.25%) |
| Learned prices | 83.6 | 2.31 | 67/80 (83.75%) |

The live method did not outperform static prices in this check. The
two-game difference is small and does not establish a reliable disadvantage
either. Retain existing bidding parameters and treat live learning as an
experiment, not a proven placement improvement. The production learner's
broader feed and a changing real market remain untested by this stationary
opponent model. No live process was started or restarted in this review.

Validation: all 17 tests pass, TypeScript checking passes, and
`git diff --check` passes. The new regression test covers reversed snapshot
delivery, duplicate results, and fallback cells without enough samples.
