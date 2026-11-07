// Run many offline matches and report how our strategy does.
//
//   npm run sim                      # ours vs 5 built-in sims, 300 matches
//   npm run sim -- --matches 1000
//   npm run sim -- --self            # 3 copies of ours vs 3 sims
//   npm run sim -- --ab              # compare PARAMS against variants below
//   npm run sim -- --verbose         # print one sample match
//   npm run sim -- --pro             # opponents are 5 Hoarders (old live model)
//   npm run sim -- --leaders         # opponents are 5 calibrated Leaders
//   npm run sim -- --calib           # 6 Leaders, no us: market vs live facts
//   npm run sim:ab                   # all variants in parallel, one process each
//
// Usage from index.ts is identical, so what wins here wins live (against
// the built-in sims; real teams are another matter).

import * as fs from "node:fs";
import { buildIndex } from "../dictionary.js";
import { PARAMS, type StrategyParams } from "../strategy.js";
import {
  CLASS_NAMES,
  LIVE_PRICE,
  letterClass,
  phaseOf,
  runMatch,
  type PlayerSpec,
  type SimKind,
} from "./engine.js";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d: number) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d;
};
const MATCHES = opt("matches", 300);
const SEED = opt("seed", 1);

const words = fs
  .readFileSync(new URL("../../../spacetimedb/wordlist.txt", import.meta.url), "utf8")
  .split("\n");
const index = buildIndex(words);

const SIMS: SimKind[] = ["Cheapskate", "ValueBidder", "Aggressive"];
// --pro: opponents are Hoarders modelled on the live leaderboard instead of
// the weak built-in sims.
// --leaders: opponents are the calibrated Leader model (see --calib).
const simLineup = (n: number): PlayerSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: "sim",
    strategy: flag("leaders") ? "Leader" : flag("pro") ? "Hoarder" : SIMS[i % 3]!,
    name: flag("leaders") ? `leader${i}` : flag("pro") ? `hoarder${i}` : undefined,
  }));

// --calib: 6 Leaders, no us. Prints the simulated market against the live
// facts so the Leader model can be tuned. A second table with 3 Leaders
// and 3 Spenders (front-loading weak bots) shows the purchase-by-phase
// profile, which in an all-Leader table is pinned at auctions/6 by
// construction.
const LIVE_TILES = [2.5, 2.6, 2.9, 4.4, 1.4];
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
function calibrate(lineup: PlayerSpec[], matches: number, seedBase: number, label: string) {
  const prices: number[][][] = CLASS_NAMES.map(() => [0, 1, 2, 3, 4].map(() => []));
  const tiles = [0, 0, 0, 0, 0];
  let unbid = 0, auctionsSeen = 0;
  const firstWord: number[] = [];
  const firstReward: number[] = [];
  const firstRack: number[] = [];
  let leaderGames = 0, words = 0, words7 = 0, score = 0, balance = 0, spent = 0, tilesTotal = 0, leftover = 0;
  const purchaseGaps: number[] = [];
  let otherGames = 0, otherScore = 0;
  const otherTiles = [0, 0, 0, 0, 0];
  for (let m = 0; m < matches; m++) {
    const rotated = lineup.map((_, i) => lineup[(i + m) % lineup.length]!);
    const r = runMatch(rotated, index, seedBase * 100_000 + m);
    for (const a of r.auctions) {
      auctionsSeen++;
      if (a.winner < 0) { unbid++; continue; }
      prices[letterClass(a.letter)]![phaseOf(a.idx)]!.push(a.paid);
    }
    r.players.forEach((p, i) => {
      const spec = rotated[i]!;
      if (spec.kind === "sim" && spec.strategy === "Spender") {
        otherGames++;
        otherScore += p.score;
        for (const idx of p.purchases) otherTiles[phaseOf(idx)]!++;
        return;
      }
      if (spec.kind !== "sim" || spec.strategy !== "Leader") return;
      leaderGames++;
      for (const idx of p.purchases) tiles[phaseOf(idx)]!++;
      tilesTotal += p.tilesWon;
      leftover += p.leftover;
      words += p.words.length;
      words7 += p.words.filter((w) => w.length >= 7).length;
      score += p.score;
      balance += p.balance;
      spent += p.spent;
      const fw = p.wordLog[0];
      if (fw) {
        firstWord.push(fw.auction);
        firstReward.push(fw.reward);
        firstRack.push(5 + p.purchases.filter((x) => x <= fw.auction).length);
      }
      for (let k = 1; k < p.wordLog.length; k++) {
        const a0 = p.wordLog[k - 1]!.auction, a1 = p.wordLog[k]!.auction;
        purchaseGaps.push(p.purchases.filter((x) => x > a0 && x <= a1).length);
      }
    });
  }
  const g = leaderGames || 1;
  console.log(`\n== calibration: ${label}, ${matches} matches ==`);
  console.log("median clearing price  sim (live)   phases 0-15 / 16-30 / 31-45 / 46-59 / 60-67");
  CLASS_NAMES.forEach((c, ci) => {
    const cells = [0, 1, 2, 3, 4].map((ph) => {
      const s = median(prices[ci]![ph]!);
      return `${String(isNaN(s) ? "-" : s).padStart(3)} (${String(LIVE_PRICE[ci]![ph]).padStart(2)})`;
    });
    console.log(`  ${c.padEnd(6)} ${cells.join("  ")}`);
  });
  console.log(`  unbid auctions: ${((100 * unbid) / auctionsSeen).toFixed(1)}% (live 0.8%)`);
  const perLeaderPhase = tiles.map((t) => t / g);
  console.log(
    `tiles bought per Leader per phase: ${perLeaderPhase.map((x) => x.toFixed(1)).join(" / ")}` +
      `  (live leaders ${LIVE_TILES.join(" / ")})`,
  );
  console.log(
    `first word: auction ${median(firstWord)} (live 26-29), reward ${median(firstReward)} (live ~45),` +
      ` rack ${(firstRack.reduce((a, b) => a + b, 0) / (firstRack.length || 1)).toFixed(1)} (live 9.5-10),` +
      ` ${((100 * firstWord.length) / g).toFixed(0)}% of Leaders played a word`,
  );
  console.log(
    `words/match ${(words / g).toFixed(2)} (live 3.2), 7+ share ${((100 * words7) / (words || 1)).toFixed(0)}%,` +
      ` purchases between words ${(purchaseGaps.reduce((a, b) => a + b, 0) / (purchaseGaps.length || 1)).toFixed(1)} (live 4-5)`,
  );
  console.log(
    `mean score ${(score / g).toFixed(1)} (live 90-110), final balance ${(balance / g).toFixed(0)} (live 15-35),` +
      ` spent ${(spent / g).toFixed(0)} (live 165-200), tiles ${(tilesTotal / g).toFixed(1)}, leftover ${(leftover / g).toFixed(1)},` +
      ` score/spent ${(score / (spent || 1)).toFixed(2)} (live 0.55)`,
  );
  if (otherGames) {
    console.log(
      `Spenders: tiles per phase ${otherTiles.map((t) => (t / otherGames).toFixed(1)).join(" / ")}` +
        ` (live weak bots 5.1 / 5.4 / 1.1 / 0.6 / 0.6), mean score ${(otherScore / otherGames).toFixed(1)} (live field avg ~70)`,
    );
  }
}

interface Agg {
  name: string;
  games: number;
  score: number;
  rankSum: number;
  wins: number;
  top2: number;
  leftover: number;
  balance: number;
  longWords: number;
  words: number;
  tiles: number;
  spent: number;
  byPhase: number[]; // tiles bought per phase
  firstWord: number[]; // auction index of the first word
}
const agg = new Map<string, Agg>();
function record(
  name: string, score: number, rank: number, leftover: number, balance: number, ws: string[], tiles: number, spent: number,
  purchases: number[] = [], wordLog: { auction: number }[] = [],
) {
  const a = agg.get(name) ?? {
    name, games: 0, score: 0, rankSum: 0, wins: 0, top2: 0, leftover: 0, balance: 0, longWords: 0, words: 0, tiles: 0, spent: 0,
    byPhase: [0, 0, 0, 0, 0], firstWord: [],
  };
  for (const idx of purchases) a.byPhase[phaseOf(idx)]!++;
  const fw = wordLog.find((w) => w.auction >= 0);
  if (fw) a.firstWord.push(fw.auction);
  a.tiles += tiles;
  a.spent += spent;
  a.games++;
  a.score += score;
  a.rankSum += rank;
  if (rank === 1) a.wins++;
  if (rank <= 2) a.top2++;
  a.leftover += leftover;
  a.balance += balance;
  a.words += ws.length;
  a.longWords += ws.filter((w) => w.length >= 6).length;
  agg.set(name, a);
}

function play(lineup: PlayerSpec[], matches: number, seedBase: number) {
  for (let m = 0; m < matches; m++) {
    // Rotate seats so position never matters.
    const rotated = lineup.map((_, i) => lineup[(i + m) % lineup.length]!);
    const r = runMatch(rotated, index, seedBase * 100_000 + m);
    r.players.forEach((p, i) =>
      record(p.name, p.score, r.ranks[i]!, p.leftover, p.balance, p.words, p.tilesWon, p.spent, p.purchases, p.wordLog),
    );
    if (flag("verbose") && m === 0) {
      for (const p of r.players) {
        console.log(`${p.name.padEnd(14)} score ${String(p.score).padStart(4)}  left ${p.leftover}  bal ${p.balance}  ${p.words.join(" ")}`);
      }
      console.log();
    }
  }
}

function report() {
  const rows = [...agg.values()].sort((a, b) => b.score / b.games - a.score / a.games);
  console.log(
    "name".padEnd(14),
    "avgScore".padStart(9),
    "avgRank".padStart(8),
    "win%".padStart(6),
    "top2%".padStart(6),
    "6+w".padStart(5),
    "words".padStart(6),
    "left".padStart(5),
    "bal".padStart(5),
    "tiles".padStart(6),
    "spent".padStart(6),
    "  tiles/phase(0-15/16-30/31-45/46-59/60-67)",
    "1stWord".padStart(8),
  );
  for (const a of rows) {
    const fw = a.firstWord.length ? a.firstWord.reduce((x, y) => x + y, 0) / a.firstWord.length : NaN;
    console.log(
      a.name.padEnd(14),
      (a.score / a.games).toFixed(1).padStart(9),
      (a.rankSum / a.games).toFixed(2).padStart(8),
      ((100 * a.wins) / a.games).toFixed(0).padStart(6),
      ((100 * a.top2) / a.games).toFixed(0).padStart(6),
      (a.longWords / a.games).toFixed(2).padStart(5),
      (a.words / a.games).toFixed(1).padStart(6),
      (a.leftover / a.games).toFixed(1).padStart(5),
      (a.balance / a.games).toFixed(0).padStart(5),
      (a.tiles / a.games).toFixed(1).padStart(6),
      (a.spent / a.games).toFixed(0).padStart(6),
      ("  " + a.byPhase.map((t) => (t / a.games).toFixed(1)).join(" / ")).padEnd(44),
      (isNaN(fw) ? "-" : fw.toFixed(0)).padStart(8),
    );
  }
}

// Parameter variants to A/B. Edit freely.
const VARIANTS: Record<string, Partial<StrategyParams>> = {
  // approximates the build live at 18:40: no spending floor, early cash-outs, no planner
  live: { spendFloorByPhase: [0, 0, 0, 0, 0], playNowReward7: 30, crunchBalance: 30, targetTopN: 0, reserveBalance: 35, lateReserveBalance: 20 },
  tempo: {},
  tempoNoPlan: { targetTopN: 0 },
  tempoSoft: { spendFloorByPhase: [30, 15, 0, 0, 0] },
};

const variantArg = (() => {
  const i = args.indexOf("--variant");
  return i >= 0 ? args[i + 1] : undefined;
})();

if (flag("calib")) {
  const n = opt("matches", 100);
  const leaders: PlayerSpec[] = Array.from({ length: 6 }, (_, i) => ({ kind: "sim", strategy: "Leader", name: `leader${i}` }));
  calibrate(leaders, n, SEED, "6 Leaders");
  const mixed: PlayerSpec[] = [
    ...leaders.slice(0, 3),
    ...Array.from({ length: 3 }, (_, i): PlayerSpec => ({ kind: "sim", strategy: "Spender", name: `spender${i}` })),
  ];
  calibrate(mixed, n, SEED, "3 Leaders + 3 Spenders (purchase profile vs front-loaders)");
  process.exit(0);
} else if (variantArg !== undefined) {
  const params = VARIANTS[variantArg];
  if (!params) throw new Error(`unknown variant ${variantArg}; have ${Object.keys(VARIANTS).join(", ")}`);
  play([{ kind: "ours", params, name: variantArg }, ...simLineup(5)], MATCHES, SEED);
  for (const k of [...agg.keys()]) if (k !== variantArg) agg.delete(k);
  report();
} else if (flag("ab")) {
  // Each variant plays its own series vs the same sims, same seeds.
  for (const [name, params] of Object.entries(VARIANTS)) {
    play([{ kind: "ours", params, name }, ...simLineup(5)], MATCHES, SEED);
  }
  // Keep only our rows; sim rows are pooled noise here.
  for (const k of [...agg.keys()]) if (!(k in VARIANTS)) agg.delete(k);
  report();
} else if (flag("self")) {
  // Head-to-head: the first six variants play each other, no sims.
  const lineup: PlayerSpec[] = Object.entries(VARIANTS)
    .slice(0, 6)
    .map(([name, params]) => ({ kind: "ours", params, name }));
  play(lineup, MATCHES, SEED);
  report();
} else {
  play([{ kind: "ours", name: "ours" }, ...simLineup(5)], MATCHES, SEED);
  report();
}
console.log(`\n${MATCHES} matches, seed ${SEED}, PARAMS=${JSON.stringify(PARAMS)}`);
