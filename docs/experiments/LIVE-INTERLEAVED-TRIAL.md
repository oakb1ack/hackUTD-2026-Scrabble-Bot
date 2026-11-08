# Live strategy trial

Alternating liveBaseline and reserveCap: eight total games, four per profile; settings fixed within each game; automatic baseline after the pilot. Different racks/opponents remain uncontrolled.

Completed: 8/8. Only ended matches after 45378 are included.
The transition game and all earlier games are excluded. Each match keeps its assigned settings; profiles may alternate between matches.
Tied scores share a place. Different opponent lineups and starting racks prevent a controlled causal comparison.

| Trial game | Match ID | Profile | Place | Score | Purchases | Spent | Cash left | Words |
|---|---:|---|---:|---:|---:|---:|---:|---|
| 1/8 | 45387 | liveBaseline | 5/6 | 70 | 10 | 159 | 11 | FEVERED (42), PHONY (26), LO (2) |
| 2/8 | 45396 | reserveCap | 1/6 | 81 | 12 | 166 | 15 | AXILLAR (42), BUFFO (26), VAC (8), AY (5) |
| 3/8 | 45405 | liveBaseline | 3/6 | 82 | 10 | 137 | 45 | AVIFAUNAE (45), REJECT (37) |
| 4/8 | 45413 | reserveCap | 4/6 | 80 | 11 | 140 | 40 | LIQUORS (48), THIEVE (30), OE (2) |
| 5/8 | 45421 | liveBaseline | 1/6 | 84 | 11 | 162 | 22 | FOXIER (40), IMBOWER (42), AR (2) |
| 6/8 | 45429 | reserveCap | 2/6 | 64 | 9 | 140 | 24 | REAVING (33), JAGRA (26), YE (5) |
| 7/8 | 45437 | liveBaseline | 3/6 | 82 | 12 | 156 | 26 | FEIJOA (40), GENTLING (30), QUA (12) |
| 8/8 | 45445 | reserveCap | 4/6 | 74 | 13 | 171 | 3 | FORWARD (42), OTOLITH (30), AN (2) |

Wins: 2/8. Top three: 5/8.
Average score: 77.1; average place: 2.88.
Average purchases: 11.0; spending: 153.9; cash left: 23.2.

| Profile | Games | Wins | Top three | Avg score | Avg place | Purchases |
|---|---:|---:|---:|---:|---:|---:|
| liveBaseline | 4 | 1/4 | 3/4 | 79.5 | 3.00 | 10.8 |
| reserveCap | 4 | 1/4 | 2/4 | 74.8 | 2.75 | 11.2 |

Midgame rebuilding: 1.25 purchases in the ten offers following a 20+ point word (8 full windows with cash at least 25).
This is a diagnostic; it includes only payouts with ten remaining offers and at most 37, and does not infer rack size.

The collector only observes games; it does not start, stop, or configure the bot.

## Decision

This eight-game pilot compared four games per method. Reserve caps did not
establish an improvement: both won once, baseline had three top-three
finishes versus two, and average scores were 79.5 versus 74.75. Reserve caps
had a better average place (2.75 versus 3.00), so metrics are mixed.
Different opponents and racks, and only four games per method, prevent a
reliable winner claim. The bot automatically resumed baseline at match
45452 after completing all eight assignments.

All parameter snapshots stayed fixed within their matches, and the profiles
differed only in reserveAsCap. Every snapshot has 68 auctions and reconciled
cash. The bot continues running with baseline; no further promotion was made.
Full workflow and limits: [EXPERIMENT-WORKFLOW.md](EXPERIMENT-WORKFLOW.md).
