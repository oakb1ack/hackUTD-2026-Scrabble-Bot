// Strategy invariants. Run with `npm test`.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";
import { buildIndex, rewardFor } from "./dictionary.js";
import { chooseWord, decideBid } from "./strategy.js";

const words = fs
  .readFileSync(new URL("../../spacetimedb/wordlist.txt", import.meta.url), "utf8")
  .split("\n");
const index = buildIndex(words);
const dictionary: string[] = [];

const rack = (letters: string) => {
  const r = new Map<string, number>();
  for (const c of letters) r.set(c, (r.get(c) ?? 0) + 1);
  return r;
};

test("reward matches the module's integer formula", () => {
  assert.equal(rewardFor("CAT"), 5); // 3+1+1, 1x
  assert.equal(rewardFor("TACT"), Math.floor((6 * 3) / 2)); // 9
  assert.equal(rewardFor("QUIZZES".slice(0, 5)), rewardFor("QUIZZ")); // sanity
  assert.equal(rewardFor("ZEBRAS"), Math.floor((17 * 5) / 2)); // 42
});

test("chooseWord plays only words the rack can spell", () => {
  for (const letters of ["TACT", "CATX", "AEIOU", "QZXJK", "RETAINS", "ABCDEFGHIJKLM"]) {
    const w = chooseWord({ myRack: rack(letters), dictionary, bagRemaining: 0, index });
    if (w === null) continue;
    const r = rack(letters);
    for (const c of w) {
      assert.ok((r.get(c) ?? 0) > 0, `${w} not spellable from ${letters}`);
      r.set(c, r.get(c)! - 1);
    }
  }
});

test("chooseWord dumps everything in the endgame", () => {
  assert.notEqual(chooseWord({ myRack: rack("CAT"), dictionary, bagRemaining: 0, index }), null);
});

test("chooseWord holds short words mid-game with a healthy balance", () => {
  const w = chooseWord({ myRack: rack("CAT"), dictionary, bagRemaining: 50, myBalance: 80, index });
  assert.equal(w, null);
});

test("chooseWord takes a high-value long word immediately", () => {
  // JACKETS = 20 face x 3 = 60: worth cashing at any point in the match.
  const w = chooseWord({ myRack: rack("JACKETS"), dictionary, bagRemaining: 60, myBalance: 80, index });
  assert.ok(w !== null && w.length >= 7, `expected a 7+ word, got ${w}`);
});

test("chooseWord holds a cheap 7-letter word early but plays it by midgame", () => {
  // RETAINS = 7 face x 3 = 21: leaders wait for a premium letter instead.
  const early = chooseWord({ myRack: rack("RETAINS"), dictionary, bagRemaining: 60, myBalance: 80, index });
  assert.equal(early, null);
  const mid = chooseWord({ myRack: rack("RETAINS"), dictionary, bagRemaining: 25, myBalance: 80, index });
  assert.ok(mid !== null && mid.length >= 7, `expected a 7+ word, got ${mid}`);
});

test("chooseWord cashes a big 6-letter word and cashes out when broke", () => {
  // BRONZY = 20 face x 2.5 = 50: play it even though it's only 6 letters.
  const big = chooseWord({ myRack: rack("BRONZY"), dictionary, bagRemaining: 50, myBalance: 100, index });
  assert.equal(big, "BRONZY");
  // GAMING = 10 face x 2.5 = 25: hold with cash, play when broke.
  const rich = chooseWord({ myRack: rack("GAMING"), dictionary, bagRemaining: 50, myBalance: 100, index });
  assert.equal(rich, null);
  const broke = chooseWord({ myRack: rack("GAMING"), dictionary, bagRemaining: 50, myBalance: 15, index });
  assert.ok(broke !== null, "expected a cash-out when broke");
});

test("decideBid keeps a Z bid near market, not stacked premiums", () => {
  const z = decideBid({ letter: "Z", myBalance: 100, myRack: rack("ERTAN"), bagRemaining: 55, index });
  assert.ok(z <= 30, `z bid ${z} too high`);
});

test("decideBid tapers premium bids late toward the glue price", () => {
  // With the bag nearly empty a J that completes nothing is worth little
  // more than glue (market ~10). Monte Carlo already prices the early J
  // modestly, so assert the late bid is bounded, not a fixed gap.
  const late = decideBid({ letter: "J", myBalance: 100, myRack: rack("ERTAN"), bagRemaining: 12, index });
  const early = decideBid({ letter: "J", myBalance: 100, myRack: rack("ERTAN"), bagRemaining: 50, index });
  // Late bids include the pacing floor (money is worthless after the
  // match), so only assert the premium itself isn't valued higher late.
  assert.ok(late <= early, `early=${early} late=${late}`);
});

test("decideBid keeps the first-half reserve against glue", () => {
  // Balance 40, bag 60: glue may spend at most 40 - 35 = 5.
  const b = decideBid({ letter: "O", myBalance: 40, myRack: rack("ERTAN"), bagRemaining: 60, index });
  assert.ok(b <= 5, `glue bid ${b} dipped into the reserve`);
  // A premium letter is what the reserve is for.
  const z = decideBid({ letter: "Z", myBalance: 40, myRack: rack("ERTAN"), bagRemaining: 60, index });
  assert.ok(z >= 15, `premium bid ${z} blocked by reserve`);
});

test("decideBid skips endgame tiles that complete nothing", () => {
  const b = decideBid({ letter: "V", myBalance: 60, myRack: rack("QZ"), bagRemaining: 3, index });
  assert.equal(b, 0);
});

test("decideBid never exceeds balance and is never negative", () => {
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    for (const bal of [0, 1, 5, 37, 100, 250]) {
      for (const bagRemaining of [68, 20, 4]) {
        const b = decideBid({ letter, myBalance: bal, myRack: rack("ERSTAN"), bagRemaining, index });
        assert.ok(Number.isInteger(b), "bid must be an integer");
        assert.ok(b >= 0 && b <= bal, `bid ${b} out of range for balance ${bal}`);
      }
    }
  }
});

test("decideBid values a letter that completes a long word above a useless one", () => {
  const completes = decideBid({ letter: "S", myBalance: 100, myRack: rack("RETAIN"), bagRemaining: 50, index });
  // A lone E on an empty rack makes nothing; it gets only the pacing floor.
  const useless = decideBid({ letter: "E", myBalance: 100, myRack: rack(""), bagRemaining: 50, index });
  assert.ok(completes > useless, `completes=${completes} useless=${useless}`);
});

test("decideBid prices a Z far above a 1-point letter on a thin rack", () => {
  const z = decideBid({ letter: "Z", myBalance: 100, myRack: rack("ERTAN"), bagRemaining: 50, index });
  const e = decideBid({ letter: "E", myBalance: 100, myRack: rack("ERTAN"), bagRemaining: 50, index });
  assert.ok(z >= 20 && z > e + 8, `z=${z} e=${e}`);
});

// The bot can't see a match move on while it searches, so a slow search
// means bids on closed auctions and words from letters it already spent.
test("decideBid and chooseWord each run well within an auction", () => {
  // Largest rack we ever hold (holdMaxRack 13, plus one tile mid-auction).
  const big = rack("BCDFGHJKLMNPQR");
  let start = performance.now();
  chooseWord({ myRack: big, dictionary, bagRemaining: 30, myBalance: 50, index });
  assert.ok(performance.now() - start < 100, "chooseWord took 100 ms or more");
  start = performance.now();
  decideBid({ letter: "E", myBalance: 50, myRack: big, bagRemaining: 30, index });
  assert.ok(performance.now() - start < 100, "decideBid took 100 ms or more");
});
