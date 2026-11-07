# HackUTD 2026 — ScrabbleBot

Our bot for the [ScrabbleBot track](https://scrabblebot.spacetimedb.com): a
Scrabble-style sealed-bid auction game built on SpacetimeDB.
Upstream game: https://github.com/clockworklabs/scrabblebot

## Layout

| Path | What |
|---|---|
| `bot-starter/` | The bot. Strategy lives in `src/strategy.ts` (`decideBid`, `chooseWord`). |
| `spacetimedb/` | Vendored copy of the game module. Needed for `wordlist.txt` and generating client bindings. Read `src/game.ts` for the exact rules. |

## Setup

```bash
cd bot-starter
npm install
npm run generate          # needs the `spacetime` CLI installed
npm test                  # strategy unit tests
BOT_NAME=<name> BOT_TOKEN=<token> npm start
```

Account linking (one time per person):

```bash
curl -sSf https://install.spacetimedb.com | sh   # installs the CLI
spacetime login                                   # browser login
spacetime call scrabblebot connect_id '["0x<identity shown on /account>"]'
```

Token: on the live site, link your spacetimedb.com identity at `/account`,
create a team at `/team/new`, then *Generate token* on `/team`. Shown once.
It gets saved to `bot-starter/.token-<name>` (gitignored) after first run.

## Verify before deploying

```bash
cd bot-starter
npm test                 # invariants: bids <= balance, words spellable, <100 ms
npm run sim              # 300 offline matches vs the built-in sims
npm run sim -- --ab      # compare PARAMS variants (edit VARIANTS in src/sim/run.ts)
npm run sim -- --self    # 3 copies of our bot vs 3 sims
```

The simulator (`src/sim/`) mirrors the module's rules and its sim bots. If a
change doesn't improve avgRank / top2% there, don't ship it.

## How the strategy works

`src/strategy.ts`, tuned by `PARAMS`:

- **Bid = marginal reward.** Vickrey means truthful bidding is optimal, so
  we bid what the letter is worth: the improvement in the best word we can
  play now, or the probability-weighted value of 5+ letter words it brings
  us within two tiles of (using the estimated remaining bag).
- **Pacing.** Cap each bid at a fraction of balance mid-game; in the
  endgame money is worthless, so spend freely.
- **Hoard, then cash out.** Hold short words, play 6+ letter words at once,
  play 5-letter words only when they pay well, cash out if balance is low or
  the rack is bloated, and dump everything when the bag is nearly empty.

## What the live leaderboard taught us (Nov 7, 2026)

Pulled from the public `auction_result` / `word_play` tables with
`spacetime sql scrabblebot "..."`:

- **Prices.** Clearing price is roughly `8 + 2 x face`: 1-point letters ~10,
  D/G ~12, B/C/M/P ~14, F/H/V/W/Y ~15-16, K/Q ~17, J/X ~23, Z ~25.
- **Winners run a flywheel.** Hoard to ~11 tiles, play a 7+ letter word
  (3x), reinvest the reward, repeat 3-4 times. They buy ~21 tiles a match
  at the same prices everyone pays; losers buy ~13.
- **Long words of cheap letters pay 21-24.** The 60-70 point words carry a
  Z, X, Q or J, often from the starting rack.
- **Unspent balance is wasted.** Score is total reward; money only gates it.

Live placements by version (6 bots per match):

| Version | Matches | Avg score | Places |
|---|---|---|---|
| play at 6 letters | 3 | 50 | 5, 5, 4 |
| hold for 7 | 9 | 64 | 3-6, no top two |
| face x 2.5 baseline | 2 | 57 | 5, 5 |
| market baseline (6 + 2 x face) | 4 | 83 | 3, 1, 2, 3 |

## Rules cheat sheet

- 6 bots per match, 98-tile bag, no blanks. Match ends when the bag empties.
- 1-second sealed-bid auction per letter. Vickrey: winner pays runner-up's bid.
- Start with 100 currency. Word reward = letter values × length multiplier
  (1× at ≤3, 1.5× at 4, 2× at 5, 2.5× at 6, 3× at 7+). Reward adds to both
  `balance` (spendable) and `score` (ranking).
- Unbid tiles are gone for good (the docs say they return; the module code does not re-add them).
- Rating is OpenSkill. Every lobby match counts. "Start a new version" on the
  team page resets it to 1500 if a bad build tanks it.
- Sim opponents bid roughly face value ±2. Real teams are the competition.

## Branching

One branch per person, PR into `main`. Keep `chooseWord` under 100 ms.
