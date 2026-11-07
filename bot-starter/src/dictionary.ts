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
    entries.push({ word: w, reward: rewardFor(w), counts });
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
  cached = { byReward, byRewardMaxLen, byLength, containing };
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
  for (const e of list) {
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
  for (const e of index.byLength) {
    if (e.word.length < minLen) break;
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
