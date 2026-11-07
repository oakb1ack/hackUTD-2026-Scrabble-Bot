// Offline match simulator. Mirrors spacetimedb/src/game.ts closely enough
// to compare strategies: 6 players, 5-tile starting racks, 98-tile bag,
// 1 auction per tile, Vickrey with reserve 1, random tie-break, match ends
// when the bag empties. Unbid tiles are not returned (matches the code).
//
// Simulated opponents reproduce the module's built-in bots exactly:
// Cheapskate / ValueBidder / Aggressive with ±2 jitter, and they play the
// longest word of 3+ letters every time they win a tile.

import {
  DEFAULT_BAG,
  LETTER_VALUE,
  longestPlay,
  rackCounts,
  type DictionaryIndex,
} from "../dictionary.js";
import {
  chooseWord,
  decideBid,
  type StrategyParams,
} from "../strategy.js";

export type SimKind = "Cheapskate" | "ValueBidder" | "Aggressive";

export type PlayerSpec =
  | { kind: "sim"; strategy: SimKind; name?: string }
  | { kind: "ours"; params?: Partial<StrategyParams>; name?: string };

export interface PlayerState {
  spec: PlayerSpec;
  name: string;
  balance: number;
  score: number;
  rack: Map<string, number>;
  words: string[];
  seenLetters: Map<string, number>; // what this player saw auctioned
  tilesWon: number;
  spent: number;
}

export interface MatchResult {
  players: {
    name: string; score: number; balance: number; words: string[];
    leftover: number; tilesWon: number; spent: number;
  }[];
  ranks: number[]; // ranks[i] = finishing place of player i (1 = best)
}

// Deterministic PRNG (mulberry32) so runs are reproducible.
export function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
  };
}

function addTile(rack: Map<string, number>, l: string) {
  rack.set(l, (rack.get(l) ?? 0) + 1);
}
function removeWord(rack: Map<string, number>, word: string) {
  for (const c of word) {
    const n = (rack.get(c) ?? 0) - 1;
    if (n <= 0) rack.delete(c);
    else rack.set(c, n);
  }
}
function rackSize(rack: Map<string, number>) {
  let t = 0;
  for (const n of rack.values()) t += n;
  return t;
}

function simBid(kind: SimKind, letter: string, balance: number, jitter: number) {
  const v = LETTER_VALUE[letter] ?? 0;
  const vowel = "AEIOU".includes(letter);
  let base: number;
  if (kind === "Cheapskate") base = v - 1;
  else if (kind === "ValueBidder") base = v;
  else base = v + (vowel ? 4 : 2);
  return Math.max(0, Math.min(Math.max(base + jitter, 1), balance));
}

function playWordFor(p: PlayerState, word: string, index: DictionaryIndex) {
  const entry = index.byReward.find((e) => e.word === word);
  const reward = entry ? entry.reward : 0;
  removeWord(p.rack, word);
  p.balance += reward;
  p.score += reward;
  p.words.push(word);
}

// Let one of our bots play words until it decides to hold.
function ourWordLoop(p: PlayerState, bagRemaining: number, index: DictionaryIndex) {
  if (p.spec.kind !== "ours") return;
  for (let guard = 0; guard < 12; guard++) {
    const w = chooseWord({
      myRack: p.rack,
      dictionary: [],
      bagRemaining,
      myBalance: p.balance,
      params: p.spec.params,
      index,
    });
    if (!w) return;
    playWordFor(p, w, index);
  }
}

function estimatedBag(p: PlayerState): Record<string, number> {
  const bag: Record<string, number> = { ...DEFAULT_BAG };
  for (const [l, n] of p.seenLetters) bag[l] = Math.max(0, (bag[l] ?? 0) - n);
  for (const [l, n] of p.rack) bag[l] = Math.max(0, (bag[l] ?? 0) - n);
  return bag;
}

export function runMatch(
  specs: PlayerSpec[],
  index: DictionaryIndex,
  seed: number,
  startingRack = 5,
): MatchResult {
  const rng = makeRng(seed);
  const bag: string[] = [];
  for (const [l, n] of Object.entries(DEFAULT_BAG)) for (let i = 0; i < n; i++) bag.push(l);
  // Fisher-Yates
  for (let i = bag.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [bag[i], bag[j]] = [bag[j]!, bag[i]!];
  }

  const players: PlayerState[] = specs.map((spec, i) => ({
    spec,
    name: spec.name ?? (spec.kind === "sim" ? `${spec.strategy}${i}` : `ours${i}`),
    balance: 100,
    score: 0,
    rack: new Map(),
    words: [],
    seenLetters: new Map(),
    tilesWon: 0,
    spent: 0,
  }));

  for (const p of players) {
    for (let n = 0; n < startingRack && bag.length; n++) addTile(p.rack, bag.pop()!);
  }
  // Starting racks might already hold a word.
  for (const p of players) ourWordLoop(p, bag.length, index);

  while (bag.length > 0) {
    const letter = bag.pop()!;
    const remainingBefore = bag.length + 1;

    const bids: { i: number; amount: number }[] = [];
    players.forEach((p, i) => {
      let amount = 0;
      if (p.spec.kind === "sim") {
        amount = simBid(p.spec.strategy, letter, p.balance, rng.int(-2, 2));
      } else {
        amount = decideBid({
          letter,
          myBalance: p.balance,
          myRack: p.rack,
          bagRemaining: remainingBefore,
          bagCounts: estimatedBag(p),
          params: p.spec.params,
          index,
        });
        amount = Math.max(0, Math.min(Math.floor(amount), p.balance));
      }
      if (amount > 0) bids.push({ i, amount });
    });

    // Shuffle then stable sort descending, like the module.
    for (let i = bids.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [bids[i], bids[j]] = [bids[j]!, bids[i]!];
    }
    bids.sort((a, b) => b.amount - a.amount);

    const [first, second] = bids;
    if (first) {
      const paid = second ? second.amount : Math.min(1, first.amount);
      const winner = players[first.i]!;
      if (winner.balance >= paid) {
        winner.balance -= paid;
        winner.tilesWon++;
        winner.spent += paid;
        addTile(winner.rack, letter);
        if (winner.spec.kind === "sim") {
          const { counts, total } = rackCounts(winner.rack);
          const w = longestPlay(counts, total, 3, index);
          if (w) playWordFor(winner, w.word, index);
        }
      }
    }
    for (const p of players) addTile(p.seenLetters, letter);

    // Our bots re-evaluate after every auction (index.ts does the same on
    // matchState.bagTotal changes).
    for (const p of players) ourWordLoop(p, bag.length, index);
  }

  const order = players
    .map((p, i) => ({ i, score: p.score }))
    .sort((a, b) => b.score - a.score);
  const ranks = new Array<number>(players.length).fill(0);
  order.forEach((o, idx) => {
    ranks[o.i] = idx + 1;
  });
  return {
    players: players.map((p) => ({
      name: p.name,
      score: p.score,
      balance: p.balance,
      words: p.words,
      leftover: rackSize(p.rack),
      tilesWon: p.tilesWon,
      spent: p.spent,
    })),
    ranks,
  };
}
