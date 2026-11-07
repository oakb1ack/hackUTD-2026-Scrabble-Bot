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

test("chooseWord takes a long word immediately", () => {
  const w = chooseWord({ myRack: rack("RETAINS"), dictionary, bagRemaining: 50, myBalance: 80, index });
  assert.ok(w !== null && w.length >= 6, `expected a 6+ word, got ${w}`);
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
  const big = rack("BCDFGHJKLMNPQRSTVWXZ");
  let start = performance.now();
  chooseWord({ myRack: big, dictionary, bagRemaining: 30, myBalance: 50, index });
  assert.ok(performance.now() - start < 100, "chooseWord took 100 ms or more");
  start = performance.now();
  decideBid({ letter: "E", myBalance: 50, myRack: big, bagRemaining: 30, index });
  assert.ok(performance.now() - start < 100, "decideBid took 100 ms or more");
});
