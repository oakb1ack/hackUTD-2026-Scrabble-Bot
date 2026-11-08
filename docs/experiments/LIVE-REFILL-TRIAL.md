# Live refill trial

Experimental refillBonus=2; face baseline, reserves [28,16,0,0,0], word timing and premium bidding unchanged. Baseline eight-game results: LIVE-TRIAL.md.

Completed: 8/8. Only ended matches after 45263 are included.
The transition game and all earlier games are excluded. Settings stay fixed during the trial.
Tied scores share a place. Different opponent lineups and starting racks prevent a controlled causal comparison.

| Trial game | Match ID | Place | Score | Purchases | Spent | Cash left | Words |
|---|---:|---:|---:|---:|---:|---:|---|
| 1/8 | 45270 | 5/6 | 61 | 13 | 135 | 26 | ABSORBER (36), ANILINE (21), GUT (4) |
| 2/8 | 45277 | 5/6 | 58 | 10 | 138 | 20 | WARLIKE (42), DAWN (12), GUT (4) |
| 3/8 | 45284 | 4/6 | 61 | 11 | 143 | 18 | OVERTIMING (48), FAG (7), TAV (6) |
| 4/8 | 45291 | 6/6 | 49 | 7 | 107 | 42 | THRIVEN (39), LAWN (10) |
| 5/8 | 45299 | 2/6 | 90 | 14 | 183 | 7 | CHIEFER (45), FANTODS (33), NOOK (12) |
| 6/8 | 45307 | 4/6 | 71 | 11 | 147 | 24 | VERMEIL (36), WAGONER (33), LI (2) |
| 7/8 | 45315 | 2/6 | 79 | 16 | 165 | 14 | DISOBEYS (42), ANTILEFT (33), AE (2), OE (2) |
| 8/8 | 45322 | 4/6 | 67 | 14 | 160 | 7 | DEFERRING (42), PIVOT (20), AH (5) |

Wins: 0/8. Top three: 2/8.
Average score: 67.0; average place: 4.00.
Average purchases: 12.0; spending: 147.2; cash left: 19.8.

Midgame rebuilding: 2.00 purchases in the ten offers following a 20+ point word (9 full windows with cash at least 25).
This is a diagnostic; it includes only payouts with ten remaining offers and at most 37, and does not infer rack size.

The collector only observes games; it does not start, stop, or configure the bot.

## Comparison and decision

| Measure | Previous eight games | Refill +2 eight games |
|---|---:|---:|
| Wins | 2/8 | 0/8 |
| Top three | 4/8 | 2/8 |
| Average score | 71.1 | 67.0 |
| Average place | 3.63 | 4.00 |
| Purchases per game | 11.6 | 12.0 |
| Spending per game | 151.0 | 147.2 |
| Cash left | 20.1 | 19.8 |

The small purchase increase did not translate into better scores or
placements. This is an unpaired comparison with different opponents and
starting racks, so it does not prove a causal disadvantage. There is no
positive evidence to retain the change. After the eighth completed game,
the live bonus was restored to zero; the bot continues on the previous
baseline. Match 45329 is a post-checkpoint transition and is not part of
the eight-game results.

Simulation screening and fresh-seed checks are in
[REFILL-EVALUATION.md](REFILL-EVALUATION.md). The mixed simulation results
were treated as grounds for an experiment, not evidence of a winning policy.

A separate next candidate is cashing 39-point long words earlier. In this
trial, THRIVEN (39) was available around bag 49 but held until bag 30 for
the same payout. That timing rule was deliberately unchanged here. It
requires its own simulation and live test; it has not been enabled.
