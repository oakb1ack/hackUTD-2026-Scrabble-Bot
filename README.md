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

## Rules cheat sheet

- 6 bots per match, 98-tile bag, no blanks. Match ends when the bag empties.
- 1-second sealed-bid auction per letter. Vickrey: winner pays runner-up's bid.
- Start with 100 currency. Word reward = letter values × length multiplier
  (1× at ≤3, 1.5× at 4, 2× at 5, 2.5× at 6, 3× at 7+). Reward adds to both
  `balance` (spendable) and `score` (ranking).
- Unbid tiles are gone for good (the docs say they return; the module code does not re-add them).
- Sim opponents bid roughly face value ±2. Real teams are the competition.

## Branching

One branch per person, PR into `main`. Keep `chooseWord` under 100 ms.
