import assert from "node:assert/strict";
import { test } from "node:test";
import { MatchProfileSelector, PROFILES, resolveProfile } from "./profiles.js";

test("named profiles pin the baseline and change only their stated controls", () => {
  const baseline = {
    mcMode: 0, spendFloorByPhase: [28, 16, 0, 0, 0],
    reserveAsCap: 0, longWordFallback: 0, refillBonus: 0,
  };
  assert.deepEqual(resolveProfile("liveBaseline"), baseline);
  assert.deepEqual(resolveProfile("cash39"), { ...baseline, playNowReward: 39, playNowReward7: 39 });
  assert.deepEqual(resolveProfile("crunch24"), { ...baseline, crunchBalance: 24 });
  assert.deepEqual(resolveProfile("reserveCap"), { ...baseline, reserveAsCap: 1 });
  assert.deepEqual(resolveProfile("reserveCapCash39"), {
    ...baseline, reserveAsCap: 1, playNowReward: 39, playNowReward7: 39,
  });
  assert.deepEqual(resolveProfile("reserveCapLongFallback"), {
    ...baseline, reserveAsCap: 1, longWordFallback: 1,
  });
  assert.deepEqual(resolveProfile("reserveCapCash39Long"), {
    ...baseline, reserveAsCap: 1, playNowReward: 39, playNowReward7: 39, longWordFallback: 1,
  });
  assert.deepEqual(resolveProfile("reserveCapCrunch24"), {
    ...baseline, reserveAsCap: 1, crunchBalance: 24,
  });
  assert.deepEqual(resolveProfile("reserveCapPremiumNeed3"), {
    ...baseline, reserveAsCap: 1, premiumNeedBonus: 3,
  });
  assert.deepEqual(resolveProfile("reserveCapPremiumNeed5"), {
    ...baseline, reserveAsCap: 1, premiumNeedBonus: 5,
  });
  assert.deepEqual(resolveProfile("reserveCapMarket110"), {
    ...baseline, reserveAsCap: 1, marketMult: 1.1,
  });
  assert.deepEqual(resolveProfile("reserveCapPremiumMarket110"), {
    ...baseline, reserveAsCap: 1, premiumNeedBonus: 3, marketMult: 1.1,
  });
  assert.deepEqual(resolveProfile("reserveCapHold45"), {
    ...baseline, reserveAsCap: 1, playNowReward: 45, playNowReward7: 45,
  });
  assert.deepEqual(resolveProfile("reserveCapHold50"), {
    ...baseline, reserveAsCap: 1, playNowReward: 50, playNowReward7: 50,
  });
  assert.deepEqual(resolveProfile("reserveCapHold45Crunch24"), {
    ...baseline, reserveAsCap: 1, playNowReward: 45, playNowReward7: 45, crunchBalance: 24,
  });
  assert.deepEqual(resolveProfile("reserveCapHold45Fallback"), {
    ...baseline, reserveAsCap: 1, playNowReward: 45, playNowReward7: 45, longWordFallback: 1,
  });
  assert.deepEqual(resolveProfile("reserveCapReward54"), {
    ...baseline, reserveAsCap: 1, playNowReward: 54, playNowReward7: 54,
  });
  assert.deepEqual(resolveProfile("reserveCapReward54Crunch24"), {
    ...baseline, reserveAsCap: 1, playNowReward: 54, playNowReward7: 54, crunchBalance: 24,
  });
});

test("match assignments stay fixed while new matches rotate through profiles", () => {
  const selector = new MatchProfileSelector(["liveBaseline", "cash39", "reserveCap"]);
  assert.equal(selector.select(100n).name, "liveBaseline");
  assert.equal(selector.select("100").name, "liveBaseline");
  assert.equal(selector.select(101n).name, "cash39");
  assert.equal(selector.select(100n).name, "liveBaseline");
  assert.equal(selector.select(102n).name, "reserveCap");
  assert.equal(selector.select(103n).name, "liveBaseline");
  assert.equal(selector.select(101n).name, "cash39");
});

test("a single selected profile stays fixed across matches", () => {
  const selector = new MatchProfileSelector(["crunch24"]);
  for (const match of [10n, 9n, 11n, 10n]) assert.equal(selector.select(match).name, "crunch24");
});

test("profile resolution rejects unknown names and empty rotations", () => {
  for (const name of ["", "missing", "toString", "__proto__"]) {
    assert.throws(() => resolveProfile(name), /Unknown strategy profile/);
    assert.throws(() => new MatchProfileSelector(["cash39", name]), /Unknown strategy profile/);
  }
  assert.throws(() => new MatchProfileSelector([]), /At least one/);
});

test("profile snapshots and rotation configuration cannot mutate other matches", () => {
  const names = ["cash39", "crunch24"];
  const selector = new MatchProfileSelector(names);
  names.reverse();
  const first = selector.select(1n);
  assert.equal(first.name, "cash39");
  first.params.spendFloorByPhase![0] = 999;
  first.params.playNowReward = 1;
  assert.equal(selector.select(1n).params.spendFloorByPhase![0], 28);
  assert.equal(selector.select(1n).params.playNowReward, 39);
  assert.equal(selector.select(2n).name, "crunch24");
  assert.equal(resolveProfile("crunch24").spendFloorByPhase![0], 28);
  assert.notEqual(PROFILES.cash39.spendFloorByPhase, PROFILES.crunch24.spendFloorByPhase);
  assert.ok(Object.isFrozen(PROFILES.cash39.spendFloorByPhase));
});
