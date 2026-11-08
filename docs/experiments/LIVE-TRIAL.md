# Live trial — eight completed games

Settings remained fixed: face-value baseline (`mcMode=0`) and phase reserves
`[28,16,0,0,0]`. Bot 182, scrabblemaxxing. Match 45140 is excluded because
it began before the strategy restart. The eight clean games below follow it.

| Match | Place | Score | Purchases | Spent | Cash left | Words |
|---|---:|---:|---:|---:|---:|---|
| 45147 | 1/6 | 112 | 15 | 177 | 35 | JACKAROO (63), TWANGLED (39), FLOE (10) |
| 45154 | 3/6 | 77 | 14 | 165 | 12 | REINVADED (42), KEELSON (33), UT (2) |
| 45161 | 5/6 | 52 | 10 | 130 | 22 | CAVEATING (45), AY (5), LI (2) |
| 45168 | 3/6 | 77 | 12 | 159 | 18 | THIEVED (42), SAVOURER (33), UT (2) |
| 45176 | 6/6 | 54 | 9 | 134 | 20 | VOLLEYS (39), WYE (9), BI (4), OE (2) |
| 45183 | 1/6 | 80 | 11 | 167 | 13 | ANTIJAM (48), FEWEST (30), EN (2) |
| 45190 | 4/6 | 72 | 13 | 160 | 12 | AUTHORITY (45), WAILER (22), IF (5) |
| 45197 | 6/6 | 45 | 9 | 116 | 29 | AERATED (24), BONGS (16), OF (5) |

Wins: 2/8. Top three: 4/8.
Average score: 71.1; average place: 3.62.
Average purchases: 11.6; spending: 151; cash left: 20.1.

This sample did not reproduce the corrected simulator result of 90% top-three
finishes. Eight games are a diagnostic checkpoint, not a reliable win-rate
estimate or a controlled comparison: opponent lineups and starting racks vary.
The previous eight complete games logged under the old policy averaged 72.1
points; these eight averaged 71.1. That descriptive comparison supplies no
evidence of a score improvement. Their lineups and racks were not matched.

## Findings

- Rebuilding often stalled despite available cash. In 45147, after TWANGLED,
  the bot held ELO and 46 cash while repeatedly bidding 10 for common letters.
  In 45161 it held IIYA and 37 cash through another long purchase drought.
  In 45176 it held YIEB and 45 cash while losing 16 mid-to-late common-letter offers.
- In the first five games, with bag 36–9 and cash at least 25, 83 lost
  auctions for one-to-three-point letters had logged bids. 74 cleared within
  three currency above our bid. A clearing price equal to our bid does not
  reveal the hidden winning bid or prove that bidding one more would win.
- Reserve and cash-out rules can interact poorly. In 45154, balance 25 and
  EESKLN were held through nine skipped offers; O would complete KEELSON.
  A reserve of 16 blocked bids while the low-cash rule waited for balance below 14.
- Some long words waited without improving: VOLLEYS (39) was available
  around bag 50 in 45176 but played around bag 32 after cash fell.
  The opt-in long-word-alternative fix would not change the first three
  games' logged word decisions.
- First-game success depended partly on a strong starting rack EKGJO;
  its JACKAROO (63) used starting J and K. That win alone cannot validate bidding.
- Three first-five games skipped the auction immediately after a word payout
  and bid again once the credited balance appeared. Instrument skip reasons
  and consider retrying an open, previously unbid auction after a balance update.

## Recommendation for the next experiment

Test a small increase only for useful, nonduplicate common letters when
rebuilding a short or unbalanced rack in midgame. Hold premium bidding,
reserves, and word timing fixed to isolate the effect. Measure purchases
after word payouts and the time to the next substantial word. A blanket
common-letter bid increase already performed poorly in simulation.

Cash left is a diagnostic, not the objective. Score determines placement;
forcing the balance to zero can buy unusable tiles. More spending can also
be a consequence of scoring more, because word rewards replenish money.

No strategy changes were made during this trial. The eight-game collector
is complete; the bot continues playing with the same settings pending the
user's decision. Logs: `/private/tmp/scrabble-live-market.log`; postmortems:
`/private/tmp/scrabble-live-trial.txt`. Public auction snapshots for all eight
matches are saved at `/private/tmp/scrabble-auctions-<match>.json`.
