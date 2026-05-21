import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentConfig } from "../../src/agent/config.js";
import type { SplitAllocationData } from "../../src/core/components/EthereumClient.js";
import {
  accumulateEarned,
  computeOurShareRaw,
  toWholeTokens,
} from "../../src/core/components/rewards-compute.js";

// ── computeOurShareRaw ─────────────────────────────────────────────────────

function split(
  recipients: string[],
  allocations: bigint[],
  totalAllocation: bigint,
): SplitAllocationData {
  return { recipients, allocations, totalAllocation, distributorFee: 0 };
}

test("computeOurShareRaw — our recipient at 50% → half the pending", () => {
  const s = split(["0xus", "0xother"], [5000n, 5000n], 10_000n);
  assert.equal(computeOurShareRaw(1000n, s, "0xus"), 500n);
});

test("computeOurShareRaw — our recipient at 100% → all the pending", () => {
  const s = split(["0xus"], [10_000n], 10_000n);
  assert.equal(computeOurShareRaw(1000n, s, "0xus"), 1000n);
});

test("computeOurShareRaw — our recipient absent from split → treated as all ours", () => {
  const s = split(["0xother"], [10_000n], 10_000n);
  assert.equal(computeOurShareRaw(1000n, s, "0xus"), 1000n);
});

test("computeOurShareRaw — no split at all → all ours", () => {
  assert.equal(computeOurShareRaw(1000n, null, "0xus"), 1000n);
});

test("computeOurShareRaw — our recipient appearing twice is summed", () => {
  const s = split(["0xus", "0xus", "0xother"], [3000n, 2000n, 5000n], 10_000n);
  assert.equal(computeOurShareRaw(1000n, s, "0xus"), 500n);
});

test("computeOurShareRaw — matches recipient case-insensitively", () => {
  const s = split(["0xABC", "0xother"], [7000n, 3000n], 10_000n);
  assert.equal(computeOurShareRaw(1000n, s, "0xabc"), 700n);
});

// ── toWholeTokens ──────────────────────────────────────────────────────────

test("toWholeTokens — scales by 10^decimals", () => {
  assert.equal(toWholeTokens(1_000_000_000_000_000_000n, 18), 1);
  assert.equal(toWholeTokens(123_456_000_000_000_000_000n, 18), 123.456);
  assert.equal(toWholeTokens(0n, 18), 0);
});

// ── accumulateEarned ───────────────────────────────────────────────────────

test("accumulateEarned — accrual adds the positive delta", () => {
  assert.equal(accumulateEarned(10, 5, 8), 13);
});

test("accumulateEarned — a claim (drop in our-share) does not subtract", () => {
  assert.equal(accumulateEarned(13, 8, 1), 13);
});

test("accumulateEarned — no change adds nothing", () => {
  assert.equal(accumulateEarned(5, 3, 3), 5);
});

test("accumulateEarned — first observation (prev === current) contributes 0", () => {
  assert.equal(accumulateEarned(0, 7, 7), 0);
});

// ── rewards config validation ──────────────────────────────────────────────

function rewardsEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ETHEREUM_CHAIN_ID: "1",
    ETHEREUM_NODE_URL: "https://eth.example.com",
    AZTEC_NODE_URL: "http://aztec.example.com:8080",
    BUTLER_AGENT_REWARDS_ENABLED: "true",
    ...overrides,
  };
}

test("rewards in global mode requires ETHEREUM_ARCHIVE_NODE_URL", () => {
  assert.throws(
    () => buildAgentConfig(rewardsEnv({ STAKING_REWARDS_SPLIT_FROM_BLOCK: "100" }), "mainnet", "global"),
    /ETHEREUM_ARCHIVE_NODE_URL/,
  );
});

test("rewards in global mode requires STAKING_REWARDS_SPLIT_FROM_BLOCK", () => {
  assert.throws(
    () =>
      buildAgentConfig(
        rewardsEnv({ ETHEREUM_ARCHIVE_NODE_URL: "https://archive.example.com" }),
        "mainnet",
        "global",
      ),
    /STAKING_REWARDS_SPLIT_FROM_BLOCK/,
  );
});

test("rewards in global mode with archive RPC + start block builds cleanly", () => {
  const config = buildAgentConfig(
    rewardsEnv({
      ETHEREUM_ARCHIVE_NODE_URL: "https://archive.example.com",
      STAKING_REWARDS_SPLIT_FROM_BLOCK: "23083526",
    }),
    "mainnet",
    "global",
  );
  assert.equal(config.rewardsEnabled, true);
  assert.equal(config.stakingRewardsSplitFromBlock, 23083526n);
});

test("rewards flag is not validated in node mode (rewards only runs global/all)", () => {
  // node mode never runs the rewards scraper, so missing archive RPC is fine.
  const config = buildAgentConfig(
    rewardsEnv({ BUTLER_AGENT_HOST: "beast-3" }),
    "mainnet",
    "node",
  );
  assert.equal(config.rewardsEnabled, true);
});
