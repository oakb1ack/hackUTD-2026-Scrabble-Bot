// Strategy invariants. Run with `npm test`.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";
import { buildIndex, rewardFor } from "./dictionary.js";
import { chooseWord, decideBid } from "./strategy.js";
import { MarketLearner } from "./market.js";

test("market phases survive shuffled snapshots and duplicate reconnect rows", () => {
  const market = new MarketLearner();
  for (let match = 0; match < 8; match++) {
    // Deliver late auctions first, as a subscription snapshot may do.
    for (let round = 67; round >= 0; round--) {
      const id = BigInt(match * 100 + round);
      const price = round < 16 ? 40 : round < 31 ? 30 : round < 46 ? 20 : round < 60 ? 10 : 5;
      market.observe(BigInt(match), id, "X", price);
      market.observe(BigInt(match), id, "X", price);
    }
  }
  assert.deepEqual(market.table().p58, [40, 30, 20, 10, 5]);
  assert.deepEqual(market.table().p4, [null, null, null, null, null]);
});

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

test("word choice includes length multipliers and prefers reward over raw length", () => {
  const comparison = buildIndex(["RETAINS", "ZEBRAS"]);
  const chosen = chooseWord({
    myRack: rack("ZEBRASTIN"), dictionary, bagRemaining: 50,
    myBalance: 100, index: comparison,
  });
  // Six letters with a Z pay 42, versus 21 for seven cheap letters.
  assert.equal(chosen, "ZEBRAS");
  assert.equal(rewardFor("RETAINS"), 21);
  assert.equal(rewardFor("ZEBRAS"), 42);
});

test("chooseWord holds a cheap 7-letter word early but plays it by midgame", () => {
  // RETAINS = 7 face x 3 = 21: leaders wait for a premium letter instead.
  const early = chooseWord({ myRack: rack("RETAINS"), dictionary, bagRemaining: 60, myBalance: 80, index });
  assert.equal(early, null);
  const mid = chooseWord({ myRack: rack("RETAINS"), dictionary, bagRemaining: 25, myBalance: 80, index });
  assert.ok(mid !== null && mid.length >= 7, `expected a 7+ word, got ${mid}`);
});

test("opt-in long-word fallback considers eligible alternatives to a held short word", () => {
  // DEOXY pays 32 but fails the early short-word gate; TOGATED pays 27
  // and is eligible once the match reaches midgame.
  const context = {
    myRack: rack("ETXDYATOTAG"), dictionary, myBalance: 80, index,
  };
  assert.equal(chooseWord({ ...context, bagRemaining: 25 }), null);
  const word = chooseWord({
    ...context, bagRemaining: 25, params: { longWordFallback: 1 },
  });
  assert.ok(word !== null && word.length >= 7, `expected a long fallback, got ${word}`);
  assert.equal(chooseWord({
    ...context, bagRemaining: 50, params: { longWordFallback: 1 },
  }), null, "fallback must still respect the early reward gate");
});

test("opt-in reserve cap permits affordable bids when raw value exceeds the balance", () => {
  const context = {
    letter: "E", myBalance: 9, myRack: rack(""), bagRemaining: 30, index,
    params: { mcSamples: 0, maxSpendFrac: 1, reserveAsCap: 0, spendFloorByPhase: [0, 0, 0, 0, 0] },
  };
  assert.equal(decideBid(context), 0);
  assert.equal(decideBid({
    ...context, params: { ...context.params, reserveAsCap: 1 },
  }), 9);
});

test("opt-in reserve cap constrains tie and security boosts and skips exhausted reserves", () => {
  const context = {
    letter: "H", myBalance: 50, myRack: rack(""), bagRemaining: 45,
    rivalBalances: [20, 30], index,
    params: {
      mcSamples: 0, reserveAsCap: 1, spendFloorByPhase: [42, 42, 42, 42, 42],
      tieBump: 100, richPremium: 100,
    },
  };
  assert.equal(decideBid(context), 8, "boosts must not spend the 42-currency reserve");
  assert.equal(decideBid({ ...context, myBalance: 42 }), 0);
});

test("refill bonus helps acquire suitable new letters for a small funded rack", () => {
  const params = {
    mcSamples: 0, potentialWeight: 0, breadthWeight: 0, maxSpendFrac: 1,
    spendFloorByPhase: [0, 0, 0, 0, 0],
  };
  for (const [letters, letter] of [["IIYA", "S"], ["BCDF", "E"], ["", "R"]]) {
    const context = { letter: letter!, myRack: rack(letters!), myBalance: 60, bagRemaining: 24, index, params };
    const baseline = decideBid(context);
    assert.equal(decideBid({ ...context, params: { ...params, refillBonus: 2 } }), baseline + 2);
    assert.equal(decideBid({ ...context, params: { ...params, refillBonus: 100 } }), baseline + 4,
      "refill bonus must stay bounded even when configured too high");
  }
});

test("refill bonus avoids imbalance, duplicates, premiums, and ineligible phases or budgets", () => {
  const params = {
    mcSamples: 0, potentialWeight: 0, breadthWeight: 0, maxSpendFrac: 1,
    spendFloorByPhase: [0, 0, 0, 0, 0],
  };
  const common = { myBalance: 60, bagRemaining: 24, index, params };
  const contexts = [
    { ...common, myRack: rack("IIYA"), letter: "E" }, // vowel-heavy
    { ...common, myRack: rack("BCDF"), letter: "S" }, // vowel-deficient
    { ...common, myRack: rack("IYAS"), letter: "S" }, // already held
    { ...common, myRack: rack("IIYA"), letter: "H" }, // premium
    { ...common, myRack: rack("IIYA"), letter: "S", bagRemaining: 50 },
    { ...common, myRack: rack("IIYA"), letter: "S", bagRemaining: 8 },
    { ...common, myRack: rack("IIYA"), letter: "S", myBalance: 24 },
    { ...common, myRack: rack("AERSTNL"), letter: "D" }, // rack already rebuilt
  ];
  for (const context of contexts) {
    assert.equal(decideBid({ ...context, params: { ...params, refillBonus: 2 } }), decideBid(context),
      `unexpected refill bonus for ${JSON.stringify({ ...context, index: undefined })}`);
  }
});

test("refill bonus respects reserves and balance after raising a bid", () => {
  const params = {
    mcSamples: 0, potentialWeight: 0, breadthWeight: 0, maxSpendFrac: 1,
    reserveAsCap: 0, spendFloorByPhase: [20, 20, 20, 20, 20],
  };
  const context = { letter: "S", myRack: rack("IIYA"), myBalance: 30, bagRemaining: 30, index, params };
  assert.equal(decideBid(context), 10);
  assert.equal(decideBid({ ...context, params: { ...params, refillBonus: 2 } }), 0,
    "a refill must not bypass the hard spending reserve");
  assert.equal(decideBid({ ...context, params: { ...params, refillBonus: 2, reserveAsCap: 1 } }), 10);
  for (const myBalance of [0, 1, 24, 25, 30, 60]) {
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const bid = decideBid({ ...context, myBalance, letter, params: { ...params, refillBonus: 4 } });
      assert.ok(Number.isInteger(bid) && bid >= 0 && bid <= myBalance,
        `refill bid ${bid} exceeds balance ${myBalance}`);
    }
  }
});

test("chooseWord cashes a big 6-letter word and cashes out when broke", () => {
  // BRONZY = 20 face x 2.5 = 50: play it even though it's only 6 letters.
  const big = chooseWord({ myRack: rack("BRONZY"), dictionary, bagRemaining: 50, myBalance: 100, index });
  assert.equal(big, "BRONZY");
  // GAMING = 10 face x 2.5 = 25: hold with cash, play when broke.
  const rich = chooseWord({ myRack: rack("GAMING"), dictionary, bagRemaining: 50, myBalance: 100, index });
  assert.equal(rich, null);
  const broke = chooseWord({ myRack: rack("GAMING"), dictionary, bagRemaining: 50, myBalance: 10, index });
  assert.ok(broke !== null, "expected a cash-out when broke");
});

test("decideBid keeps a Z bid near market, not stacked premiums", () => {
  const z = decideBid({ letter: "Z", myBalance: 100, myRack: rack("ERTAN"), bagRemaining: 55, index });
  // The observed early Z/Q median is 32; retaining face value bids 31.
  assert.ok(z <= 32, `z bid ${z} exceeds the early market median`);
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

test("decideBid keeps the first-half reserve against glue when enabled", () => {
  // Reserve is off by default (it starved tile volume live); test the
  // mechanism with it switched on. Balance 40, bag 60: glue may spend at
  // most 40 - 35 = 5 unless a target word needs the letter.
  const params = { reserveBalance: 35, targetTopN: 0 };
  const b = decideBid({ letter: "O", myBalance: 40, myRack: rack("ERTAN"), bagRemaining: 60, index, params });
  assert.ok(b <= 5, `glue bid ${b} dipped into the reserve`);
  // A premium letter is what the reserve is for.
  const z = decideBid({ letter: "Z", myBalance: 40, myRack: rack("ERTAN"), bagRemaining: 60, index, params });
  assert.ok(z >= 15, `premium bid ${z} blocked by reserve`);
});

test("planner raises the bid on a letter its target word needs", () => {
  // RETAIN + S = RETAINS/STAINER etc.; S is the missing letter.
  const withPlan = decideBid({ letter: "S", myBalance: 100, myRack: rack("RETAIN"), bagRemaining: 50, index });
  const noPlan = decideBid({ letter: "S", myBalance: 100, myRack: rack("RETAIN"), bagRemaining: 50, index, params: { targetTopN: 0 } });
  assert.ok(withPlan >= noPlan, `plan=${withPlan} noplan=${noPlan}`);
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

test("premium scarcity bonus only rewards a unique premium that fills the rack target", () => {
  const params = {
    mcSamples: 0, potentialWeight: 0, breadthWeight: 0, maxSpendFrac: 1,
    spendFloorByPhase: [0, 0, 0, 0, 0], reserveAsCap: 1,
    useMarketTable: 0, tieBump: 0, premiumNeedShare: 0.22, premiumNeedBonus: 0,
  };
  const context = {
    letter: "H", myBalance: 60, myRack: rack("AERST"), bagRemaining: 30, index, params,
  };
  const baseline = decideBid(context);
  assert.equal(decideBid({
    ...context, params: { ...params, premiumNeedBonus: 3 },
  }), baseline + 3);
  assert.equal(decideBid({
    ...context, myRack: rack("AERSTH"), params: { ...params, premiumNeedBonus: 3 },
  }), decideBid({ ...context, myRack: rack("AERSTH") }), "do not bonus a duplicate");
  assert.equal(decideBid({
    ...context, myRack: rack("HHFFX"), letter: "J", params: { ...params, premiumNeedBonus: 3 },
  }), decideBid({ ...context, myRack: rack("HHFFX"), letter: "J" }), "do not bonus a premium-heavy rack");
  assert.equal(decideBid({
    ...context, bagRemaining: 12, params: { ...params, premiumNeedBonus: 3 },
  }), decideBid({ ...context, bagRemaining: 12 }), "do not bonus near the endgame");
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
