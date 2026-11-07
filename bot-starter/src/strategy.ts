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
  // F/H/V/W/Y ~15-16, K ~17, J/X ~23, Z ~25). The leaders win because
  // they buy ~21 tiles a match (we bought 13): hoard to 11, play a 7+
  // word, reinvest, repeat 3-4 times. Glue must be bought at market from
  // auction one or the flywheel never starts. hvPremium is added on
  // face >= 4 letters, which anchor the 50-70 point words.
  marketA: number;
  marketB: number;
  hvPremium: number;
  // Q needs a U; discount its baseline.
  qFactor: number;
  // A letter that completes a word right now is worth the pacing floor
  // plus this fraction of the immediate gain, so it outbids plain glue.
  immediateBonus: number;
  // --- From the opponent analysis of Bron (114) and LUCENT (18), Nov 2026 ---
  // Extra premium on face >= 5 letters (K, J, X, Q, Z). Bron buys 2x our
  // rate of these and its 7-letter words pay 10 more than ours purely
  // from letter mix.
  bigPremium: number;
  // Holding a Q with no U: bid this much extra on a U.
  qNeedsU: number;
  // Glue discipline: multiply baseline by this when the rack already holds
  // >= vowelCap vowels (we bought 48% vowels; leaders 42%).
  vowelCap: number;
  vowelDiscount: number;
  // Phase pacing: leaders back-load, buying when tiles are cheapest.
  // targetWinFrac early (bag > 48), mid, late (bag < 23).
  winFracEarly: number;
  winFracLate: number;
  // Early-game play gate: before the bag is down to midgameBag, play a
  // 7+ word only if it pays at least playNowReward; otherwise keep
  // building. Leaders' first word averages 45 at auction 26-29; ours was
  // 35 at auction 13.
  midgameBag: number;
  playNowReward: number;
  // Never bid above this on a single Z/Q from baseline alone.
  maxPremiumBid: number;
  // Below this many tiles left, premium baselines taper to the glue price
  // (face >= 8 only; mid-game H/W/Y/K at 12-20 are the bargains winners
  // use, so those keep full value until the bag is nearly out).
  premiumTaperBag: number;
  midPremiumTaperBag: number;
  // The cap never drops below the glue price while we can afford it:
  // match analysis showed 53% of our mid-game bids pinned at
  // floor(0.6 x balance) = 7-9 against a flat glue market of 10.
  capFloor: number;
  // First-half reserve: while the bag is above reserveBag and the letter
  // completes nothing, don't spend balance below this. Winners buy 2.5
  // tiles per 15 auctions early; we bought 5.1 and were broke by #30.
  reserveBag: number;
  reserveBalance: number;
  // Second-stage reserve for the late bargain market (bag reserveBag..
  // lateReserveBag): winners buy W/V/K/J at 12-14 with the bag under 23;
  // we were at balance 5 then (match 42982).
  lateReserveBag: number;
  lateReserveBalance: number;
  // Immediate gain needed to spend into the reserve.
  reserveBypassGain: number;
  // Rack balance: once this share of the rack is premium (face >= 4),
  // further premium baselines are multiplied by premiumGlut. Match
  // 43008: 7 premiums, no vowels, three short words. Leaders run ~20%.
  premiumShareCap: number;
  premiumGlut: number;
  // With fewer than this many vowels in the rack, vowels bypass the reserve.
  minVowels: number;
  // A 7-letter word before midgame needs at least this reward (kills
  // LOONIES for 21); 40+ plays at any length regardless.
  playNowReward7: number;
  // Phase-aware market floor for premium letters (face >= 4): median
  // clearing prices from 127 live matches, by bag remaining. Early
  // premiums are overpriced (Z 35, 5-8pt 31) and we don't chase them;
  // mid/late they drop to 16-22 and that's where winners buy theirs.
  // Added on top of the market baseline as max(baseline, median + 1).
  useMarketTable: number; // 1 = on
  // Cash reserve for premium letters: while the bag is above
  // premiumTaperBag, glue (face <= 2) bids may not take balance below
  // this, so a Z/J/X that shows up is affordable. Match 42908: we spent
  // down on glue (face 1.64) and then bid 7 on V, J, W and Y that
  // cleared at 14-22.
  premiumReserve: number;
  // --- Countermeasures (Vickrey tactics against the live leaders) ---
  // Price pushing: bid at least (market - pushUnder) on every letter we
  // don't want, so the winner (usually a leader's glue) pays market
  // instead of a bargain. Under Vickrey we only ever pay the runner-up,
  // so if we do win we got it cheap. Set pushUnder 99 to disable.
  pushUnder: number;
  // Only push while our balance is above this (don't starve ourselves).
  pushMinBalance: number;
  // Premium security: when no rival can outspend us, add this on
  // face >= 4 letters to lock them in.
  richPremium: number;
  // Thin field: when at least this many rivals are broke (< brokeBalance),
  // buy harder; competition for tiles is gone.
  brokeBalance: number;
  brokeCount: number;
  thinFieldBoost: number;
  // Cash crunch: with balance under this and a word worth at least
  // crunchReward in hand, cash it so we can keep buying.
  crunchBalance: number;
  crunchReward: number;
}

// Median clearing price by phase; index by bag remaining.
// phases: early (bag > 52), early-mid (37-52), mid (23-36), late (9-22), end (<= 8)
const MARKET_TABLE: Record<"p4" | "p58" | "pZQ", number[]> = {
  p4: [21, 19, 16, 17, 12],
  p58: [31, 26, 22, 17, 13],
  pZQ: [35, 28, 22, 20, 12],
};
function phaseIndex(remaining: number): number {
  if (remaining > 52) return 0;
  if (remaining > 36) return 1;
  if (remaining > 22) return 2;
  if (remaining > 8) return 3;
  return 4;
}

export const PARAMS: StrategyParams = {
  valueMult: 1.0,
  potentialWeight: 0.9,
  pOneMissing: 0.35,
  pTwoMissing: 0.1,
  maxSpendFrac: 0.75,
  targetWinFrac: 0.25,
  usefulThreshold: 0,
  endgameBag: 8,
  playNowLen: 7,
  cashFloor: 12,
  cashMinReward: 12,
  holdMaxRack: 13,
  fiveLetterMinReward: 99, // effectively: never play 5-letter words early
  breadthWeight: 0.6,
  faceMult: 0,
  marketA: 8,
  marketB: 2.0,
  hvPremium: 3,
  qFactor: 0.6,
  immediateBonus: 0.5,
  bigPremium: 6,
  qNeedsU: 8,
  vowelCap: 4,
  vowelDiscount: 0.85,
  winFracEarly: 0.12,
  winFracLate: 0.35,
  midgameBag: 30,
  playNowReward: 40,
  maxPremiumBid: 28,
  premiumTaperBag: 35,
  midPremiumTaperBag: 12,
  premiumReserve: 0,
  capFloor: 12,
  reserveBag: 40,
  reserveBalance: 35,
  lateReserveBag: 12,
  lateReserveBalance: 20,
  reserveBypassGain: 15,
  premiumShareCap: 0.3,
  premiumGlut: 0.6,
  minVowels: 2,
  playNowReward7: 30,
  useMarketTable: 1,
  pushUnder: 1,
  pushMinBalance: 30,
  richPremium: 2,
  brokeBalance: 12,
  brokeCount: 3,
  thinFieldBoost: 1.3,
  crunchBalance: 30,
  crunchReward: 18,
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
  rivalBalances?: number[]; // other bots' current balances in this match
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
  let scanned = 0;
  // Racks beyond holdMaxRack don't occur in play (chooseWord cashes out
  // first); skip the potential scan so a pathological rack can't stall.
  const scanLimit = total > p.holdMaxRack + 1 ? 0 : 5000;
  for (const w of candidates) {
    if (scanLimit === 0) break;
    // Hard bound on work: candidates are reward-sorted, so the first few
    // thousand hold every word that could matter.
    if (++scanned > 5000) break;
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

  // Premiums only on K/J/X (face 5-8); the formula already exceeds the
  // market for Z/Q, and a 35 bid on a Z at auction 15 starved us for the
  // rest of match 42855.
  let baseline = Math.max(
    p.faceMult * face,
    p.marketA +
      p.marketB * face +
      (face >= 4 && face <= 8 ? p.hvPremium : 0) +
      (face >= 5 && face <= 8 ? p.bigPremium : 0),
  );
  if (face >= 10) baseline = Math.min(baseline, p.maxPremiumBid);
  // A premium letter bought with the bag nearly empty rarely finds its
  // word (J@30 at bag 15 became JO for 9). Taper the baseline toward the
  // glue price as the bag runs down; completing a word still bids fully
  // through `immediate`.
  const remainingNow = ctx.bagRemaining ?? 60;
  const taperBag = face >= 8 ? p.premiumTaperBag : p.midPremiumTaperBag;
  if (face >= 4 && remainingNow < taperBag) {
    const glue = p.marketA + p.marketB;
    const t = Math.max(0, remainingNow) / taperBag;
    baseline = glue + (baseline - glue) * t;
  }
  if (p.useMarketTable && face >= 4) {
    const ph = phaseIndex(remainingNow);
    const row = face >= 10 ? MARKET_TABLE.pZQ : face >= 5 ? MARKET_TABLE.p58 : MARKET_TABLE.p4;
    const median = row[ph]!;
    // Never chase the overpriced early premiums; from early-mid on, be
    // at least at market so the bargains come to us.
    if (ph >= 1) baseline = Math.max(baseline, median + 1);
    if (face >= 10) baseline = Math.min(baseline, Math.max(p.maxPremiumBid, median + 1));
  }
  let premiumCount = 0;
  for (let i = 0; i < 26; i++) {
    if ((LETTER_VALUE[String.fromCharCode(65 + i)] ?? 0) >= 4) premiumCount += counts[i]!;
  }
  if (face >= 4 && total > 0 && premiumCount / total >= p.premiumShareCap) {
    baseline *= p.premiumGlut;
  }
  const haveU = counts["U".charCodeAt(0) - 65]! > 0;
  const haveQ = counts["Q".charCodeAt(0) - 65]! > 0;
  if (letter === "Q" && !haveU) baseline *= p.qFactor;
  if (letter === "U" && haveQ && !haveU) baseline += p.qNeedsU;
  // Glue discipline: a rack already full of vowels doesn't need another.
  const isVowel = "AEIOU".includes(letter);
  let vowels = 0;
  for (const c of "AEIOU") vowels += counts[c.charCodeAt(0) - 65]!;
  if (isVowel && vowels >= p.vowelCap) baseline *= p.vowelDiscount;
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
  // Endgame: a tile we can't play immediately is wasted money.
  if (endgame && immediate <= 0) return 0;

  const rivals = ctx.rivalBalances ?? [];
  const richest = rivals.length ? Math.max(...rivals) : Infinity;
  const broke = rivals.filter((b) => b < p.brokeBalance).length;

  if (value >= p.usefulThreshold) {
    let winFrac =
      remaining > 48 ? p.winFracEarly : remaining < 23 ? p.winFracLate : p.targetWinFrac;
    if (broke >= p.brokeCount) winFrac *= p.thinFieldBoost;
    const expectedWins = Math.max(2, remaining * winFrac);
    const perTile = Math.floor(ctx.myBalance / expectedWins);
    bid = Math.max(bid, perTile, Math.min(face, 3));
    if (immediate > 0) {
      bid = Math.max(bid, perTile + Math.round(p.immediateBonus * immediate));
    }
  }
  // The cap must not pin us below the glue market while we can pay it.
  if (!endgame && ctx.myBalance >= p.capFloor) cap = Math.max(cap, p.capFloor);

  // First-half reserve: keep money for the cheaper second-half market
  // unless this letter completes a word right now.
  // "Completes a word" means a real jump (>= reserveBypassGain), not the
  // 1-3 point nudge almost any vowel gives the greedy rack value; that
  // loophole drained us to balance 4 in match 42998.
  if (immediate < p.reserveBypassGain && remaining > p.lateReserveBag) {
    const reserve = remaining > p.reserveBag ? p.reserveBalance : p.lateReserveBalance;
    // Premium letters are what the reserve is for; glue respects it,
    // except vowels when the rack can't make words without one.
    const needVowel = isVowel && vowels < p.minVowels;
    if (face < 4 && !needVowel) {
      const spendable = ctx.myBalance - reserve;
      if (spendable <= 0) return 0;
      cap = Math.min(cap, spendable);
    }
  }
  // (legacy knob, off by default)
  if (p.premiumReserve > 0 && face <= 2 && remaining >= p.premiumTaperBag && immediate <= 0) {
    const spendable = ctx.myBalance - p.premiumReserve;
    if (spendable <= 0) return 0;
    cap = Math.min(cap, spendable);
  }

  // Price pushing on letters we'd otherwise let go cheap.
  if (!endgame && ctx.myBalance >= p.pushMinBalance) {
    const market = p.marketA + p.marketB * face - p.pushUnder;
    bid = Math.max(bid, Math.round(market));
  }
  // Premium security when nobody at the table can outspend us.
  if (face >= 4 && richest < ctx.myBalance) bid += p.richPremium;

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

  // A big payout is worth cashing at any length (BRONZY, 6 letters, 50).
  if (best.reward >= p.playNowReward) return best.word;

  // Low on cash with a decent word in hand: cash it and keep buying.
  // Match 42855: balance 16 and a 50-point word held for 40 auctions.
  if (balance < p.crunchBalance && best.reward >= p.crunchReward) {
    return best.word;
  }

  // A long word is the whole point, but early on only a *good* one:
  // a 7-letter word of 1-point letters pays 21; waiting a few tiles for
  // a premium letter turns it into 40-60.
  if (best.word.length >= p.playNowLen) {
    if (remaining <= p.midgameBag || best.reward >= p.playNowReward7) {
      return best.word;
    }
    if (total >= p.holdMaxRack) return best.word;
    return null;
  }

  // Cash-starved: convert something so we can keep bidding. Leaders play
  // no 2-3 letter words before the endgame, so this needs a real crunch.
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
