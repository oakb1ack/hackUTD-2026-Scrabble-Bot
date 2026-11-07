// Bidding and word-play strategy.
//
// Economics of the game, which drive every choice here:
//   - Score (the ranking) is the sum of word rewards. Money spent on bids
//     never reduces score. Leftover balance at match end is worth nothing.
//     So the goal is "maximise total reward subject to cash flow", not
//     "buy letters cheaply".
//   - Rewards also refill balance, so playing words funds later bids.
//   - Length multiplier is 1x (<=3), 1.5x (4), 2x (5), 2.5x (6), 3x (7+).
//     Six tiles played as two 3-letter words earn ~1x; as one 6-letter
//     word they earn 2.5x. Hoarding toward 5-7 letter words is the edge.
//   - Vickrey auction: the winner pays the second-highest bid, so bidding
//     your true marginal value is optimal. The work is in valuing letters.
//   - Letters stranded in the rack when the bag empties score zero, so the
//     endgame dumps everything.
//
// All numbers in PARAMS are tuned with `npm run sim`.

import {
  bestPlay,
  DEFAULT_BAG,
  getIndex,
  greedyRackValue,
  missingCount,
  rackCounts,
  LETTER_VALUE,
  type DictionaryIndex,
} from "./dictionary.js";

export { LETTER_VALUE };

export interface StrategyParams {
  // Multiplier from estimated marginal reward to bid amount.
  valueMult: number;
  // Weight on "potential" (words we're 1-2 letters away from) vs immediate.
  potentialWeight: number;
  // Probability we eventually acquire one / two specific missing letters.
  pOneMissing: number;
  pTwoMissing: number;
  // Never bid more than this fraction of balance on one letter mid-game.
  maxSpendFrac: number;
  // Fraction of the remaining auctions we aim to win. Sets the pacing
  // floor: balance / (remaining * targetWinFrac) per useful letter.
  targetWinFrac: number;
  // A letter must be worth at least this much (marginal reward units)
  // before the pacing floor applies to it.
  usefulThreshold: number;
  // Bag size at or below which we're in the endgame.
  endgameBag: number;
  // Play immediately when the best word is at least this long.
  playNowLen: number;
  // Play a word if balance drops below this and the word pays at least
  // cashMinReward, so we can keep bidding.
  cashFloor: number;
  cashMinReward: number;
  // Rack size at which we stop hoarding and cash out the best word.
  holdMaxRack: number;
  // Hold a 5-letter word unless it pays at least this much.
  fiveLetterMinReward: number;
  // Small premium for letters that unlock many words (flexibility).
  breadthWeight: number;
  // Baseline worth of a letter = faceMult * its Scrabble value. Nearly
  // every tile we buy ends up in a 7-letter word (3x), so a Z is worth
  // ~30 on its own even when no specific word is in sight yet. Live
  // market (Nov 2026): Z 25, J/X 23, K/Q 17, H/Y/F 15, B/C/M/P 14.
  faceMult: number;
  // Market-calibrated baseline: marketA + marketB * face reproduces the
  // live clearing prices (Nov 2026: 1-pt ~10, D/G ~12, B/C/M/P ~14,
  // F/H/V/W/Y ~15-16, K ~17, J/X ~23, Z ~25). The leaders buy 3+ letters
  // of face >= 4 per game and build 60-point words around them, so
  // hvPremium is added on those to win more of them.
  marketA: number;
  marketB: number;
  hvPremium: number;
  // Q needs a U; discount its baseline.
  qFactor: number;
  // A letter that completes a word right now is worth the pacing floor
  // plus this fraction of the immediate gain, so it outbids plain glue.
  immediateBonus: number;
}

export const PARAMS: StrategyParams = {
  valueMult: 1.0,
  potentialWeight: 0.9,
  pOneMissing: 0.35,
  pTwoMissing: 0.1,
  maxSpendFrac: 0.6,
  targetWinFrac: 0.25,
  usefulThreshold: 0,
  endgameBag: 8,
  playNowLen: 7,
  cashFloor: 20,
  cashMinReward: 4,
  holdMaxRack: 13,
  fiveLetterMinReward: 99, // effectively: never play 5-letter words early
  breadthWeight: 0.6,
  faceMult: 0,
  marketA: 6,
  marketB: 2.0,
  hvPremium: 3,
  qFactor: 0.6,
  immediateBonus: 0.5,
};

// ---------- Bidding ----------

export interface BidContext {
  letter: string;
  myBalance: number;
  myRack: Map<string, number>;
  // Optional extras supplied by index.ts / the simulator. The original
  // starter only passes the three fields above, so keep these optional.
  bagRemaining?: number; // tiles still in the bag (before this one)
  bagCounts?: Record<string, number>; // estimated remaining per letter
  recentPaid?: number[]; // what recent auctions cleared at
  params?: Partial<StrategyParams>;
  index?: DictionaryIndex;
}

export function decideBid(ctx: BidContext): number {
  const p = { ...PARAMS, ...(ctx.params ?? {}) };
  const index = ctx.index ?? getIndex();
  const letter = ctx.letter.toUpperCase();
  const slot = letter.charCodeAt(0) - 65;
  if (slot < 0 || slot >= 26) return 0;
  if (ctx.myBalance <= 0) return 0;

  const face = LETTER_VALUE[letter] ?? 1;
  const { counts, total } = rackCounts(ctx.myRack);
  const withLetter = new Uint8Array(counts);
  withLetter[slot] = withLetter[slot]! + 1;

  // 1. Immediate: how much does the best word we can play right now improve?
  const before = greedyRackValue(counts, total, index);
  const after = greedyRackValue(withLetter, total + 1, index);
  const immediate = Math.max(0, after - before);

  // 2. Potential: high-reward words containing this letter that we'd be
  //    within two tiles of. Weighted by how likely those tiles are, using
  //    the remaining bag composition when we have it.
  const bag = ctx.bagCounts ?? DEFAULT_BAG;
  const bagTotal = Object.values(bag).reduce((a, b) => a + b, 0) || 1;
  let potential = 0;
  let breadth = 0;
  const candidates = index.containing.get(letter) ?? [];
  const maxLen = total + 3;
  for (const w of candidates) {
    if (w.word.length > maxLen || w.word.length < 4) continue;
    // Potential is about improving on what we already have.
    if (w.reward <= before) continue;
    const missing = missingCount(w, withLetter);
    if (missing > 2) continue;
    let prob: number;
    if (missing === 0) {
      prob = 1; // already counted in immediate, but it still widens breadth
    } else {
      // Scale by availability of the missing letters in the bag.
      let avail = 0;
      for (let i = 0; i < 26; i++) {
        const d = w.counts[i]! - withLetter[i]!;
        if (d > 0) avail += bag[String.fromCharCode(65 + i)] ?? 0;
      }
      const availFrac = Math.min(1, (avail / bagTotal) * 6); // ~6 players
      prob = (missing === 1 ? p.pOneMissing : p.pTwoMissing) * (0.5 + availFrac);
    }
    const gain = (w.reward - before) * prob;
    if (gain > potential) potential = gain;
    breadth += prob;
    if (breadth > 60) break; // plenty of evidence; keep it fast
  }
  const flexibility = p.breadthWeight * Math.log1p(breadth);

  let baseline = Math.max(
    p.faceMult * face,
    p.marketA + p.marketB * face + (face >= 4 ? p.hvPremium : 0),
  );
  if (letter === "Q") baseline *= p.qFactor;
  let value =
    Math.max(immediate, p.potentialWeight * potential, baseline) + flexibility;

  // Duplicates of a letter we already hold two of are rarely useful.
  if (counts[slot]! >= 2) value *= 0.5;

  // 3. Budget pacing. Late in the match money is worth less (it can't be
  //    spent), so loosen the cap; early, keep powder dry.
  const remaining = ctx.bagRemaining ?? 60;
  const endgame = remaining <= p.endgameBag;
  let cap = endgame
    ? ctx.myBalance
    : Math.max(3, Math.floor(ctx.myBalance * p.maxSpendFrac));
  if (remaining <= p.endgameBag * 2 && !endgame) {
    cap = Math.max(cap, Math.floor(ctx.myBalance * 0.7));
  }

  // Pacing floor: unspent balance at match end is worth nothing, so a
  // useful letter is worth at least our fair share of the remaining
  // budget. Under Vickrey we only pay the runner-up's bid anyway.
  let bid = Math.round(value * p.valueMult);
  if (value >= p.usefulThreshold) {
    const expectedWins = Math.max(2, remaining * p.targetWinFrac);
    const perTile = Math.floor(ctx.myBalance / expectedWins);
    bid = Math.max(bid, perTile, Math.min(face, 3));
    if (immediate > 0) {
      bid = Math.max(bid, perTile + Math.round(p.immediateBonus * immediate));
    }
  }
  if (endgame && bid > 0) {
    // Nothing to save money for; outbid the sims' face-value habit.
    bid = Math.max(bid, Math.min(ctx.myBalance, face + 3));
  }
  if (bid <= 0) return 0;
  return Math.max(1, Math.min(bid, cap, ctx.myBalance));
}

// ---------- Word play ----------

export interface WordContext {
  myRack: Map<string, number>;
  dictionary: string[]; // kept for compatibility; the index is used instead
  bagRemaining?: number;
  myBalance?: number;
  params?: Partial<StrategyParams>;
  index?: DictionaryIndex;
}

/**
 * Pick a word to play now, or return null to keep hoarding.
 * Called on every rack change and after every auction; keep it fast.
 */
export function chooseWord(ctx: WordContext): string | null {
  const p = { ...PARAMS, ...(ctx.params ?? {}) };
  const index = ctx.index ?? getIndex();
  const { counts, total } = rackCounts(ctx.myRack);
  if (total < 2) return null;

  const best = bestPlay(counts, total, index);
  if (!best) return null;

  const remaining = ctx.bagRemaining ?? 60;
  const balance = ctx.myBalance ?? 100;

  // Endgame: everything left unplayed is worthless. Dump the best word;
  // the rack change triggers another call for the rest.
  if (remaining <= p.endgameBag) return best.word;

  // A long word is the whole point. Take it.
  if (best.word.length >= p.playNowLen) return best.word;

  // Cash-starved: convert something so we can keep bidding.
  if (balance < p.cashFloor && best.reward >= p.cashMinReward) return best.word;

  // Rack is bloated and still nothing long: recycle the best option.
  if (total >= p.holdMaxRack) return best.word;

  // Five-letter words are worth playing when they pay well; otherwise the
  // letters are more valuable as building material.
  if (best.word.length === 5 && best.reward >= p.fiveLetterMinReward) {
    return best.word;
  }

  return null;
}
