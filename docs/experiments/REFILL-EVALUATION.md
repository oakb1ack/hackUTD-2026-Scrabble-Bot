# Targeted refill experiment

The previous eight-game live checkpoint averaged 71.1 points and finished
in the top three four times. It showed long purchase droughts on short
racks despite available cash. This experiment changes only bidding for
suitable common letters during rebuilding.

`refillBonus` adds up to four currency before ordinary spending constraints:

- Face value at most three; no existing copy of the offered letter.
- Rack holds at most six tiles, with at least 25 cash available.
- Visible bag contains 9–36 tiles; endgame dumping is unchanged.
- A letter must move vowel share closer to 40%, or be a flexible common
  consonant when at least a third of the rack consists of vowels.

Premium bids, phase reserves, word thresholds, and optional decision fixes
remain unchanged. The initial implementation defaults to zero while screening
bonuses of two, three, and four against the exact previous live profile.

The simulator also supports `--glue-scale 1.2` as a stress case. It increases
Leader/Spender common-letter price tables by 20% while leaving premiums
unchanged. It is a sensitivity check motivated by observed purchase stalls,
not a fitted model or a claim that every real price increased by 20%.

Screening: 40 matches per variant, seed 11, five Leader opponents, learned
market prices; compare trialBaseline/refill2/refill3/refill4 in ordinary and
stress conditions. Fresh-seed validation follows candidate selection.

The live trial will collect eight completed games at fixed settings after
excluding the transition game. `scripts/live_trial.py` archives completed
public data as it arrives, before server retention removes it, and writes
a report after every result. It does not control the bot process.

Implementation checks: 29 tests pass, TypeScript checking passes. The live
collector passed a real one-game smoke check using the previous policy.

## Screening results

40 matches per profile, seed 11, five Leaders, market learning on.

| Market | Profile | Score | Average place | Top two | Top three | Purchases |
|---|---|---:|---:|---:|---:|---:|
| Ordinary | Baseline | 86.4 | 1.95 | 80.0% | 90.0% | 13.9 |
| Ordinary | +2 | 85.4 | 2.20 | 65.0% | 87.5% | 13.9 |
| Ordinary | +3 | 85.2 | 2.25 | 65.0% | 82.5% | 13.9 |
| Ordinary | +4 | 84.7 | 2.25 | 70.0% | 77.5% | 13.9 |
| Stress | Baseline | 80.6 | 2.23 | 65.0% | 87.5% | 11.1 |
| Stress | +2 | 80.4 | 2.33 | 57.5% | 90.0% | 11.5 |
| Stress | +3 | 79.7 | 2.35 | 62.5% | 87.5% | 11.5 |
| Stress | +4 | 78.5 | 2.33 | 60.0% | 85.0% | 11.3 |

No variant established an improvement. Selected +2 for fresh validation as
the least disruptive experiment, not a simulator-proven winning policy.

## Fresh-seed validation

80 matches per profile per market, seed 13, same Leader models.

| Market | Profile | Score | Average place | Top two | Top three | Purchases |
|---|---|---:|---:|---:|---:|---:|
| Ordinary | Baseline | 78.8 | 2.29 | 61.25% | 69/80 (86.25%) | 13.1 |
| Ordinary | +2 | 78.8 | 2.34 | 60.0% | 66/80 (82.5%) | 13.3 |
| Stress | Baseline | 74.3 | 2.70 | 51.25% | 56/80 (70.0%) | 10.2 |
| Stress | +2 | 75.8 | 2.64 | 53.75% | 55/80 (68.75%) | 10.7 |

The rule bought slightly more letters. Stress score/average place improved
modestly, while ordinary placement and top-three rates did not improve.
The user requested simulation followed by real games. Given the known
model mismatch, the +2 policy is being tested as a bounded information-
gathering trial; these results do not justify claiming a performance gain.

Reproduce validation from `bot-starter/`:

```sh
npm run sim -- --leaders --live-market --matches 80 --seed 13 --ab --variants trialBaseline,refill2
npm run sim -- --leaders --live-market --matches 80 --seed 13 --ab --variants trialBaseline,refill2 --glue-scale 1.2
```

## Live experiment

Started bot PID 58269 with `BOT_REFILL_BONUS=2`; startup logs verify effective
parameters. Baseline source defaults remain unchanged (`refillBonus=0`).
The trial excludes every match through transition 45263 and records the
next eight completed matches in [LIVE-REFILL-TRIAL.md](LIVE-REFILL-TRIAL.md).
The collector stores full public auction, word, and participant snapshots
at `/private/tmp/scrabble-refill2-trial.json`, and measures ten-offer purchase
windows following funded midgame word payouts. Bot log:
`/private/tmp/scrabble-live-refill2.log`. Skipped bids now log balance, rack,
and bag count without changing retry behavior.

No live decision rules will change during the eight-game checkpoint.

### Interim diagnosis (first four completed live games)

The refill rule activated as designed but did not produce a new large-word
cycle in the first three games. Thirteen offers qualified; six were won.
Those wins are not proven incremental wins caused by the bonus. Subsequent
uses of the purchased letters were small cleanup plays (GUT, DAWN, FAG).
The rule often stayed off because the rack exceeded six tiles, the offered
letter was already held, cash was below 25, or the vowel-balance gate failed.

Holding rules remain a separate bottleneck:

- 45284 had FIGMENT (39) at bag 44/cash 31, but waited to bag 30 and
  played OVERTIMING (48). The extra nine points came with a long delay.
- 45291 had THRIVEN (39) at bag 49/cash 42 and waited to bag 30 for the
  same 39 points. A threshold of 39 would release the earlier word.
- 45277 held WALKED (35) at cash 28. Early K and W cost 30 and 18.
  R could unlock WARLIKE (42), but an immediate gain of 14 fell below
  the reserve-bypass threshold of 15. An affordable capped bid would
  be possible under the separate reserve-cap experiment; winning is unknown.

These observations suggest a separate word-timing experiment if refill
fails. They do not prove a counterfactual score improvement, and no timing
or reserve rules were changed during this live trial.

## Completed eight-game live result

| Trial game | Match ID | Place | Score |
|---|---:|---:|---:|
| 1/8 | 45270 | 5/6 | 61 |
| 2/8 | 45277 | 5/6 | 58 |
| 3/8 | 45284 | 4/6 | 61 |
| 4/8 | 45291 | 6/6 | 49 |
| 5/8 | 45299 | 2/6 | 90 |
| 6/8 | 45307 | 4/6 | 71 |
| 7/8 | 45315 | 2/6 | 79 |
| 8/8 | 45322 | 4/6 | 67 |

Zero wins; two top-three finishes; average score 67.0 and place 4.00.
Purchases averaged 12.0 versus 11.6 in the previous eight games, but scores
fell from 71.1 to 67.0 and top-three finishes from 4/8 to 2/8. Average cash
left barely changed (20.1 to 19.8). The nine fully observed, funded midgame
post-word windows averaged two purchases in the following ten offers.
There is no corresponding baseline-window measurement, so do not claim
that this diagnostic improved relative to the old policy.

The test supplied no evidence of a useful performance gain. Different
opponents and racks prevent a causal conclusion, but the change has not
earned promotion. After all eight games completed, restored the previous
baseline with `BOT_REFILL_BONUS=0` (PID 68599), logging to
`/private/tmp/scrabble-live-baseline-restored.log`. The bot continues playing.
Post-checkpoint match 45329 is a mixed-policy transition, outside the sample.

All eight archived snapshots contain 68 auctions, and their final cash
reconciles to 100 + score - spending. Full game details and the comparison
are in [LIVE-REFILL-TRIAL.md](LIVE-REFILL-TRIAL.md).

A separate next experiment would lower the immediate long-word payout
threshold from 40 to 39, rather than spend more indiscriminately. That
change has not been implemented or enabled in this trial.
