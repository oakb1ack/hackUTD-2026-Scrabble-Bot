// Dictionary index shared by the live bot and the offline simulator.
//
// Every word is pre-encoded as a 26-slot letter-count vector so that
// "can this rack spell it?" is 26 integer compares with no allocation.
// A full scan of the 173k-word ENABLE list takes a few milliseconds,
// well inside the 1-second auction window.

export const A = "A".charCodeAt(0);

export const LETTER_VALUE: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

// Standard 98-tile bag, no blanks. Mirrors spacetimedb/src/letters.ts.
export const DEFAULT_BAG: Record<string, number> = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1,
  L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2,
  W: 2, X: 1, Y: 2, Z: 1,
};
export const BAG_SIZE = 98;

// Integer reward exactly as the module computes it (integer division).
export function lengthMultiplier(len: number): [number, number] {
  if (len <= 3) return [1, 1];
  if (len === 4) return [3, 2];
  if (len === 5) return [2, 1];
  if (len === 6) return [5, 2];
  return [3, 1];
}

export function baseScore(word: string): number {
  let s = 0;
  for (const c of word) s += LETTER_VALUE[c] ?? 0;
  return s;
}

export function rewardFor(word: string): number {
  const [num, denom] = lengthMultiplier(word.length);
  return Math.floor((baseScore(word) * num) / denom);
}

export interface IndexedWord {
  word: string;
  reward: number;
  counts: Uint8Array; // 26 slots
  // Bit i set when the word uses letter i at least once / twice / three
  // times. Lets a rack reject most words with a few AND-ops before the
  // 26-compare, and gives an exact missing-tile count (up to triples)
  // from three popcounts.
  mask1: number;
  mask2: number;
  mask3: number;
}

// Rack masks matching IndexedWord.mask1 / mask2 / mask3.
export function rackMasks(rack: Uint8Array): [number, number, number] {
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  for (let i = 0; i < 26; i++) {
    const n = rack[i]!;
    if (n >= 1) m1 |= 1 << i;
    if (n >= 2) m2 |= 1 << i;
    if (n >= 3) m3 |= 1 << i;
  }
  return [m1, m2, m3];
}

export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export interface DictionaryIndex {
  // Sorted by reward descending, so the first spellable word is the best.
  byReward: IndexedWord[];
  // byReward restricted to words of length <= L, indexed by L. Lets a
  // small rack scan a few thousand words instead of 173k.
  byRewardMaxLen: IndexedWord[][];
  // Sorted by length descending (then input order). Mirrors the module's
  // own `findBestPlayable`, used by simulated opponents.
  byLength: IndexedWord[];
  // byReward filtered to words containing each letter, for valuation.
  containing: Map<string, IndexedWord[]>;
  // Struct-of-arrays view of byReward (same order) for tight scans:
  // letter masks, word length and reward as typed arrays.
  rMask1: Int32Array;
  rMask2: Int32Array;
  rMask3: Int32Array;
  rLen: Uint8Array;
  rReward: Uint16Array;
}

let cached: DictionaryIndex | null = null;

export function buildIndex(words: readonly string[]): DictionaryIndex {
  const seen = new Set<string>();
  const entries: IndexedWord[] = [];
  for (const raw of words) {
    const w = raw.trim().toUpperCase();
    if (w.length < 2 || !/^[A-Z]+$/.test(w) || seen.has(w)) continue;
    seen.add(w);
    const counts = new Uint8Array(26);
    for (let i = 0; i < w.length; i++) counts[w.charCodeAt(i) - A]!++;
    const [mask1, mask2, mask3] = rackMasks(counts);
    entries.push({ word: w, reward: rewardFor(w), counts, mask1, mask2, mask3 });
  }
  const byReward = [...entries].sort((a, b) => b.reward - a.reward);
  const byLength = [...entries].sort((a, b) => b.word.length - a.word.length);
  const MAX_L = 16;
  const byRewardMaxLen: IndexedWord[][] = [];
  for (let L = 0; L <= MAX_L; L++) {
    byRewardMaxLen.push(byReward.filter((e) => e.word.length <= L));
  }
  const containing = new Map<string, IndexedWord[]>();
  for (let s = 0; s < 26; s++) {
    const letter = String.fromCharCode(A + s);
    containing.set(
      letter,
      byReward.filter((e) => e.counts[s]! > 0),
    );
  }
  const n = byReward.length;
  const rMask1 = new Int32Array(n);
  const rMask2 = new Int32Array(n);
  const rMask3 = new Int32Array(n);
  const rLen = new Uint8Array(n);
  const rReward = new Uint16Array(n);
  byReward.forEach((e, i) => {
    rMask1[i] = e.mask1;
    rMask2[i] = e.mask2;
    rMask3[i] = e.mask3;
    rLen[i] = e.word.length;
    rReward[i] = e.reward;
  });
  cached = {
    byReward, byRewardMaxLen, byLength, containing, rMask1, rMask2, rMask3, rLen, rReward,
  };
  return cached;
}

export function getIndex(): DictionaryIndex {
  if (!cached) throw new Error("dictionary index not built");
  return cached;
}

// Rack as a 26-slot count vector plus total tiles.
export function rackCounts(rack: Map<string, number>): {
  counts: Uint8Array;
  total: number;
} {
  const counts = new Uint8Array(26);
  let total = 0;
  for (const [c, n] of rack) {
    const slot = c.charCodeAt(0) - A;
    if (slot < 0 || slot >= 26 || n <= 0) continue;
    counts[slot] = Math.min(255, counts[slot]! + n);
    total += n;
  }
  return { counts, total };
}

export function canSpellCounts(word: IndexedWord, rack: Uint8Array): boolean {
  const w = word.counts;
  for (let i = 0; i < 26; i++) if (w[i]! > rack[i]!) return false;
  return true;
}

// Highest-reward word the rack can spell, or null.
export function bestPlay(
  rack: Uint8Array,
  total: number,
  index: DictionaryIndex = getIndex(),
): IndexedWord | null {
  const list =
    total < index.byRewardMaxLen.length
      ? index.byRewardMaxLen[total]!
      : index.byReward;
  const [m1, m2, m3] = rackMasks(rack);
  for (const e of list) {
    if (e.mask1 & ~m1 || e.mask2 & ~m2 || e.mask3 & ~m3) continue;
    if (e.word.length > total) continue;
    if (canSpellCounts(e, rack)) return e;
  }
  return null;
}

// Longest word the rack can spell with at least `minLen` letters. This is
// exactly what the module's simulated bots play.
export function longestPlay(
  rack: Uint8Array,
  total: number,
  minLen: number,
  index: DictionaryIndex = getIndex(),
): IndexedWord | null {
  if (total < minLen) return null;
  const [m1, m2, m3] = rackMasks(rack);
  for (const e of index.byLength) {
    if (e.word.length < minLen) break;
    if (e.mask1 & ~m1 || e.mask2 & ~m2 || e.mask3 & ~m3) continue;
    if (e.word.length > total) continue;
    if (canSpellCounts(e, rack)) return e;
  }
  return null;
}

// Greedy partition: repeatedly play the best word until nothing is left.
// Returns the total reward achievable from the rack right now.
export function greedyRackValue(
  rack: Uint8Array,
  total: number,
  index: DictionaryIndex = getIndex(),
): number {
  const r = new Uint8Array(rack);
  let t = total;
  let sum = 0;
  for (let guard = 0; guard < 16; guard++) {
    const w = bestPlay(r, t, index);
    if (!w) break;
    sum += w.reward;
    for (let i = 0; i < 26; i++) r[i] = r[i]! - w.counts[i]!;
    t -= w.word.length;
  }
  return sum;
}

// How many tiles of `word` the rack is missing.
export function missingCount(word: IndexedWord, rack: Uint8Array): number {
  let m = 0;
  for (let i = 0; i < 26; i++) {
    const d = word.counts[i]! - rack[i]!;
    if (d > 0) m += d;
  }
  return m;
}

// Words we could plausibly complete after winning at most `maxMissing`
// more tiles (exact up to triple letters, via the three masks), scanning
// best-reward-first and stopping after `limit` hits. Returns indices into
// index.byReward. Used by the Monte Carlo valuation: each rollout scans
// this list instead of the whole index. Any word spellable from a subset
// of `rack` + maxMissing tiles is in the list (up to the reward
// truncation), so the same list serves the rack with and without the
// offered letter.
export function reachableCandidates(
  rack: Uint8Array,
  total: number,
  maxMissing: number,
  limit: number,
  minLen = 4,
  index: DictionaryIndex = getIndex(),
): Int32Array {
  const maxLen = total + maxMissing;
  const { rMask1, rMask2, rMask3, rLen } = index;
  const out = new Int32Array(limit);
  let outN = 0;
  const n = rMask1.length;
  const [m1, m2, m3] = rackMasks(rack);
  const nm1 = ~m1;
  const nm2 = ~m2;
  const nm3 = ~m3;
  for (let k = 0; k < n && outN < limit; k++) {
    const len = rLen[k]!;
    if (len < minLen || len > maxLen) continue;
    const a = rMask1[k]! & nm1;
    const b = rMask2[k]! & nm2;
    const c = rMask3[k]! & nm3;
    if (popcount(a) + popcount(b) + popcount(c) <= maxMissing) out[outN++] = k;
  }
  return out.subarray(0, outN);
}

// Best spellable reward for two racks where `big` is `small` plus one
// tile, in one reward-ordered pass over a candidate list: whatever the
// small rack spells, the big rack spells too, so the big rack's best is
// found first and the scan stops at the small rack's best. Returns
// [bestSmall, bestBig] (0 when nothing is spellable).
export function bestPairValue(
  cands: Int32Array,
  small: Uint8Array,
  big: Uint8Array,
  index: DictionaryIndex = getIndex(),
): [number, number] {
  const { rMask1, rMask2, rMask3, rReward, byReward } = index;
  const [s1, s2, s3] = rackMasks(small);
  const [b1, b2, b3] = rackMasks(big);
  const ns1 = ~s1, ns2 = ~s2, ns3 = ~s3;
  const nb1 = ~b1, nb2 = ~b2, nb3 = ~b3;
  let bestBig = 0;
  for (let j = 0; j < cands.length; j++) {
    const k = cands[j]!;
    const w1 = rMask1[k]!;
    const w2 = rMask2[k]!;
    const w3 = rMask3[k]!;
    if (w1 & nb1 || w2 & nb2 || w3 & nb3) continue;
    const e = byReward[k]!;
    if (!canSpellCounts(e, big)) continue; // 4+ of one letter: rare
    if (bestBig === 0) bestBig = rReward[k]!;
    if (w1 & ns1 || w2 & ns2 || w3 & ns3) continue;
    if (canSpellCounts(e, small)) return [rReward[k]!, bestBig];
  }
  return [0, bestBig];
}

