/**
 * Staking-rewards ledger — the event-sourced accounting computation (Part 2
 * Phase B).
 *
 * For a period (startBlock, endBlock] it computes, per coinbase:
 *
 *   accrued  = (Σ getSequencerRewards at endBlock − Σ at startBlock) + claims
 *   ourShare = the split allocation applied to `accrued`
 *
 * Summing `getSequencerRewards` across ALL rollup versions makes the formula
 * migration-proof (rewards stay on the old rollup; a late claim there yields
 * Δ = −X, claims = +X → accrued 0). Used by both the recurring exporter and
 * `--backfill`, which iterates it over historical day-boundaries.
 */

import { getAddress, parseAbiItem, type Address } from "viem";
import type { EthereumClient, SplitAllocationData } from "./EthereumClient.js";
import { computeOurShareRaw, toWholeTokens, type RewardToken } from "./rewards-compute.js";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const LOG_CHUNK = 10_000n;

/** Gate for rate-limiting RPC calls (the backfill passes a RateLimiter). */
export type RpcGate = <T>(fn: () => Promise<T>) => Promise<T>;
const noGate: RpcGate = (fn) => fn();

/** One `SplitUpdated` version: the allocation and the block it took effect. */
export type SplitVersion = { block: bigint; split: SplitAllocationData };
/** Per-coinbase (lowercase) `SplitUpdated` history, ascending by block. */
export type SplitTimeline = Map<string, SplitVersion[]>;

/** One coinbase's figures for a ledger period, in whole AZTEC. */
export interface LedgerRow {
  coinbase: string;
  accruedAztec: number;
  claimedAztec: number;
  ourShareAztec: number;
  otherShareAztec: number;
}

export interface LedgerPeriodResult {
  rows: LedgerRow[];
  /** Σ getSequencerRewards per coinbase at endBlock — next period's prevBalances. */
  endBalances: Map<string, bigint>;
}

/**
 * Pure ledger arithmetic: given the balance boundaries, claims and splits,
 * produce per-coinbase rows. Unit tested.
 */
export const buildLedgerRows = (
  coinbases: string[],
  prevBalances: Map<string, bigint>,
  endBalances: Map<string, bigint>,
  claims: Map<string, bigint>,
  splitOf: (coinbase: string) => SplitAllocationData | null,
  ourRecipient: string,
  decimals: number,
): LedgerRow[] => {
  const rows: LedgerRow[] = [];
  for (const coinbase of coinbases) {
    const key = coinbase.toLowerCase();
    const prev = prevBalances.get(key) ?? 0n;
    const end = endBalances.get(key) ?? 0n;
    const claimed = claims.get(key) ?? 0n;
    // accrued = Δbalance + claims — exact regardless of claim timing or migration.
    const accrued = end - prev + claimed;
    const ourShare = computeOurShareRaw(accrued, splitOf(coinbase), ourRecipient);
    const other = accrued - ourShare;
    rows.push({
      coinbase,
      accruedAztec: toWholeTokens(accrued, decimals),
      claimedAztec: toWholeTokens(claimed, decimals),
      ourShareAztec: toWholeTokens(ourShare, decimals),
      otherShareAztec: toWholeTokens(other, decimals),
    });
  }
  return rows;
};

/** Sum a period's rows into a single daily total (pure). */
export const sumLedgerRows = (
  rows: LedgerRow[],
): { accruedAztec: number; claimedAztec: number; ourShareAztec: number; otherShareAztec: number } => {
  return rows.reduce(
    (acc, r) => ({
      accruedAztec: acc.accruedAztec + r.accruedAztec,
      claimedAztec: acc.claimedAztec + r.claimedAztec,
      ourShareAztec: acc.ourShareAztec + r.ourShareAztec,
      otherShareAztec: acc.otherShareAztec + r.otherShareAztec,
    }),
    { accruedAztec: 0, claimedAztec: 0, ourShareAztec: 0, otherShareAztec: 0 },
  );
};

/** Sum reward-token `Transfer`s into the coinbases over a block range. */
const scanClaims = async (
  eth: EthereumClient,
  tokenAddress: string,
  coinbases: string[],
  fromBlock: bigint,
  toBlock: bigint,
  historical: boolean,
  gate: RpcGate,
): Promise<Map<string, bigint>> => {
  const claims = new Map<string, bigint>();
  if (fromBlock > toBlock || coinbases.length === 0) {
    return claims;
  }
  const client = historical
    ? (eth.getArchiveClient() ?? eth.getPublicClient())
    : eth.getPublicClient();
  const toAddrs = coinbases.map((c) => getAddress(c));

  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const end = cursor + LOG_CHUNK - 1n > toBlock ? toBlock : cursor + LOG_CHUNK - 1n;
    const logs = await gate(() =>
      client.getLogs({
        address: getAddress(tokenAddress),
        event: TRANSFER_EVENT,
        args: { to: toAddrs },
        fromBlock: cursor,
        toBlock: end,
      }),
    );
    for (const log of logs) {
      const to = (log.args.to as string | undefined)?.toLowerCase();
      const value = log.args.value as bigint | undefined;
      if (to && value !== undefined) {
        claims.set(to, (claims.get(to) ?? 0n) + value);
      }
    }
    cursor = end + 1n;
  }
  return claims;
};

/**
 * Resolve each coinbase's full `SplitUpdated` history in one scan per coinbase
 * (via `getSplitHistory`). The day loop then picks the active version with the
 * pure {@link splitAt} — replacing a per-day `getLatestSplitAllocations` call
 * with a per-run one, so cost is independent of the number of days.
 */
export const buildSplitTimelines = async (
  eth: EthereumClient,
  coinbases: string[],
  splitScanFromBlock: bigint,
  toBlock: bigint,
  gate: RpcGate = noGate,
): Promise<SplitTimeline> => {
  const timelines: SplitTimeline = new Map();
  for (const coinbase of coinbases) {
    const history = await gate(() =>
      eth.getSplitHistory(coinbase, splitScanFromBlock, toBlock).catch(() => []),
    );
    timelines.set(coinbase.toLowerCase(), history);
  }
  return timelines;
};

/**
 * The split allocation in effect at `atBlock` — the latest version with
 * `block <= atBlock`, or null if the coinbase had none yet. Pure — unit tested.
 */
export const splitAt = (
  timelines: SplitTimeline,
  coinbase: string,
  atBlock: bigint,
): SplitAllocationData | null => {
  const history = timelines.get(coinbase.toLowerCase());
  if (!history || history.length === 0) return null;
  let active: SplitAllocationData | null = null;
  for (const version of history) {
    if (version.block > atBlock) break; // ascending — nothing later qualifies
    active = version.split;
  }
  return active;
};

export interface LedgerPeriodParams {
  eth: EthereumClient;
  coinbases: string[];
  /** All rollup versions to sum `getSequencerRewards` across. */
  rollups: Address[];
  rewardToken: RewardToken;
  ourRecipient: string;
  /** Σ getSequencerRewards per coinbase at `startBlock` (lowercase-keyed). */
  prevBalances: Map<string, bigint>;
  startBlock: bigint;
  endBlock: bigint;
  /** Per-coinbase `SplitUpdated` timelines — build once with buildSplitTimelines. */
  splitTimelines: SplitTimeline;
  /** Historical period — read state at `endBlock` via the archive client. */
  historical?: boolean;
  gate?: RpcGate;
}

/**
 * Compute one ledger period: read balances + claims, apply the split active at
 * `endBlock` from the supplied timelines, then `accrued = Δbalance + claims`.
 */
export const computeLedgerPeriod = async (
  params: LedgerPeriodParams,
): Promise<LedgerPeriodResult> => {
  const { eth, coinbases, rollups, rewardToken, ourRecipient, prevBalances } = params;
  const { startBlock, endBlock, splitTimelines } = params;
  const gate = params.gate ?? noGate;
  const historical = params.historical ?? false;

  // 1. Σ getSequencerRewards per coinbase at endBlock, across all rollups.
  const endBalances = new Map<string, bigint>();
  for (const coinbase of coinbases) {
    let sum = 0n;
    for (const rollup of rollups) {
      const balance = await gate(() =>
        eth
          .getSequencerRewardsAt(coinbase, rollup, {
            ...(historical ? { blockNumber: endBlock, useArchive: true } : {}),
          })
          .catch(() => 0n),
      );
      sum += balance;
    }
    endBalances.set(coinbase.toLowerCase(), sum);
  }

  // 2. Claims = reward-token Transfers into the coinbases in (startBlock, endBlock].
  const claims = await scanClaims(
    eth,
    rewardToken.address,
    coinbases,
    startBlock + 1n,
    endBlock,
    historical,
    gate,
  );

  // 3. Apply the split active at endBlock — a pure lookup into the timelines.
  const rows = buildLedgerRows(
    coinbases,
    prevBalances,
    endBalances,
    claims,
    (coinbase) => splitAt(splitTimelines, coinbase, endBlock),
    ourRecipient,
    rewardToken.decimals,
  );

  return { rows, endBalances };
};
