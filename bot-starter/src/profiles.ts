import type { StrategyParams } from "./strategy.js";

type FrozenProfile = Readonly<Omit<Partial<StrategyParams>, "spendFloorByPhase">> & {
  readonly spendFloorByPhase?: readonly number[];
};

// Pin experimental controls explicitly so a change to the default bot
// cannot silently change which strategy a live comparison is testing.
// This profile preserves the pre-reserve-cap production policy as an
// experiment control, even though PARAMS now defaults to reserve caps.
const baseline: Partial<StrategyParams> = {
  mcMode: 0,
  spendFloorByPhase: [28, 16, 0, 0, 0],
  reserveAsCap: 0,
  longWordFallback: 0,
  refillBonus: 0,
};

function freezeProfile(overrides: Partial<StrategyParams>): FrozenProfile {
  const params = { ...baseline, ...overrides };
  return Object.freeze({
    ...params,
    spendFloorByPhase: Object.freeze([...params.spendFloorByPhase!]),
  });
}

export const PROFILES = Object.freeze({
  liveBaseline: freezeProfile({}),
  cash39: freezeProfile({ playNowReward: 39, playNowReward7: 39 }),
  crunch24: freezeProfile({ crunchBalance: 24 }),
  reserveCap: freezeProfile({ reserveAsCap: 1 }),
  reserveCapCash39: freezeProfile({
    reserveAsCap: 1, playNowReward: 39, playNowReward7: 39,
  }),
  reserveCapLongFallback: freezeProfile({ reserveAsCap: 1, longWordFallback: 1 }),
  reserveCapCash39Long: freezeProfile({
    reserveAsCap: 1, playNowReward: 39, playNowReward7: 39, longWordFallback: 1,
  }),
  reserveCapCrunch24: freezeProfile({ reserveAsCap: 1, crunchBalance: 24 }),
  reserveCapPremiumNeed3: freezeProfile({ reserveAsCap: 1, premiumNeedBonus: 3 }),
  reserveCapPremiumNeed5: freezeProfile({ reserveAsCap: 1, premiumNeedBonus: 5 }),
  reserveCapMarket110: freezeProfile({ reserveAsCap: 1, marketMult: 1.1 }),
  reserveCapPremiumMarket110: freezeProfile({
    reserveAsCap: 1, premiumNeedBonus: 3, marketMult: 1.1,
  }),
  reserveCapHold45: freezeProfile({
    reserveAsCap: 1, playNowReward: 45, playNowReward7: 45,
  }),
  reserveCapHold50: freezeProfile({
    reserveAsCap: 1, playNowReward: 50, playNowReward7: 50,
  }),
  reserveCapHold45Crunch24: freezeProfile({
    reserveAsCap: 1, playNowReward: 45, playNowReward7: 45, crunchBalance: 24,
  }),
  reserveCapHold45Fallback: freezeProfile({
    reserveAsCap: 1, playNowReward: 45, playNowReward7: 45, longWordFallback: 1,
  }),
  reserveCapReward54: freezeProfile({
    reserveAsCap: 1, playNowReward: 54, playNowReward7: 54,
  }),
  reserveCapReward54Crunch24: freezeProfile({
    reserveAsCap: 1, playNowReward: 54, playNowReward7: 54, crunchBalance: 24,
  }),
});

export type ProfileName = keyof typeof PROFILES;

function assertProfileName(name: string): asserts name is ProfileName {
  if (!Object.hasOwn(PROFILES, name)) {
    throw new Error(`Unknown strategy profile '${name}'; choose ${Object.keys(PROFILES).join(", ")}`);
  }
}

// Every caller receives its own mutable parameter snapshot. Neither a
// simulator trial nor a live match can alter another profile's reserves.
export function resolveProfile(name: string): Partial<StrategyParams> {
  assertProfileName(name);
  const { spendFloorByPhase, ...params } = PROFILES[name];
  return { ...params, spendFloorByPhase: [...spendFloorByPhase!] };
}

export interface SelectedProfile {
  name: ProfileName;
  params: Partial<StrategyParams>;
}

// A match consumes a rotation slot only on its first selection. Snapshot
// filtering and deciding which matches belong to a trial are the caller's
// responsibility; re-evaluating bids/words never advances the rotation.
export class MatchProfileSelector {
  private readonly names: readonly ProfileName[];
  private readonly assignments = new Map<string, ProfileName>();
  private next = 0;

  constructor(names: readonly string[]) {
    if (names.length === 0) throw new Error("At least one strategy profile is required");
    for (const name of names) assertProfileName(name);
    this.names = [...names] as ProfileName[];
  }

  select(matchId: string | bigint): SelectedProfile {
    const key = String(matchId);
    let name = this.assignments.get(key);
    if (name === undefined) {
      name = this.names[this.next % this.names.length]!;
      this.next++;
      this.assignments.set(key, name);
    }
    return { name, params: resolveProfile(name) };
  }
}
