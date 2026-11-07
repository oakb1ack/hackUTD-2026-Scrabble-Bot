// Run many offline matches and report how our strategy does.
//
//   npm run sim                      # ours vs 5 built-in sims, 300 matches
//   npm run sim -- --matches 1000
//   npm run sim -- --self            # 3 copies of ours vs 3 sims
//   npm run sim -- --ab              # compare PARAMS against variants below
//   npm run sim -- --verbose         # print one sample match
//
// Usage from index.ts is identical, so what wins here wins live (against
// the built-in sims; real teams are another matter).

import * as fs from "node:fs";
import { buildIndex } from "../dictionary.js";
import { PARAMS, type StrategyParams } from "../strategy.js";
import { runMatch, type PlayerSpec, type SimKind } from "./engine.js";

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
const simLineup = (n: number): PlayerSpec[] =>
  Array.from({ length: n }, (_, i) => ({ kind: "sim", strategy: SIMS[i % 3]! }));

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
}
const agg = new Map<string, Agg>();
function record(name: string, score: number, rank: number, leftover: number, balance: number, ws: string[]) {
  const a = agg.get(name) ?? {
    name, games: 0, score: 0, rankSum: 0, wins: 0, top2: 0, leftover: 0, balance: 0, longWords: 0, words: 0,
  };
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
      record(p.name, p.score, r.ranks[i]!, p.leftover, p.balance, p.words),
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
  );
  for (const a of rows) {
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
    );
  }
}

// Parameter variants to A/B. Edit freely.
const VARIANTS: Record<string, Partial<StrategyParams>> = {
  base: {},
  win25: { targetWinFrac: 0.25 },
  win50: { targetWinFrac: 0.5 },
  greedy: { playNowLen: 5, fiveLetterMinReward: 0 },
  cash30: { cashFloor: 30 },
  useful2: { usefulThreshold: 2 },
  bigMult: { valueMult: 1.5 },
};

if (flag("ab")) {
  // Each variant plays its own series vs the same sims, same seeds.
  for (const [name, params] of Object.entries(VARIANTS)) {
    play([{ kind: "ours", params, name }, ...simLineup(5)], MATCHES, SEED);
  }
  // Keep only our rows; sim rows are pooled noise here.
  for (const k of [...agg.keys()]) if (!(k in VARIANTS)) agg.delete(k);
  report();
} else if (flag("self")) {
  play(
    [
      { kind: "ours", name: "ours-A" },
      { kind: "ours", name: "ours-B" },
      { kind: "ours", name: "ours-C" },
      ...simLineup(3),
    ],
    MATCHES,
    SEED,
  );
  report();
} else {
  play([{ kind: "ours", name: "ours" }, ...simLineup(5)], MATCHES, SEED);
  report();
}
console.log(`\n${MATCHES} matches, seed ${SEED}, PARAMS=${JSON.stringify(PARAMS)}`);
