/**
 * Live staking-rewards computation, shared by the agent's rewards scraper and
 * (potentially) other Butler modes.
 *
 * For one coinbase (a Splits contract) it reads the current pending sequencer
 * rewards from the rollup and the latest split allocation, and derives the
 * portion flowing to our rewards recipient. No history, no backfill.
 */

import { formatUnits, getAddress } from "viem";
import type { EthereumClient, SplitAllocationData } from "./EthereumClient.js";

/** Fallback total allocation when a coinbase has no SplitUpdated event. */
const DEFAULT_TOTAL_ALLOCATION = 10_000n;

export interface RewardToken {
  address: string;
  decimals: number;
}

/**
 * Resolve the reward token (the rollup's staking asset, or an override) and
 * its `decimals()`. Called once at scraper init.
 */
export async function resolveRewardToken(
  eth: EthereumClient,
  overrideAddress?: string,
): Promise<RewardToken> {
  const address = overrideAddress
    ? getAddress(overrideAddress)
    : await eth.getStakingAssetAddress();
  const decimals = await eth.getTokenDecimals(address);
  return { address, decimals };
}

/**
 * Our portion of `pendingRaw`, given a split allocation.
 *
 * Mirrors the server's `StakingRewardsScraper`: when our recipient is absent
 * from the split (or there is no split at all) the rewards are treated as
 * entirely ours — a coinbase with no configured split pays out directly.
 *
 * Pure function — unit tested.
 */
export function computeOurShareRaw(
  pendingRaw: bigint,
  split: SplitAllocationData | null,
  ourRecipient: string,
): bigint {
  const totalAllocation =
    split && split.totalAllocation > 0n ? split.totalAllocation : DEFAULT_TOTAL_ALLOCATION;

  const ourLower = ourRecipient.toLowerCase();
  let ourAllocation = 0n;
  if (split) {
    split.recipients.forEach((recipient, index) => {
      if (recipient.toLowerCase() === ourLower) {
        ourAllocation += split.allocations[index] ?? 0n;
      }
    });
  }

  // Not found in the split → treat all as ours (matches server behaviour).
  if (ourAllocation === 0n) {
    ourAllocation = totalAllocation;
  }
  if (ourAllocation > totalAllocation) {
    ourAllocation = totalAllocation;
  }

  return totalAllocation > 0n
    ? (pendingRaw * ourAllocation) / totalAllocation
    : pendingRaw;
}

export interface CoinbaseReward {
  coinbase: string;
  /** Pending sequencer rewards for the coinbase, in token base units. */
  pendingRaw: bigint;
  /** Our portion, in token base units. */
  ourShareRaw: bigint;
}

/**
 * Compute current pending rewards + our share for one coinbase. Returns `null`
 * when the coinbase split contract is not yet deployed on-chain.
 */
export async function computeCoinbaseReward(
  eth: EthereumClient,
  coinbase: string,
  ourRecipient: string,
  splitScanFromBlock: bigint,
): Promise<CoinbaseReward | null> {
  const address = getAddress(coinbase);

  // A coinbase split contract that is not yet deployed has no rewards.
  const code = await eth.getPublicClient().getCode({ address });
  if (!code || code === "0x") {
    return null;
  }

  const pendingRaw = await eth.getSequencerRewards(address);
  const split = await eth.getLatestSplitAllocations(address, splitScanFromBlock);
  const ourShareRaw = computeOurShareRaw(pendingRaw, split, ourRecipient);

  return { coinbase: address, pendingRaw, ourShareRaw };
}

/** Scale a raw token amount to whole tokens (float). */
export function toWholeTokens(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

/**
 * Cumulative "earned": add only positive deltas of our-share. A claim drops
 * pending rewards (negative delta) and must NOT subtract from the total.
 *
 * Pure function — unit tested.
 */
export function accumulateEarned(
  prevEarned: number,
  prevOurShare: number,
  currentOurShare: number,
): number {
  const delta = currentOurShare - prevOurShare;
  return prevEarned + (delta > 0 ? delta : 0);
}
