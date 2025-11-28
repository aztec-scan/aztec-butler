import type { ObservableCounter, ObservableGauge } from "@opentelemetry/api";
import { createObservableCounter, createObservableGauge } from "./registry.js";
import { getStakingRewardsData, getStakingRewardsHistory } from "../state/index.js";

let pendingRewardsGauge: ObservableGauge | null = null;
let ourShareGauge: ObservableGauge | null = null;
let splitAllocationGauge: ObservableGauge | null = null;
let earnedCounter: ObservableCounter | null = null;

const toNumber = (value: bigint): number => Number(value);

export const initStakingRewardsMetrics = () => {
  pendingRewardsGauge = createObservableGauge(
    "staking_rewards_pending_units",
    {
      description: "Total pending staking rewards per coinbase (token units)",
    },
  );

  ourShareGauge = createObservableGauge("staking_rewards_our_share_units", {
    description:
      "Portion of pending staking rewards destined for our Safe (token units)",
  });

  earnedCounter = createObservableCounter("staking_rewards_earned_units", {
    description:
      "Cumulative staking rewards earned for our Safe per coinbase (token units)",
  });

  pendingRewardsGauge.addCallback((observableResult) => {
    const data = getStakingRewardsData();
    if (!data) {
      return;
    }

    data.forEach((entry) => {
      observableResult.observe(toNumber(entry.pendingRewards), {
        coinbase: entry.coinbase,
      });
    });
  });

  ourShareGauge.addCallback((observableResult) => {
    const data = getStakingRewardsData();
    if (!data) {
      return;
    }

    data.forEach((entry) => {
      observableResult.observe(toNumber(entry.ourShare), {
        coinbase: entry.coinbase,
      });
    });
  });

  earnedCounter.addCallback((observableResult) => {
    const history = getStakingRewardsHistory();
    if (!history.length) {
      return;
    }

    const perCoinbase = new Map<
      string,
      { prevOur: bigint | null; totalEarned: bigint }
    >();

    for (const snap of history) {
      const key = snap.coinbase.toLowerCase();
      if (!perCoinbase.has(key)) {
        perCoinbase.set(key, { prevOur: null, totalEarned: 0n });
      }
      const ctx = perCoinbase.get(key)!;
      if (ctx.prevOur !== null) {
        const delta = snap.ourShare - ctx.prevOur;
        if (delta > 0n) {
          ctx.totalEarned += delta;
        }
      }
      ctx.prevOur = snap.ourShare;
    }

    perCoinbase.forEach((ctx, coinbase) => {
      observableResult.observe(toNumber(ctx.totalEarned), { coinbase });
    });
  });

  console.log("Staking rewards metrics initialized");
};
