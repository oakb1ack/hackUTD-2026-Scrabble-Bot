# Why the refill experiment did not improve results

The eight fixed-policy refill games averaged **67.0 points and two top-three
finishes**, versus **71.1 and four top-three finishes** in the previous eight.
Purchases rose from 93 to 96 tiles in total: 11.6 to 12.0 per game. These
were different games with different starting racks and opponents. This is
no positive evidence to retain the change, but it does not prove that the
bonus caused the worse results.

Sources: all eight archived games in
`/private/tmp/scrabble-refill2-trial.json`, their 544 logged auction decisions
in `/private/tmp/scrabble-live-refill2.log`, and the baseline in
[LIVE-TRIAL.md](LIVE-TRIAL.md). Full outcomes are in
[LIVE-REFILL-TRIAL.md](LIVE-REFILL-TRIAL.md).

## 1. The bonus reached only a small part of the problem

Rechecking the exact rule against each logged rack, balance, letter, and
bag count found **35 eligible offers, with 15 observed purchases**. All
35 had submitted bids. Eligibility does not guarantee a full two-point
increase after spending caps, or prove that a purchase would have been
lost without the bonus.

| Match | Score | Purchases | Offers eligible for bonus | Eligible offers won |
|---|---:|---:|---:|---:|
| 45270 | 61 | 13 | 4 | 2 |
| 45277 | 58 | 10 | 6 | 3 |
| 45284 | 61 | 11 | 3 | 1 |
| 45291 | 49 | 7 | 6 | 0 |
| 45299 | 90 | 14 | 3 | 2 |
| 45307 | 71 | 11 | 9 | 5 |
| 45315 | 79 | 16 | 1 | 0 |
| 45322 | 67 | 14 | 3 | 2 |
| **Total** | **536** | **96** | **35** | **15** |

There were 186 offers for one-to-three-point letters while the visible bag
contained 9–36 tiles. The eligibility checks excluded many of them:

- Cash below 25: 70 offers.
- Rack larger than six: 49 offers.
- Already holding that letter: 52 offers.

Those three counts overlap. Of the 73 offers passing all three checks,
another 38 failed the vowel-balance/consonant rule, leaving 35 eligible.
The rule favored additions moving vowel share toward 40%, or specified
common consonants when at least one third of the rack was vowels.

For example, 45270 bought an unboosted U and grew to seven tiles, switching
the bonus off until ANILINE was played. In 45322, ordinary purchases of I,
U, and another U left `AHIUU` and only two cash; the bonus could no longer
help through most of the remaining match. This feature did not change
ordinary purchases or low-cash decisions.

## 2. Extra tiles did not guarantee another valuable word

Both eight-game samples produced **13 words worth at least 20 points**.
Their combined rewards were 505 in the baseline and 470 in the refill
sample. The extra three purchases therefore did not correspond to more
substantial scoring plays; those plays also paid less in this sample.

In 45270, eligible purchases G and T were eventually used in GUT for four
points. In 45277, eligible G, A, and N contributed to DAWN for 12 and GUT
for four. These were purchases, but they did not create another long-word
cycle. There were useful examples too: eligible A, G, O, and E helped form
WAGONER for 33 in 45307. A further eligible I bought late in that game led
to LI for two.

These are observed tile uses, not estimates of points caused by the bonus.
More spending is also not the objective: rewards replenish spending money,
so successful scoring can cause higher spending rather than the reverse.
Average final cash barely changed, from 20.1 to 19.8.

## 3. Word timing and liquidity bottlenecks remained unchanged

The refill test deliberately kept word-play thresholds and reserves fixed.
In 45291, THRIVEN for 39 was spellable at bag 49 with 42 cash. The bot
waited until bag 30 and played the same word for the same reward. In 45284,
FIGMENT for 39 was available at bag 44 with 31 cash; waiting eventually
produced OVERTIMING for 48 around bag 30. That gained nine points but
consumed many opportunities to reinvest earlier.

A different interaction appeared in 45277: at 28 cash, the rack held
WALKED for 35. An R could unlock WARLIKE for 42, but the calculated
immediate gain of 14 fell below the reserve-bypass requirement of 15, so
several R offers were skipped. A two-point refill bonus could not solve
this: the rack exceeded six, and the relevant offers were outside its
bag window. Earlier cash-out and reserve handling need separate tests;
none of these examples proves a better counterfactual final score.

## 4. A small bonus still lost auctions, and opponents and racks differed

In 45291, all six eligible offers were lost despite 32–61 cash. In 45284,
boosted E bid 12 lost at a clearing price of 23, and boosted U bid 12 lost
at 14. Matching a clearing price also does not reveal the hidden winning
bid or prove that bidding one more would win.

The simulator has fixed Leader models; real opponents have different
purchase choices, funding cycles, and bids. Starting racks differ too:
the baseline's 112-point win in 45147 started with `EKGJO`, including J
and K used in JACKAROO for 63. The first refill game started with `ENNBB`.
Eight unpaired games cannot separate these differences from policy effects.

## 5. Simulation had already supplied weak support

The rule was a bounded experiment, not a demonstrated upgrade. In the
fresh 80-game ordinary-market check, refill +2 left score unchanged and
reduced top-three finishes from 69 to 66. Under synthetic higher common-
letter prices, average score rose from 74.3 to 75.8, but top-three finishes
fell from 56 to 55. See [REFILL-EVALUATION.md](REFILL-EVALUATION.md).

Together, the simulations and live checkpoint give no reason to promote
refill +2. The next comparisons should isolate word timing, low-cash
cash-out, and reserve handling rather than keep increasing bids.

## Comparing strategies without eight sequential games per method

Offline matches can run in parallel using
`scripts/compare_strategies.py`. Live testing can alternate one fixed
profile per completed match, so several methods receive observations
through the same period instead of each occupying a separate eight-game
block. Such small interleaved samples still need cautious interpretation.

The local game models one bot per team: see
[`spacetimedb/src/schema.ts:209`](spacetimedb/src/schema.ts#L209) and
[`createTeam` in `spacetimedb/src/index.ts:339`](spacetimedb/src/index.ts#L339).
`joinLobby` rejects a bot already in a running match at
[`spacetimedb/src/index.ts:852–860`](spacetimedb/src/index.ts#L852).
Launching several processes with the same bot credential therefore does
not create independent simultaneous live entrants. This analysis makes
no changes to the bot or the running policy.
