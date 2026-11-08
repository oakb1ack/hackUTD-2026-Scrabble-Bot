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
  canSpellCounts,
  DEFAULT_BAG,
  bestPairValue,
  getIndex,
  greedyRackValue,
  missingCount,
  rackCounts,
  rackMasks,
  reachableCandidates,
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
  // Tempo (calibrated sim, Nov 7): we bought 13 of 14 tiles in the first
  // 31 auctions at peak prices and played our first word at auction 7;
  // leaders hold ~10 tiles to auction 29-45 and do 60% of their buying
  // in auctions 31-59 where premiums are 25-40% cheaper. A HARD spending
  // floor by phase: skip the bid entirely when balance - floor < bid,
  // unless the letter completes a word (immediate >= reserveBypassGain)
  // or is a planner target. Phases by bag remaining: >52, >36, >22, >8, rest.
  spendFloorByPhase: number[];
  // Experimental: cap affordable bids at balance minus the phase reserve,
  // instead of skipping when the unconstrained valuation exceeds it.
  reserveAsCap: number;
  // Experimental refill premium for suitable new common letters on a
  // small, funded rack in mid/late game. Clamped to at most 4 currency.
  refillBonus: number;
  // Immediate gain needed to spend into the reserve.
  reserveBypassGain: number;
  // Rack balance: once this share of the rack is premium (face >= 4),
  // further premium baselines are multiplied by premiumGlut. Match
  // 43008: 7 premiums, no vowels, three short words. Leaders run ~20%.
  premiumShareCap: number;
  premiumGlut: number;
  // Target a modest share of premium tiles in the rack. When a unique
  // premium would bring the rack up to this share, this bounded bonus can
  // help secure it without raising premium bids for already-rich racks.
  premiumNeedShare: number;
  premiumNeedBonus: number;
  // With fewer than this many vowels in the rack, vowels bypass the reserve.
  minVowels: number;
  // Added to every premium bid to win the by-one losses at market.
  tieBump: number;
  // Premium bids sit at marketMult x the live median from early-mid on.
  // At 1.0 we set the price and lose as runner-up (K@31/31, Q@30/30,
  // Z@32/32 in match 43166); winners pay above median and convert.
  marketMult: number;
  // Execution pacing (VWAP-style): target tiles bought by auction index,
  // following the live winners' purchase profile (2.5/2.6/2.9/4.4/1.4
  // per 15 auctions = 13.8 tiles). A feedback multiplier scales bids by
  // 1 + paceGain x (targetTiles - tilesWon), clamped to [paceMin, paceMax].
  // Replaces hand-tuned reserves as the main pacing mechanism.
  paceGain: number;
  paceMin: number;
  paceMax: number;
  paceTarget: number; // total tiles to aim for over the match
  // --- Word-targeting planner ---
  // From the rack, pick the best 7+ letter words within targetMissing
  // tiles, weighted by reward x availability of the missing letters in
  // the bag x targetDecay^missing. For the letter on offer, if it is one
  // of a target's missing letters, value it at targetShare x reward /
  // missing (the leaders buy exactly what their next word needs: 80% of
  // their purchases land in it, vs 73% of ours and 15% never played).
  targetMissing: number;
  targetDecay: number;
  targetShare: number;
  targetTopN: number;
  targetMinLen: number;
  // Only words worth at least this are targets (cheap 7-letter words of
  // 1-pointers pay 21-30 and aren't worth paying 19 for an E).
  targetMinReward: number;
  // A 7-letter word before midgame needs at least this reward (kills
  // LOONIES for 21); 40+ plays at any length regardless.
  playNowReward7: number;
  // Experimental: consider an eligible long word when the highest-reward
  // word is shorter and would otherwise be held.
  longWordFallback: number;
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
  // --- Monte Carlo expected-value valuation (experimental) ---
  // mcSamples rollouts estimate E[rack value | win this letter] minus
  // E[rack value | don't], where each rollout draws K future tiles from
  // the estimated bag and values rack(+letter)+K with a reward-sorted
  // candidate list. 0 disables it. K = clamp(remaining * mcKFrac,
  // mcKMin, mcKMax) unless mcK > 0 fixes it. mcWeight scales the gain
  // before it competes with the market baseline; mcCandidates bounds the
  // per-call candidate list (and hence the per-rollout scan).
  mcSamples: number;
  mcK: number;
  mcKFrac: number;
  mcKMin: number;
  mcKMax: number;
  mcWeight: number;
  mcCandidates: number;
  // Candidate words must be within this many tiles of rack+letter. Words
  // missing 4+ specific tiles almost never complete in K draws, and
  // dropping them keeps the per-rollout scan short.
  mcMissing: number;
  // 0: MC gain competes with the market baseline (can only raise bids).
  // 1: MC replaces the baseline: max(glue market, mcOffset + mcWeight *
  //    gain), so letters the rollouts rarely use (J/X/Q/K) bid lower.
  mcMode: number;
  mcOffset: number;
}

// ---------- Word-targeting planner ----------
interface Target {
  idx: number; // index into byReward
  reward: number;
  missing: Uint8Array; // per-letter missing counts (26)
  missingTotal: number;
  weight: number; // reward x feasibility
}
let targetCacheKey = "";
let targetCache: Target[] = [];

export function planTargets(
  counts: Uint8Array,
  total: number,
  bag: Record<string, number>,
  p: StrategyParams,
  index: DictionaryIndex,
): Target[] {
  let key = "";
  for (let i = 0; i < 26; i++) key += counts[i]!.toString(36);
  key += "|" + Object.values(bag).reduce((a, b) => a + b, 0);
  if (key === targetCacheKey) return targetCache;
  const cands = reachableCandidates(counts, total, p.targetMissing, 20000, p.targetMinLen, index);
  const out: Target[] = [];
  for (let c = 0; c < cands.length; c++) {
    const k = cands[c]!;
    const w = index.byReward[k]!;
    if (w.reward < p.targetMinReward) continue;
    const missing = new Uint8Array(26);
    let missingTotal = 0;
    let feas = 1;
    for (let i = 0; i < 26; i++) {
      const d = w.counts[i]! - counts[i]!;
      if (d > 0) {
        missing[i] = d;
        missingTotal += d;
        const avail = bag[String.fromCharCode(65 + i)] ?? 0;
        // Each missing copy needs a tile still in the bag; scarce letters
        // make the word unlikely.
        feas *= Math.min(1, avail / (d * 1.5));
      }
    }
    if (feas <= 0) continue;
    const weight = w.reward * feas * Math.pow(p.targetDecay, missingTotal);
    out.push({ idx: k, reward: w.reward, missing, missingTotal, weight });
  }
  out.sort((a, b) => b.weight - a.weight);
  targetCache = out.slice(0, p.targetTopN);
  targetCacheKey = key;
  return targetCache;
}

// Value of `slot` toward the current targets: the best share of any
// target word's reward that this letter unlocks.
function targetValue(targets: Target[], slot: number, p: StrategyParams): number {
  let best = 0;
  for (const t of targets) {
    if (t.missing[slot]! > 0) {
      const v = (p.targetShare * t.reward) / Math.max(1, t.missingTotal) + (t.missingTotal === 1 ? 4 : 0);
      if (v > best) best = v;
    }
  }
  return best;
}

// Cumulative share of the winners' purchases by auction index (0..68),
// from live data: 2.5 / 2.6 / 2.9 / 4.4 / 1.4 tiles per 15-auction phase.
const PACE_PROFILE = [2.5, 2.6, 2.9, 4.4, 1.4];
function targetTilesAt(auctionIdx: number, total: number): number {
  const sum = PACE_PROFILE.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let ph = 0; ph < PACE_PROFILE.length; ph++) {
    const start = ph * 15;
    const len = ph === 4 ? 8 : 15;
    const frac = Math.max(0, Math.min(1, (auctionIdx - start) / len));
    acc += PACE_PROFILE[ph]! * frac;
  }
  return (acc / sum) * total;
}

// Median clearing price by phase; index by bag remaining.
// phases: early (bag > 52), early-mid (37-52), mid (23-36), late (9-22), end (<= 8)
// Fallback when the live learner has too few samples. Re-measured from
// matches 43000-43174 (Nov 7, 18:00 CST): the field got more aggressive
// over the evening, mid/late premiums up 3-8 from the afternoon table.
const MARKET_TABLE: Record<"p4" | "p58" | "pZQ", number[]> = {
  p4: [19, 18, 18, 16, 11],
  p58: [27, 26, 25, 23, 14],
  pZQ: [32, 33, 30, 22, 11],
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
  reserveBalance: 0, // off: with the planner, direction comes from targets; the reserve starved tile volume
  lateReserveBag: 12,
  lateReserveBalance: 0,
  spendFloorByPhase: [28, 16, 0, 0, 0],
  // The completed interleaved live trial favored capping bids to spendable
  // funds. Keep the old behavior available as the liveBaseline control.
  reserveAsCap: 1,
  refillBonus: 0,
  reserveBypassGain: 15,
  premiumShareCap: 0.3,
  premiumGlut: 0.6,
  premiumNeedShare: 0.22,
  premiumNeedBonus: 0,
  minVowels: 2,
  tieBump: 3,
  marketMult: 1.0,
  paceGain: 0, // off: sim A/B vs Hoarders lost 3-5 pts at 0.08-0.12; revisit with calibrated sim
  paceMin: 0.7,
  paceMax: 1.5,
  paceTarget: 15,
  targetMissing: 2,
  targetDecay: 0.6,
  targetShare: 0.55,
  targetTopN: 0, // planner off: no gain vs calibrated Leaders (80.0 off vs 78.4 on)
  targetMinLen: 7,
  targetMinReward: 42,
  playNowReward7: 40, // first word should land at a ~10-tile rack, auction 25-30, not auction 7
  longWordFallback: 0,
  useMarketTable: 1,
  pushUnder: 1,
  pushMinBalance: 30,
  richPremium: 2,
  brokeBalance: 12,
  brokeCount: 3,
  thinFieldBoost: 1.3,
  crunchBalance: 14,
  crunchReward: 18,
  // Retain the face-value baseline: fresh Leader trials outperformed
  // replacement mode when paired with lighter spending reserves.
  mcSamples: 64,
  mcK: 0,
  mcKFrac: 0.22,
  mcKMin: 3,
  mcKMax: 9,
  mcWeight: 1.0,
  mcCandidates: 80000,
  mcMissing: 3,
  mcMode: 0,
  mcOffset: 2,
};

// ---------- Monte Carlo valuation ----------

// Small deterministic PRNG (mulberry32) so a given rack/letter/bag always
// yields the same bid; seeded from the inputs.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Expected marginal rack value of winning `slot`, by sampling K future
 * tiles from `bag` and valuing rack+K with and without the letter using
 * the same draws (common random numbers). Exposed for tests / tuning.
 */
export function monteCarloGain(
  counts: Uint8Array,
  total: number,
  slot: number,
  bag: Record<string, number>,
  remaining: number,
  p: StrategyParams,
  index: DictionaryIndex,
): { gain: number; k: number; candidates: number } {
  const k =
    p.mcK > 0
      ? p.mcK
      : Math.max(p.mcKMin, Math.min(p.mcKMax, Math.round(remaining * p.mcKFrac)));
  const withLetter = new Uint8Array(counts);
  withLetter[slot] = withLetter[slot]! + 1;
  // Candidate words: within mcMissing tiles of rack+letter. Any word the
  // without-rack can spell from these draws is also in here.
  const cands = reachableCandidates(
    withLetter, total + 1, Math.min(k, p.mcMissing), p.mcCandidates, 4, index,
  );
  if (cands.length === 0) return { gain: 0, k, candidates: 0 };

  // Bag as a 26-slot pool (never let the offered letter's own copy count).
  const pool = new Int32Array(26);
  let poolTotal = 0;
  for (let i = 0; i < 26; i++) {
    const n = bag[String.fromCharCode(65 + i)] ?? 0;
    pool[i] = n;
    poolTotal += n;
  }
  if (poolTotal <= 0) return { gain: 0, k, candidates: cands.length };

  let seed = slot * 7919 + total * 131 + remaining;
  for (let i = 0; i < 26; i++) seed = (seed * 31 + counts[i]!) | 0;
  const rnd = mulberry32(seed);

  const draw = new Int32Array(26);
  const rackA = new Uint8Array(26);
  const rackB = new Uint8Array(26);
  let sum = 0;
  for (let s = 0; s < p.mcSamples; s++) {
    // Draw K tiles without replacement from the pool.
    draw.fill(0);
    let left = poolTotal;
    const n = Math.min(k, poolTotal);
    for (let d = 0; d < n; d++) {
      let r = Math.floor(rnd() * left);
      let i = 0;
      for (; i < 25; i++) {
        const avail = pool[i]! - draw[i]!;
        if (r < avail) break;
        r -= avail;
      }
      draw[i]!++;
      left--;
    }
    for (let i = 0; i < 26; i++) {
      rackA[i] = counts[i]! + draw[i]!;
      rackB[i] = withLetter[i]! + draw[i]!;
    }
    const [without, withL] = bestPairValue(cands, rackA, rackB, index);
    sum += withL - without;
  }
  return { gain: sum / p.mcSamples, k, candidates: cands.length };
}

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
  tilesWon?: number; // tiles we've bought so far this match
  // Live market medians by class ("p4" | "p58" | "pZQ") and phase, learned
  // from the auction_result stream; cells with too few samples are null.
  marketTable?: Record<"p4" | "p58" | "pZQ", (number | null)[]>;
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

  // 2b. Monte Carlo: expected marginal best-word reward after K more
  //     tiles, with vs without this letter (same draws).
  const remainingNow = ctx.bagRemaining ?? 60;
  let mcGain = 0;
  if (p.mcSamples > 0) {
    mcGain = monteCarloGain(counts, total, slot, bag, remainingNow, p, index).gain;
  }

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
  if (p.mcSamples > 0 && p.mcMode === 1) {
    // Replace the face-value formula with the sampled expectation; glue
    // still clears at market so the flywheel keeps turning.
    baseline = Math.max(p.marketA + p.marketB, p.mcOffset + p.mcWeight * mcGain);
  }
  // A premium letter bought with the bag nearly empty rarely finds its
  // word (J@30 at bag 15 became JO for 9). Taper the baseline toward the
  // glue price as the bag runs down; completing a word still bids fully
  // through `immediate`.
  const taperBag = face >= 8 ? p.premiumTaperBag : p.midPremiumTaperBag;
  if (face >= 4 && remainingNow < taperBag) {
    const glue = p.marketA + p.marketB;
    const t = Math.max(0, remainingNow) / taperBag;
    baseline = glue + (baseline - glue) * t;
  }
  if (p.useMarketTable && face >= 4) {
    const ph = phaseIndex(remainingNow);
    const cls = face >= 10 ? "pZQ" : face >= 5 ? "p58" : "p4";
    const live = ctx.marketTable?.[cls]?.[ph];
    const median = live ?? MARKET_TABLE[cls][ph]!;
    // Never chase the overpriced early premiums; from early-mid on, be
    // at least at market so the bargains come to us.
    if (ph >= 1) baseline = Math.max(baseline, median * p.marketMult + 1);
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
  // In mode 0 the MC gain competes with the baseline (it rarely wins: the
  // single-word horizon values glue at ~1-3 and Z at ~20-24).
  const mcValue = p.mcMode === 0 ? p.mcWeight * mcGain : 0;
  let value =
    Math.max(immediate, p.potentialWeight * potential, baseline, mcValue) + flexibility;

  // Strong live bots buy a slightly richer rack than ours. Add a small,
  // targeted premium bonus only when a unique 4+ point tile would bring
  // the rack up to its target premium share. This avoids blanket inflation.
  const premiumShareAfter = (premiumCount + 1) / (total + 1);
  if (
    p.premiumNeedBonus > 0 && face >= 4 && counts[slot] === 0 && total >= 4 &&
    remainingNow > Math.max(12, p.endgameBag) && premiumShareAfter <= p.premiumNeedShare
  ) {
    value += p.premiumNeedBonus;
  }

  // Word targeting: a letter that one of our target words needs is worth
  // its share of that word, on top of whatever the market says.
  let targeted = false;
  if (p.targetTopN > 0 && total >= 3) {
    const targets = planTargets(counts, total, bag, p, index);
    const tv = targetValue(targets, slot, p);
    if (tv > 0) {
      targeted = true;
      value = Math.max(value, tv + (p.marketA + p.marketB * face) * 0.5);
    }
  }

  // Duplicates of a letter we already hold two of are rarely useful.
  if (counts[slot]! >= 2 && !targeted) value *= 0.5;

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
  // Execution pacing: behind the winners' purchase curve -> bid up;
  // ahead -> bid down. Completions are exempt (always worth it).
  let pace = 1;
  if (ctx.tilesWon !== undefined && immediate < p.reserveBypassGain) {
    const auctionIdx = Math.max(0, 68 - remaining);
    const target = targetTilesAt(auctionIdx, p.paceTarget);
    pace = Math.max(p.paceMin, Math.min(p.paceMax, 1 + p.paceGain * (target - ctx.tilesWon)));
  }
  let bid = Math.round(value * p.valueMult * pace);
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

  // Rebuild a short rack after cashing a word. Repeated market-price
  // ties on useful glue can otherwise leave a funded rack stalled.
  // Keep the boost narrow: new common letters, enough cash to continue,
  // and additions that improve balance or flexible consonants when the
  // rack has enough vowels. All spending caps and reserves still apply.
  if (
    p.refillBonus > 0 && face <= 3 && remaining <= 36 && !endgame &&
    ctx.myBalance >= 25 && total <= 6 && counts[slot] === 0
  ) {
    const closerToBalance = total === 0 ||
      Math.abs((vowels + (isVowel ? 1 : 0)) / (total + 1) - 0.4) <
        Math.abs(vowels / total - 0.4);
    const flexibleConsonant = !isVowel && "RSTLNDGCMPB".includes(letter);
    if (closerToBalance || (flexibleConsonant && vowels * 3 >= total)) {
      bid += Math.min(4, Math.round(p.refillBonus));
    }
  }

  // The cap must not pin us below the glue market while we can pay it.
  if (!endgame && ctx.myBalance >= p.capFloor) cap = Math.max(cap, p.capFloor);

  // First-half reserve: keep money for the cheaper second-half market
  // unless this letter completes a word right now.
  // "Completes a word" means a real jump (>= reserveBypassGain), not the
  // 1-3 point nudge almost any vowel gives the greedy rack value; that
  // loophole drained us to balance 4 in match 42998.
  if (immediate < p.reserveBypassGain && !targeted && remaining > p.lateReserveBag) {
    const reserve = remaining > p.reserveBag ? p.reserveBalance : p.lateReserveBalance;
    // Premium letters are what the reserve is for; glue respects it,
    // except when the rack can't convert without it: too few vowels, or
    // already premium-heavy (match 43043: W Z F Y H cashed as ZEDS and
    // CROFT for lack of glue while 15 auctions went unbid).
    const needVowel = isVowel && vowels < p.minVowels;
    const needGlue = total > 0 && premiumCount / total >= p.premiumShareCap;
    if (face < 4 && !needVowel && !needGlue) {
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

  // Hard spending floor by phase (tempo). Completions and planner
  // targets are exempt.
  if (immediate < p.reserveBypassGain && !targeted) {
    const floor = p.spendFloorByPhase[phaseIndex(remaining)] ?? 0;
    if (p.reserveAsCap) {
      cap = Math.min(cap, Math.max(0, ctx.myBalance - floor));
      if (cap <= 0) return 0;
    } else if (ctx.myBalance - floor < Math.max(1, bid)) return 0;
  }

  // Price pushing on letters we'd otherwise let go cheap, but not while
  // the spending floor is holding us back: winning early glue at 9-10 is
  // exactly the front-loading we're trying to stop.
  if (!endgame && ctx.myBalance >= p.pushMinBalance && remaining <= p.reserveBag) {
    const market = p.marketA + p.marketB * face - p.pushUnder;
    bid = Math.max(bid, Math.round(market));
  }
  // Premium security when nobody at the table can outspend us.
  if (face >= 4 && richest < ctx.myBalance) bid += p.richPremium;
  // Tie-break bump: match 43031 lost Q/K/X/W by 0-2 at market. Under
  // Vickrey a higher bid costs nothing unless it wins, and then only the
  // runner-up's price.
  if (face >= 4 && !endgame) bid += p.tieBump;

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

  if (p.longWordFallback) {
    // Eligibility depends on length as well as reward. A short word can
    // outrank a playable long word while failing the short-word play gate.
    const alternatives = index.byRewardMaxLen[total] ?? index.byReward;
    const [mask1, mask2, mask3] = rackMasks(counts);
    for (const word of alternatives) {
      if (word.word.length < p.playNowLen || word.word.length > total) continue;
      if (remaining > p.midgameBag && word.reward < p.playNowReward7) continue;
      if (word.mask1 & ~mask1 || word.mask2 & ~mask2 || word.mask3 & ~mask3) continue;
      if (canSpellCounts(word, counts)) return word.word;
    }
  }

  return null;
}
