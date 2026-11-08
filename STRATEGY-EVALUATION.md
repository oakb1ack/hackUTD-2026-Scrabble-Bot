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

## Live test of c0822d4

Started the authenticated scrabblemaxxing bot with the repaired learner.
The log is `/private/tmp/scrabble-live-market.log` (not committed).

| Match | Place | Score | Balance left |
|---|---:|---:|---:|
| 43307 | 4/6 | 49 | 27 |
| 43314 | 4/6 | 74 | 43 |
| 43321 | 4/6 | 70 | 20 |

Mean score 64.3; mean balance left 30; zero top-three finishes in this
three-game sample. This does not demonstrate a placement improvement.
In 43307 we bought 11 tiles versus the winner's 18, spent 122 versus
214, and bought average face value 1.27 versus 2.44. Lost premiums included
Q at our bid of 23, H at 22, and X at 25. Other premiums were skipped or
underbid. The priority for the next experiment is useful purchase volume
and reserve/budget behavior, rather than simply raising the market
multiplier (which did not improve top-three consistency in screening).

The earlier statement about not restarting the bot applies to the offline
review above; this subsequent live test explicitly started the bot. It
remained running after these three results were collected.

## Follow-up opponent review and purchase-volume experiment (18:38 CST)

The public database retains only a recent slice. `scripts/competitors.py` now
filters **ended** matches before counting scores, purchases, and plays; its
old report mixed live, incomplete scores into completed-game averages. It
also reports seven-plus-letter play share and final cash. CLI query failures
now fail visibly instead of producing an apparently empty report.

In the 00:37 UTC snapshot (36 completed matches), our six retained games
averaged 60.7 points, 9.7 purchases, and 42 cash left; 50% of plays were
seven-plus letters. `gas` averaged 111 points, 18.8 purchases, 16 cash left,
and 55% seven-plus-letter plays. Samples are small and these are different
opponent lineups. One of our games, 45078, was interrupted by a process exit
and resumed late, so this is a scoreboard comparison, not a clean strategy
trial. Public actions reveal behavior; opponents' source code is unavailable.

The dictionary search already considers the full bundled legal word list
and uses the exact length multipliers. Longer alone is not the goal:
ZEBRAS (six letters) earns 42 versus RETAINS (seven) at 21. A new regression
test verifies this choice. The purchase/score gap is larger than the gap in
long-word play share. In match 45072, our AIRGLOW (33) plus three small
endgame words lost 43-105 to JAYVEE (47), CLOZES (42), KEEF (16); the winner
bought 13 tiles at average face 2.85 versus our nine at 1.67.

### Controlled parameter screening

60 matches per variant, seed block 1, five Leader opponents and learned
market prices. Seats rotate and each variant starts a fresh learner.

| Variant | Average score | Top three |
|---|---:|---:|
| Previous production settings | 81.9 | 76.7% |
| Remove phase reserves | 78.8 | 68.3% |
| Face-value baseline retained (`mcMode=0`) | 84.9 | 75.0% |
| Face baseline + reserves 28/16/0/0/0 (`faceLiquid`) | 83.5 | 80.0% |
| Raise marketA from 8 to 10 | 70.8 | 55.0% |
| Raise marketA + lighter reserves | 69.0 | 56.7% |

The screening process was stopped after these six completed trials; the
older variants following them were not rerun in this experiment.

### Fresh-seed validation

100 matches per variant, seed block 3, five Leaders, learned market.

| Variant | Average score | Average place | Wins | Top two | Top three | Tiles | Spent |
|---|---:|---:|---:|---:|---:|---:|---:|
| Previous settings | 82.5 | 2.45 | 33% | 59% | 75% | 13.9 | 168 |
| faceLiquid | 83.8 | 2.23 | 39% | 61% | 84% | 14.1 | 172 |

These are model results, not live win rates. They support a live trial of
faceLiquid rather than raising every glue bid or dropping all reserves.
The unchanged live policy won match 45097 with 109 (HEREAWAY 51, FOOTWEAR
42, AFRIT 16), 17 purchases, and 30 cash left; a single win does not settle
the comparison.

### Agent review and simulator correction

Parallel reviews found two decision defects, implemented behind separately
selectable flags for comparison:

- `reserveAsCap`: constrain the final bid to balance minus the reserve,
  instead of rejecting an affordable smaller bid because the raw valuation
  exceeds the available money. The cap also covers later bid boosts.
- `longWordFallback`: if the highest-reward short word would be held,
  consider an eligible long word. For rack ETXDYATOTAG at bag 25, the old
  policy holds DEOXY (32) while ignoring TOGATED (27), which qualifies for
  the long-word midgame play rule.

The 60-match seed-3 screening (before the timing correction) gave 86.7%
top-three for faceLiquid and both fixes, with average place 2.23 and 2.20
respectively. This is a regression screen, not proof that the fixes improve
placement. Regression tests cover the exact decision failures.

The simulator previously exposed a bag count one above the server's count
and allowed external bots to play after the final auction settlement. It
now excludes the current offer, exposes the next offer as already drawn
when choosing words, and prevents post-match external word plays. Built-in
server bots retain their automatic word submission inside the final
settlement. Five regression tests cover these timing distinctions.

Remaining modeling limits: opponents are inferred models; the estimated
bag composition subtracts both current holdings and public auctioned tiles,
so acquired tiles can be counted twice and spent starting tiles can appear
available again. Auction-result processing now deduplicates before updating bag and
purchase counters, extending the market learner's existing replay protection.
Correcting the bag-composition estimate remains a separate state-tracking
change requiring evaluation.

### Final comparison using corrected timing

100 fresh matches per variant, seed block 5, five Leader opponents,
learned market prices. Reproduce from `bot-starter/`:

```sh
npm run sim -- --leaders --live-market --matches 100 --seed 5 --ab --variants base,faceLiquid,flowLong
```

| Variant | Average score | Average place | Wins | Top two | Top three |
|---|---:|---:|---:|---:|---:|
| Previous production (`base`) | 83.5 | 2.23 | 42% | 66% | 78% |
| Face baseline + lighter reserves (`faceLiquid`) | 85.0 | 2.03 | 41% | 70% | 90% |
| faceLiquid + both decision fixes (`flowLong`) | 84.3 | 2.04 | 46% | 74% | 84% |

Selected **faceLiquid** for the live top-three consistency trial. Production
`PARAMS` now uses `mcMode=0` and phase reserves `[28,16,0,0,0]`. The two
new decision flags remain off; their experiments are available independently.
The previous production profile is explicitly pinned in simulator `base`,
while `current` uses the current production defaults. Future ranking should
be checked across more opponent types and seeds; these model outcomes do
not establish live improvement.

The bot was restarted at 00:45:18 UTC (18:45 CST) with the saved credential;
PID 56524, log `/private/tmp/scrabble-live-market.log`. It authenticated as
bot 182 and resumed bidding. Match 45140 had already begun under the old
process and is a mixed-policy transition game; exclude it from clean live
comparisons. Startup logs now include timestamp and strategy parameters;
bid logs include rack, cash, and visible bag count. Auction results are
deduplicated before updating all live bookkeeping.

Validation after changing defaults: **26 tests pass**, TypeScript checking
passes, and `git diff --check` passes. The early Z regression bound is now
the observed early-market median of 32; the selected face baseline bids 31
in that fixture, versus the old replacement estimate's sub-30 bid.

## Eight-game live checkpoint

The user requested eight complete games with settings held fixed. These
were matches 45147, 45154, 45161, 45168, 45176, 45183, 45190, and 45197;
transition match 45140 is excluded. Places: **1, 3, 5, 3, 6, 1, 4, 6**.
Scores: **112, 77, 52, 77, 54, 80, 72, 45**.

- Wins 2/8; top three 4/8; average place 3.63.
- Average score 71.1, purchases 11.6, spending 151, unused cash 20.1.
- The previous eight complete logged games averaged 72.1 points. Different
  racks and lineups prevent causal comparison; this trial supplies no
  evidence that the selected settings improved live scores.
- The simulator's 90% top-three result did not carry over to this sample.

The strongest repeated issue was losing common-letter auctions while cash
was available, especially after a word payout. Reserve/cash-out dead zones
and holding 39-point words also occurred. Recommend an isolated experiment
with slightly stronger bids for useful midgame refill letters, rather than
trying to exhaust all cash or increasing every bid. No further policy
changes were made; the bot continues running pending the user's decision.
Full results, examples, and limitations are in [LIVE-TRIAL.md](docs/experiments/LIVE-TRIAL.md).

## Follow-up: targeted refill bonus

Implemented a bounded bonus for suitable new common letters on short,
funded midgame racks. Compared bonuses 2/3/4 against the exact prior live
profile, then fresh-validated +2 in ordinary and stressed common-letter
markets. Simulation results were mixed, not a proven improvement.

The authorized eight-game real trial of +2 produced places 5,5,4,6,2,4,2,4
and scores 61,58,61,49,90,71,79,67: zero wins, 2/8 top three, average score
67.0. Purchases increased slightly to 12.0 while scores and placements
failed to improve relative to the preceding eight-game sample. Settings
remained fixed for all eight; the bonus was then disabled and the previous
baseline restored. The bot remains running.

See [REFILL-EVALUATION.md](docs/experiments/REFILL-EVALUATION.md) for exact simulations and
[LIVE-REFILL-TRIAL.md](docs/experiments/LIVE-REFILL-TRIAL.md) for each trial number, match ID,
words, purchases, spending, and cash. All 29 strategy/simulator tests and
TypeScript checking passed; snapshot checks reconcile all eight matches.

## Parallel and interleaved comparison workflow

Added shared named profiles, four-worker offline comparisons, and bounded
per-match live rotation. A 40-seed screen compared baseline, cash39,
crunch24, and reserveCap concurrently in normal and stressed price models.
No clear winner emerged. An eight-game interleaved baseline/reserveCap pilot
then gave baseline 79.5 points and 3/4 top-three, versus reserve caps 74.75
and 2/4; both won once. Reserve caps had a better average place, but these
mixed four-game estimates do not establish a winner. The runtime
successfully returned to baseline automatically after game eight.

The offline model's rules are useful for correctness checks, but its
opponent and timing approximations do not support calibrated live win-rate
claims. RNG cannot be assigned a causal percentage from these unmatched
live samples. Full results and game IDs: [EXPERIMENT-WORKFLOW.md](docs/experiments/EXPERIMENT-WORKFLOW.md).
All-eight refill postmortem: [FAILURE-ANALYSIS.md](docs/experiments/FAILURE-ANALYSIS.md).

## Four-profile parallel screen — seed 31

Ran 80 simulated matches per profile in parallel for each market condition, using five calibrated Leaders and learned market prices. Each profile used the same seed block and rotating seats. The 1.2 common-letter price scale is a synthetic stress test. Logs and full metrics are in `/private/tmp/scrabble-compare-wvlw2d62/summary.json`.

| Profile | Ordinary score | Avg rank | Top two | Top three | Stress score | Stress rank | Stress top three |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 81.5 | 2.26 | 65% | 83% | 74.2 | 2.77 | 69% |
| Cash at 39 | 79.9 | 2.45 | 58% | 80% | 72.8 | 2.88 | 70% |
| Cash below 24 | 78.9 | 2.41 | 54% | 81% | 73.2 | 2.86 | 64% |
| Reserve caps | 82.3 | 2.27 | 64% | 85% | 74.6 | 2.77 | 66% |

Reserve caps and baseline were effectively tied across these modeled conditions: reserve caps had a small ordinary-market edge, while baseline had more top-three finishes under the stress case. Earlier cash-out profiles mostly trailed baseline. The completed live comparison below favored reserve caps, so `reserveAsCap=1` is now the provisional default. The older baseline remains available as a pinned control. The live sample is small and does not establish a calibrated win-rate advantage.

Detailed experiment records are indexed in [docs/experiments/README.md](docs/experiments/README.md).

## Follow-up strategy screen — seed 43

Added four reserve-cap candidates based on the live failure review: release a 39-point word earlier, consider a qualifying long-word alternative when the top short word would be held, combine those changes, and cash out sooner at low balance. Compared each against the reserve-cap control for 80 simulated matches in both ordinary and 20%-higher glue-price markets. Five Leaders, shared seeds and rotating seats; metrics are screening results.

| Profile | Ordinary score | Rank | Top three | Stress score | Rank | Top three |
|---|---:|---:|---:|---:|---:|---:|
| Reserve-cap control | 86.2 | 2.13 | 83% | 79.5 | 2.48 | 74% |
| Cash at 39 | 83.7 | 2.23 | 81% | 78.3 | 2.60 | 73% |
| Long-word fallback | 86.2 | 2.13 | 83% | 78.9 | 2.51 | 73% |
| Cash at 39 + fallback | 83.7 | 2.23 | 81% | 77.7 | 2.64 | 71% |
| Cash below 24 | 83.7 | 2.20 | 81% | 76.6 | 2.66 | 71% |

None beat the control. The 39-point release and low-cash cash-out weakened the results; the fallback was neutral in the ordinary screen and slightly worse in the stress case. Keep these controls available for future experiments, but do not promote them or spend live games on them yet. Full logs: `/private/tmp/scrabble-compare-2iwuybup/summary.json`.

## Live follow-up — reserve caps

Alternated baseline and reserve-cap settings over 12 matches, six per profile. Baseline averaged 66.2 points, place 4.00, and one top-three finish. Reserve caps averaged 83.5 points, place 2.83, and four top-three finishes. Reserve caps bought 13.5 tiles per game versus 11.2. These are different racks and opponent lineups; treat the result as support for a provisional default, not proof of causation. Full results: [docs/experiments/LIVE-RESERVECAP-TRIAL.md](docs/experiments/LIVE-RESERVECAP-TRIAL.md).

## Current field review and premium-bid screen — Nov 8 UTC

The refreshed public report now sorts by win share and shows top-three rate as well as score: [COMPETITORS.md](COMPETITORS.md). In the latest 527 completed-match window (IDs 45389–45927), the strongest established entries were LexForge-Cash-v1 at 49% wins in 42 games, aipom at 48% in 43, and Lbender at 38% in 50. LexForge-Reward54Ack-v1 showed 75% but only across four games. Our bot was at 11% wins, 55% top three, 77.5 average score in 51 games. Small and changing samples make the short-term percentages noisy.

Against Lbender, our purchase count was similar, but we spent less and bought a less valuable mix: 13.0 tiles and 157 currency at average face 1.76, versus 12.2 tiles and 169 currency at face 2.44. Lbender's 4+ point share was 25% versus our 18%. The initial candidate was a rack-scarcity bonus on a premium only when it would bring our rack near a 22% premium share; two strengths and a 10% premium-market lift were screened against reserve caps.

| Profile | Ordinary score / rank / top three | Stress score / rank / top three |
|---|---:|---:|
| Reserve-cap control | 84.2 / 2.07 / 91% | 79.6 / 2.35 / 79% |
| Premium scarcity +3 | 83.8 / 2.08 / 90% | 77.0 / 2.52 / 76% |
| Premium scarcity +5 | 83.2 / 2.15 / 87% | 76.7 / 2.57 / 73% |
| Premium market ×1.10 | 84.0 / 2.08 / 90% | 79.2 / 2.41 / 78% |
| Scarcity +3 and market ×1.10 | 83.6 / 2.12 / 88% | 76.5 / 2.58 / 75% |

80 matches per profile and market, five Leader opponents, seed 53. No premium-bid candidate beat the control. Keep the targeted bonus off. The next screen tests waiting for higher word rewards (45 or 50 rather than 40), with reserve-cap bidding held constant. Full logs: `/private/tmp/scrabble-compare-k325kjxs/summary.json`.

## Fresh-seed check: larger word payouts — seeds 61 and 71

The first screen's hold45 and hold50 candidates repeated on a fresh seed. Each percentage is based on 120 matches in seed 61 or 160 in seed 71, with five Leaders and rotating seats; stress raises common-letter prices 20%.

| Seed / market | Profile | Avg score | Avg rank | Top two | Top three |
|---|---|---:|---:|---:|---:|
| 61 ordinary | Reserve cap | 84.1 | 2.27 | 63% | 83% |
|  | Hold 45 | 85.2 | 2.24 | 65% | 83% |
|  | Hold 50 | 85.8 | 2.20 | 67% | 82% |
| 61 stress | Reserve cap | 76.8 | 2.55 | 57% | 70% |
|  | Hold 45 | 78.7 | 2.47 | 59% | 73% |
|  | Hold 50 | 80.2 | 2.49 | 59% | 73% |
| 71 ordinary | Reserve cap | 82.5 | 2.16 | 68% | 88% |
|  | Hold 45 | 84.8 | 2.07 | 68% | 89% |
|  | Hold 50 | 85.6 | 2.06 | 69% | 88% |
| 71 stress | Reserve cap | 76.3 | 2.68 | 56% | 76% |
|  | Hold 45 | 78.3 | 2.53 | 59% | 80% |
|  | Hold 50 | 79.5 | 2.49 | 59% | 78% |

Holding until 50 gives the highest average score and consistently improves rank and top-two rate; hold45 gives the strongest top-three rate in the stress checks. I added a 54-point profile because a recent winning bot is named `LexForge-Reward54-v1`; the name suggests a threshold, but does not prove the implementation. That candidate is being screened before we choose the live challenger. No default change yet. Logs: `/private/tmp/scrabble-compare-oatupkcg/summary.json` and `/private/tmp/scrabble-compare-v55y1k0y/summary.json`.

## Reward54 fresh-seed validation — seed 83 and 89

The profile named after the leaderboard version remains ahead in average score and rank across both seeds and markets. It improves top-three rate in the stress case, while ordinary-market top-three is 1–2 points lower than the control. Hold50 is close. These model results justified a bounded live comparison, not an immediate default change.

| Seed / market | Profile | Avg score | Avg rank | Top two | Top three |
|---|---|---:|---:|---:|---:|
| 83 ordinary, 120 matches | Reserve cap | 84.2 | 2.07 | 68% | 90% |
|  | Hold 50 | 88.8 | 1.95 | 73% | 88% |
|  | Reward 54 | 89.3 | 1.94 | 74% | 88% |
| 83 stress, 120 matches | Reserve cap | 76.0 | 2.73 | 50% | 68% |
|  | Hold 50 | 77.8 | 2.54 | 60% | 73% |
|  | Reward 54 | 78.6 | 2.52 | 60% | 73% |
| 89 ordinary, 160 matches | Reserve cap | 85.9 | 2.04 | 71% | 88% |
|  | Hold 50 | 87.3 | 2.03 | 73% | 87% |
|  | Reward 54 | 87.7 | 2.01 | 71% | 87% |
| 89 stress, 160 matches | Reserve cap | 77.8 | 2.44 | 61% | 76% |
|  | Hold 50 | 80.7 | 2.33 | 63% | 80% |
|  | Reward 54 | 81.0 | 2.29 | 65% | 82% |

The bounded live comparison completed with six matches per profile, excluding the transition through match 46261. Reward54 averaged 90.2 points and place 2.33, versus 82.2 and place 2.50 for reserve cap; it had one win versus two, and five top-three finishes versus four. This small sample supports a further live pilot but is not enough to replace the reserve-cap default by itself. Keep reserve cap as the tournament profile until more live evidence is available. Full results: [docs/experiments/LIVE-REWARD54-TRIAL.md](docs/experiments/LIVE-REWARD54-TRIAL.md).

Tournament 1 is ended and there is no active registration right now. The bot's `TOURNAMENT_ID` registration path and launch command are documented in the root README; set the ID only when registration for a new tournament is open.
