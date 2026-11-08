import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIndex } from "../dictionary.js";
import { type StrategyParams } from "../strategy.js";
import { runMatch, type PlayerSpec } from "./engine.js";

// Hold every word until the exposed bag count reaches zero. This makes
// one-tile differences observable without depending on normal tuning.
const holdUntilLastOffer: Partial<StrategyParams> = {
  mcSamples: 0, endgameBag: 0, playNowReward: 999,
  playNowLen: 999, cashFloor: 0, crunchBalance: 0,
  holdMaxRack: 999, fiveLetterMinReward: 999,
};
const ours: PlayerSpec = { kind: "ours", params: holdUntilLastOffer };

test("bidding sees the current offered tile excluded from bagTotal", () => {
  const result = runMatch([ours], buildIndex([]), 17, 97);
  assert.equal(result.auctions.length, 1);
  // The last offer has bagTotal=0, so an unusable tile is skipped.
  assert.equal(result.auctions[0]!.bids, 0);
});

test("initial word decisions see the first offer already drawn", () => {
  const result = runMatch([ours], buildIndex(["AA"]), 17, 97);
  assert.equal(result.auctions.length, 1);
  assert.ok(result.players[0]!.wordLog.length > 0);
  assert.ok(result.players[0]!.wordLog.every((w) => w.auction === -1));
});

test("after settlement words see the next offer drawn and stop when the match ends", () => {
  const result = runMatch([ours], buildIndex(["AA"]), 17, 96);
  assert.equal(result.auctions.length, 2);
  assert.ok(result.players[0]!.wordLog.length > 0);
  // First settlement opens the last offer with bagTotal=0. All words are
  // cashed then; none can be submitted after that last offer settles.
  assert.ok(result.players[0]!.wordLog.every((w) => w.auction === 0));
});

test("external Leader and Hoarder models cannot play after the final settlement", () => {
  const index = buildIndex(["AA", "AAA", "AAAAAAA"]);
  for (const strategy of ["Leader", "Hoarder"] as const) {
    const result = runMatch([{ kind: "sim", strategy }], index, 17, 96);
    assert.ok(result.players[0]!.wordLog.length > 0);
    assert.ok(result.players[0]!.wordLog.every((w) => w.auction < 1), strategy);
  }
});

test("built-in winner may play automatically inside the final settlement", () => {
  const result = runMatch([{ kind: "sim", strategy: "Aggressive" }], buildIndex(["AAA"]), 17, 96);
  assert.ok(result.players[0]!.wordLog.some((w) => w.auction === 1));
});
