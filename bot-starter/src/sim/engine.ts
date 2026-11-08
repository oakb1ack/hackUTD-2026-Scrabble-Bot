import { MarketLearner } from "../market.js";
// Offline match simulator. Mirrors spacetimedb/src/game.ts closely enough
// to compare strategies: 6 players, 5-tile starting racks, 98-tile bag,
// 1 auction per tile, Vickrey with reserve 1, random tie-break, match ends
// when the bag empties. Unbid tiles are not returned (matches the code).
//
// Simulated opponents reproduce the module's built-in bots exactly:
// Cheapskate / ValueBidder / Aggressive with ±2 jitter, and they play the
// longest word of 3+ letters every time they win a tile.

import {
  canSpellCounts,
  DEFAULT_BAG,
  LETTER_VALUE,
  longestPlay,
  rackCounts,
  type DictionaryIndex,
  type IndexedWord,
} from "../dictionary.js";
import {
  chooseWord,
  decideBid,
  type StrategyParams,
} from "../strategy.js";

// "Hoarder" is not a built-in sim: it models the real teams seen on the live
// leaderboard (Nov 2026). They pay a median of ~11 per tile regardless of
// letter, hoard to 7+ letters for the 3x multiplier, and dump in the endgame.
//
// "Leader" is the calibrated successor to Hoarder (127 live matches, Nov
// 2026): phase-dependent bids around the observed clearing medians, budget
// pacing that holds cash early and spends mid/late, reinvestment of word
// rewards, hold-to-~10-tiles then 7+ letter words, and a per-instance
// personality (aggressiveness, hold target) so a table of five differs.
//
// "Spender" models the weak live bots: it pays ~5% over the live median
// from auction one with no pacing (5+ tiles per 15 auctions early), plays
// any 3+ word as soon as it wins a tile, and is broke by mid-match.
export type SimKind = "Cheapskate" | "ValueBidder" | "Aggressive" | "Hoarder" | "Leader" | "Spender";

export const AUCTIONS = 68; // 98 tiles - 6 x 5 starting
export const PHASE_BOUNDS = [16, 31, 46, 60, 68]; // auction index < bound
export function phaseOf(auctionIdx: number): number {
  for (let i = 0; i < PHASE_BOUNDS.length; i++) if (auctionIdx < PHASE_BOUNDS[i]!) return i;
  return PHASE_BOUNDS.length - 1;
}
// Letter class used by the live price tables: 1 / 2-3 / 4 / 5-8 / 10.
export function letterClass(letter: string): number {
  const v = LETTER_VALUE[letter] ?? 1;
  return v >= 10 ? 4 : v >= 5 ? 3 : v >= 4 ? 2 : v >= 2 ? 1 : 0;
}
export const CLASS_NAMES = ["1pt", "2-3pt", "4pt", "5-8pt", "Z/Q"];

// Live median clearing price by [class][phase].
export const LIVE_PRICE: number[][] = [
  [10, 10, 10, 10, 10],
  [13, 13, 13, 13, 12],
  [21, 19, 16, 17, 12],
  [31, 26, 22, 17, 13],
  [35, 28, 22, 20, 12],
];

// Leader tunables (calibrated with `npm run sim -- --calib`).
export const LEADER = {
  // Bid centre as a fraction of the live clearing median. The clearing
  // price is the 2nd-highest of ~5-6 noisy bids, so the centre sits below.
  centre: 0.86,
  // Multiplicative lognormal spread of a single bid.
  sigma: 0.16,
  // Phase willingness: hold cash early, lean in mid/late.
  phaseW: [0.94, 0.97, 1.02, 1.1, 1.12],
  // Don't spend balance below this per phase unless the tile completes a
  // 7+ word (reinvestment lifts the balance so this bites less later).
  reserve: [42, 24, 8, 0, 0],
  // Wealth feedback: bids scale with balance relative to this.
  wealthRef: 60,
  wealthSlope: 0.25,
  // Personality ranges (drawn per instance from its name hash).
  aggrLo: 0.9,
  aggrHi: 1.12,
  holdLo: 8,
  holdHi: 10,
  // After the first word, play again at this many tiles.
  rehold: 9,
  // At the hold target, still wait (up to 2 more tiles) for a 7+ word
  // paying at least this; the live first word averages ~45.
  minReward7: 34,
  // Cash out a 7+ word at any rack size when it pays at least this.
  playNowReward: 42,
  // Or when the balance is this low and a 7+ word is in hand.
  cashFloor: 14,
};

export interface LeaderPersona {
  aggr: number;
  holdTarget: number;
}
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function leaderPersona(name: string): LeaderPersona {
  const r = makeRng(hashStr(name));
  return {
    aggr: LEADER.aggrLo + (LEADER.aggrHi - LEADER.aggrLo) * r.next(),
    holdTarget: r.int(LEADER.holdLo, LEADER.holdHi),
  };
}

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
  persona?: LeaderPersona;
  memoKey?: string;
  memo7?: IndexedWord | null;
  purchases: number[]; // auction index of each tile bought
  wordLog: { auction: number; word: string; reward: number }[];
}

export interface AuctionRecord {
  idx: number;
  letter: string;
  paid: number; // 0 when nobody bid
  winner: number; // player index, -1 when unbid
  bids: number;
}

export interface MatchResult {
  players: {
    name: string; score: number; balance: number; words: string[];
    leftover: number; tilesWon: number; spent: number;
    purchases: number[];
    wordLog: { auction: number; word: string; reward: number }[];
  }[];
  ranks: number[]; // ranks[i] = finishing place of player i (1 = best)
  auctions: AuctionRecord[];
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
type Rng = ReturnType<typeof makeRng>;

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

function simBid(kind: SimKind, letter: string, balance: number, jitter: number, bagRemaining = 60) {
  const v = LETTER_VALUE[letter] ?? 0;
  const vowel = "AEIOU".includes(letter);
  let base: number;
  if (kind === "Cheapskate") base = v - 1;
  else if (kind === "ValueBidder") base = v;
  else if (kind === "Aggressive") base = v + (vowel ? 4 : 2);
  else {
    // Hoarder, calibrated on live matches 42700-42750: 1-point letters
    // clear at ~10, D/G ~12, B/C/M/P ~14, F/H/V/W/Y ~15, K/Q ~17,
    // J/X ~23, Z ~25. Spends faster as the bag runs down. Jitter ±4.
    base = 9 + Math.round(v * 1.5) + jitter * 2;
    if (bagRemaining <= 10) base = Math.max(base, Math.floor(balance / 2));
  }
  return Math.max(0, Math.min(Math.max(base + jitter, 1), balance));
}

// Normal deviate from the match rng (Box-Muller).
function gauss(rng: Rng) {
  const u = Math.max(rng.next(), 1e-12);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Highest-reward word of at least minLen letters the rack can spell.
function bestPlayMin(counts: Uint8Array, total: number, minLen: number, index: DictionaryIndex): IndexedWord | null {
  if (total < minLen) return null;
  const list = total < index.byRewardMaxLen.length ? index.byRewardMaxLen[total]! : index.byReward;
  for (const e of list) {
    if (e.word.length < minLen || e.word.length > total) continue;
    if (canSpellCounts(e, counts)) return e;
  }
  return null;
}

// Leader bid: the live clearing median for this letter class and phase,
// scaled by personality, phase willingness and wealth, with lognormal
// noise, then paced against a per-phase cash reserve.
function leaderBid(p: PlayerState, letter: string, auctionIdx: number, rng: Rng, index: DictionaryIndex): number {
  const persona = p.persona!;
  const phase = phaseOf(auctionIdx);
  const cls = letterClass(letter);
  const { counts, total } = rackCounts(p.rack);
  const slot = letter.charCodeAt(0) - 65;
  // Rack fit: duplicates and vowel glut are worth less; a tile that
  // completes a 7+ word is worth a lot more.
  let fit = 1;
  if (counts[slot]! >= 2) fit *= 0.6;
  let vowels = 0;
  for (const c of "AEIOU") vowels += counts[c.charCodeAt(0) - 65]!;
  const isVowel = "AEIOU".includes(letter);
  if (isVowel && vowels >= Math.max(3, total / 2)) fit *= 0.85;
  if (!isVowel && vowels === 0 && total >= 4) fit *= 0.85;
  let completes = false;
  if (total >= 6) {
    const withLetter = new Uint8Array(counts);
    withLetter[slot] = withLetter[slot]! + 1;
    let w: IndexedWord | null = null;
    if (!best7(p, counts, total, index)) {
      for (const e of index.containing.get(letter) ?? []) {
        if (e.word.length < 7 || e.word.length > total + 1) continue;
        if (canSpellCounts(e, withLetter)) { w = e; break; }
      }
    }
    if (w) {
      completes = true;
      fit *= 1.25;
    }
  }
  const wealth =
    1 + LEADER.wealthSlope * Math.max(-1, Math.min(1, (p.balance - LEADER.wealthRef) / LEADER.wealthRef));
  const centre =
    LIVE_PRICE[cls]![phase]! * LEADER.centre * persona.aggr * LEADER.phaseW[phase]! * wealth * fit;
  let bid = Math.round(centre * Math.exp(LEADER.sigma * gauss(rng)));
  const reserve = completes ? 0 : LEADER.reserve[phase]!;
  const spendable = p.balance - reserve;
  if (spendable <= 0) return 0;
  bid = Math.min(bid, spendable);
  // Last auction: a tile that completes nothing is dead money.
  if (AUCTIONS - auctionIdx <= 1 && !completes) return 0;
  return Math.max(0, bid);
}

// Spender bid: live median x 1.05 with jitter, no pacing at all.
function spenderBid(letter: string, auctionIdx: number, balance: number, rng: Rng): number {
  const centre = LIVE_PRICE[letterClass(letter)]![phaseOf(auctionIdx)]! * 1.05;
  const bid = Math.round(centre * Math.exp(0.15 * gauss(rng)));
  return Math.max(0, Math.min(bid, balance));
}

// Memoised "best 7+ word from this rack" (the rack changes rarely and the
// scan is the simulator's hot spot).
function best7(p: PlayerState, counts: Uint8Array, total: number, index: DictionaryIndex): IndexedWord | null {
  const key = String.fromCharCode(...counts);
  if (p.memoKey === key) return p.memo7 ?? null;
  p.memoKey = key;
  p.memo7 = bestPlayMin(counts, total, 7, index);
  return p.memo7;
}

// Leader word play: hold to the personal target, then cash 7+ words,
// falling back to shorter words only as the bag runs out.
function leaderWordLoop(p: PlayerState, bagLeft: number, auctionIdx: number, index: DictionaryIndex) {
  const persona = p.persona!;
  for (let guard = 0; guard < 8; guard++) {
    const { counts, total } = rackCounts(p.rack);
    let w: IndexedWord | null;
    if (bagLeft <= 2) w = bestPlayMin(counts, total, 2, index);
    else if (bagLeft <= 4) w = bestPlayMin(counts, total, 4, index);
    else if (bagLeft <= 8) w = bestPlayMin(counts, total, 6, index);
    else {
      w = best7(p, counts, total, index);
      if (w && w.reward < LEADER.playNowReward) {
        const target = p.words.length === 0 ? persona.holdTarget : LEADER.rehold;
        const gate =
          total >= target + 2 ||
          (total >= target && w.reward >= LEADER.minReward7) ||
          p.balance < LEADER.cashFloor;
        if (!gate) return;
      }
    }
    if (!w) return;
    playWordFor(p, w.word, index, auctionIdx);
  }
}

function playWordFor(p: PlayerState, word: string, index: DictionaryIndex, auctionIdx = -1) {
  const entry = index.byReward.find((e) => e.word === word);
  const reward = entry ? entry.reward : 0;
  removeWord(p.rack, word);
  p.balance += reward;
  p.score += reward;
  p.words.push(word);
  p.wordLog.push({ auction: auctionIdx, word, reward });
}

// Let one of our bots play words until it decides to hold.
function ourWordLoop(p: PlayerState, bagRemaining: number, index: DictionaryIndex, auctionIdx = -1) {
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
    playWordFor(p, w, index, auctionIdx);
  }
}

// Composition remains an approximation: subtracting the current rack can
// double-count auction wins and reintroduce played starting tiles. Keep this
// limitation separate from the live auction-timing contract below.
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
  market?: MarketLearner,
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
    persona:
      spec.kind === "sim" && spec.strategy === "Leader"
        ? leaderPersona(spec.name ?? `Leader${i}`)
        : undefined,
    purchases: [],
    wordLog: [],
  }));
  const auctions: AuctionRecord[] = [];

  for (const p of players) {
    for (let n = 0; n < startingRack && bag.length; n++) addTile(p.rack, bag.pop()!);
  }
  // Live startup has already drawn the first offer out of bagTotal.
  // Starting racks might already hold a word.
  if (bag.length > 0) {
    for (const p of players) ourWordLoop(p, bag.length - 1, index);
  }
  const totalAuctions = bag.length;

  while (bag.length > 0) {
    const letter = bag.pop()!;
    const remainingBefore = bag.length + 1;
    const auctionIdx = totalAuctions - remainingBefore;

    const bids: { i: number; amount: number }[] = [];
    players.forEach((p, i) => {
      let amount = 0;
      if (p.spec.kind === "sim" && p.spec.strategy === "Leader") {
        amount = leaderBid(p, letter, auctionIdx, rng, index);
      } else if (p.spec.kind === "sim" && p.spec.strategy === "Spender") {
        amount = spenderBid(letter, auctionIdx, p.balance, rng);
      } else if (p.spec.kind === "sim") {
        amount = simBid(p.spec.strategy, letter, p.balance, rng.int(-2, 2), remainingBefore);
      } else {
        amount = decideBid({
          letter,
          myBalance: p.balance,
          myRack: p.rack,
          bagRemaining: bag.length,
          bagCounts: estimatedBag(p),
          rivalBalances: players.filter((q) => q !== p).map((q) => q.balance),
          tilesWon: p.tilesWon,
          marketTable: market?.table(),
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
    let rec: AuctionRecord = { idx: auctionIdx, letter, paid: 0, winner: -1, bids: bids.length };
    if (first) {
      const paid = second ? second.amount : Math.min(1, first.amount);
      const winner = players[first.i]!;
      if (winner.balance >= paid) {
        winner.balance -= paid;
        winner.tilesWon++;
        winner.spent += paid;
        winner.purchases.push(auctionIdx);
        rec = { idx: auctionIdx, letter, paid, winner: first.i, bids: bids.length };
        addTile(winner.rack, letter);
        if (winner.spec.kind === "sim" && winner.spec.strategy !== "Leader" &&
            (winner.spec.strategy !== "Hoarder" || bag.length > 0)) {
          const { counts, total } = rackCounts(winner.rack);
          const minLen = winner.spec.strategy === "Hoarder" ? (bag.length - 1 <= 8 ? 2 : 7) : 3;
          const w = longestPlay(counts, total, minLen, index);
          if (w) playWordFor(winner, w.word, index, auctionIdx);
        }
      }
    }
    auctions.push(rec);
    market?.observe(BigInt(seed), BigInt(seed) * 1000n + BigInt(auctionIdx), letter, rec.paid);
    for (const p of players) addTile(p.seenLetters, letter);

    // The server settles, runs a built-in winner's automatic play, then
    // immediately draws the next offer or ends the match. External bots
    // observe the next offer already excluded from bagTotal, and cannot
    // submit words after the final settlement.
    if (bag.length === 0) continue;
    const visibleBag = bag.length - 1;
    for (const p of players) {
      ourWordLoop(p, visibleBag, index, auctionIdx);
      if (p.spec.kind === "sim" && p.spec.strategy === "Leader") {
        leaderWordLoop(p, visibleBag, auctionIdx, index);
      }
      if (p.spec.kind === "sim" && p.spec.strategy === "Hoarder" && visibleBag <= 3) {
        for (let g = 0; g < 6; g++) {
          const { counts, total } = rackCounts(p.rack);
          const w = longestPlay(counts, total, 2, index);
          if (!w) break;
          playWordFor(p, w.word, index, auctionIdx);
        }
      }
    }
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
      purchases: p.purchases,
      wordLog: p.wordLog,
    })),
    ranks,
    auctions,
  };
}
