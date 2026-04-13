import { AbstractScraper } from "./base-scraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { AztecClient } from "../../core/components/AztecClient.js";
import {
  EthereumClient,
  type RollupTimelineEntry,
} from "../../core/components/EthereumClient.js";
import {
  getAttesterCoinbaseInfo,
  getAttesterStates,
  getStakingRewardsHistory,
  updateStakingRewardsData,
  recordStakingRewardsSnapshots,
  AttesterState,
} from "../state/index.js";
import {
  StakingRewardsEntrySchema,
  type StakingRewardsMap,
  type StakingRewardsRecipient,
  type StakingRewardsSnapshot,
} from "../../types/index.js";
import { getAddress, type Address } from "viem";
import {
  exportStakingRewardsDailyToSheets,
  exportCoinbasesToSheets,
  exportStakingRewardsDailyPerCoinbaseToSheets,
  exportStakingRewardsDailyEarnedToSheets,
} from "../exporters/sheets-staking-rewards.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const alignTimestampToHour = (timestampMs: number): number =>
  Math.floor(timestampMs / ONE_HOUR_MS) * ONE_HOUR_MS;

interface CoinbaseEntry {
  coinbase: string;
  attesters: string[];
}

/**
 * Scraper that periodically fetches staking rewards per coinbase and
 * calculates the portion flowing to our Safe multisig.
 */
export class StakingRewardsScraper extends AbstractScraper {
  readonly name = "staking-rewards";
  readonly network: string;

  private ethClient: EthereumClient | null = null;
  private safeAddress: string;
  private startBlock: bigint;
  private backfillDisabled: boolean = false;
  // Ascending-by-firstBlock timeline of Aztec rollup versions. Each
  // entry defines the rollup canonical from [firstBlock, nextFirstBlock).
  // Populated in init() from the Aztec Registry contract.
  private rollupTimeline: RollupTimelineEntry[] = [];

  constructor(
    network: string,
    private config: ButlerConfig,
  ) {
    super();
    this.network = network;

    if (!config.SAFE_ADDRESS) {
      throw new Error(
        "SAFE_ADDRESS must be configured to enable staking rewards tracking",
      );
    }

    this.safeAddress = getAddress(config.SAFE_ADDRESS);
    this.startBlock = config.STAKING_REWARDS_SPLIT_FROM_BLOCK ?? 0n;
  }

  async init(): Promise<void> {
    const aztecClient = new AztecClient({
      nodeUrl: this.config.AZTEC_NODE_URL,
    });
    const nodeInfo = await aztecClient.getNodeInfo();

    this.ethClient = new EthereumClient({
      rpcUrl: this.config.ETHEREUM_NODE_URL,
      ...(this.config.ETHEREUM_ARCHIVE_NODE_URL
        ? { archiveRpcUrl: this.config.ETHEREUM_ARCHIVE_NODE_URL }
        : {}),
      chainId: nodeInfo.l1ChainId,
      rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress.toString(),
    });

    // Build the rollup version timeline from the Aztec Registry so that
    // backfill can dispatch each historical block to the rollup that was
    // canonical at that block. Without this, calls against the current
    // rollup for blocks before its deployment return "0x" and snapshots
    // are silently lost.
    const registryAddress = getAddress(
      nodeInfo.l1ContractAddresses.registryAddress.toString() as `0x${string}`,
    );
    try {
      this.rollupTimeline =
        await this.ethClient.getRollupTimeline(registryAddress);
      console.log(
        `[staking-rewards] Rollup timeline (${this.rollupTimeline.length} versions, from registry):`,
      );
    } catch (error) {
      console.error(
        "[staking-rewards] Failed to load rollup timeline from registry; using known-mainnet fallback if applicable",
        error,
      );
      this.rollupTimeline = this.getFallbackRollupTimeline(nodeInfo.l1ChainId);
      if (this.rollupTimeline.length > 0) {
        console.log(
          `[staking-rewards] Rollup timeline (${this.rollupTimeline.length} versions, from hardcoded fallback):`,
        );
      }
    }
    for (const entry of this.rollupTimeline) {
      console.log(
        `  version=${entry.version} rollup=${entry.rollup} firstBlock=${entry.firstBlock}`,
      );
    }

    // Clip the configured start block forward to the earliest rollup
    // deployment — scraping before any rollup exists is guaranteed to
    // fail with empty responses.
    if (this.rollupTimeline.length > 0) {
      const oldestRollupBlock = this.rollupTimeline[0]!.firstBlock;
      if (this.startBlock < oldestRollupBlock) {
        console.log(
          `[staking-rewards] Clipping start block ${this.startBlock} -> ${oldestRollupBlock} (oldest rollup deployment)`,
        );
        this.startBlock = oldestRollupBlock;
      }
    }

    console.log(
      `Staking rewards scraper initialized (target Safe ${this.safeAddress})`,
    );

    void this.backfillHistory().catch((error) => {
      console.error("[staking-rewards] Backfill failed:", error);
    });
  }

  /**
   * Hardcoded rollup timeline for chains where registry discovery is
   * unreliable. Only mainnet is known at time of writing. Used as a
   * fallback when the dynamic registry fetch fails (e.g. public RPC
   * rejects the binary-search getCode calls).
   *
   * Addresses and first-deployed blocks verified via on-chain query to
   * the Aztec Registry at 0x35b22e09Ee0390539439E24f06Da43D83f90e298.
   */
  private getFallbackRollupTimeline(chainId: number): RollupTimelineEntry[] {
    if (chainId === 1) {
      return [
        {
          version: 0n,
          rollup: getAddress(
            "0x603bb2c05D474794ea97805e8De69bCcFb3bCA12",
          ) as Address,
          firstBlock: 23786836n,
        },
        {
          version: 2934756905n,
          rollup: getAddress(
            "0xAe2001f7e21d5EcABf6234E9FDd1E76F50F74962",
          ) as Address,
          firstBlock: 24586322n,
        },
      ];
    }
    return [];
  }

  /**
   * Return the rollup address that was canonical at the given L1 block.
   * Falls back to the ethClient's configured rollup address if the
   * timeline is empty (registry unavailable) or the block predates any
   * known rollup.
   */
  private rollupForBlock(block: bigint): Address | null {
    if (this.rollupTimeline.length === 0) {
      return null;
    }
    let selected: RollupTimelineEntry | null = null;
    for (const entry of this.rollupTimeline) {
      if (block >= entry.firstBlock) {
        selected = entry;
      } else {
        break;
      }
    }
    return selected ? selected.rollup : null;
  }

  async scrape(): Promise<void> {
    if (!this.ethClient) {
      console.warn("[staking-rewards] Ethereum client not initialized");
      return;
    }

    const coinbases = this.getCoinbaseEntries();
    if (coinbases.length === 0) {
      console.warn(
        "[staking-rewards] No coinbase data available in state, skipping scrape",
      );
      updateStakingRewardsData(this.network, null);
      await this.exportAggregatesAndCoinbases(); // still publish headers to Sheets
      return;
    }

    const client = this.ethClient.getPublicClient();
    const blockNumber = await client.getBlockNumber();
    const block = await this.getBlockWithFallback(blockNumber);
    const blockTimestampMs = Number(block.timestamp) * 1000;

    const { rewardsMap, snapshots, totalOurShare } =
      await this.collectRewardsForBlock(
        blockNumber,
        new Date(blockTimestampMs),
        coinbases,
        false,
      );

    updateStakingRewardsData(this.network, rewardsMap);
    recordStakingRewardsSnapshots(this.network, snapshots);

    console.log(
      `[staking-rewards] Scraped ${rewardsMap.size} coinbases at block ${blockNumber}. Estimated Safe share: ${totalOurShare.toString()} units`,
    );

    await this.exportAggregatesAndCoinbases();
  }

  private async collectRewardsForBlock(
    blockNumber: bigint,
    timestamp: Date,
    coinbases: CoinbaseEntry[],
    useArchiveClient: boolean,
  ): Promise<{
    rewardsMap: StakingRewardsMap;
    snapshots: StakingRewardsSnapshot[];
    totalOurShare: bigint;
  }> {
    if (!this.ethClient) {
      throw new Error("Ethereum client not initialized");
    }

    const rewardsMap: StakingRewardsMap = new Map();
    const snapshots: StakingRewardsSnapshot[] = [];

    // Pick the rollup contract that was canonical at this block. If the
    // timeline is empty (registry unavailable), fall back to the single
    // rollup address the node reported at init time.
    const rollupAddressAtBlock = this.rollupForBlock(blockNumber);
    if (rollupAddressAtBlock === null && this.rollupTimeline.length > 0) {
      // Block predates every known rollup deployment — skip silently.
      return { rewardsMap, snapshots, totalOurShare: 0n };
    }
    const rollupContract = rollupAddressAtBlock
      ? this.ethClient.getRollupContractAt(
          rollupAddressAtBlock,
          useArchiveClient,
        )
      : useArchiveClient
        ? this.ethClient.getRollupContractForHistorical()
        : this.ethClient.getRollupContract();

    let totalOurShare = 0n;
    for (const entry of coinbases) {
      try {
        const isDeployed = await this.isCoinbaseDeployed(
          entry.coinbase,
          blockNumber,
          useArchiveClient,
        );

        if (!isDeployed) {
          console.warn(
            `[staking-rewards] Coinbase ${entry.coinbase} not yet deployed at block ${blockNumber}, skipping until it is on-chain`,
          );
          continue;
        }

        const pendingRewards = await rollupContract.read.getSequencerRewards(
          [entry.coinbase],
          { blockNumber },
        );

        const splitData = await this.ethClient.getLatestSplitAllocations(
          entry.coinbase,
          this.startBlock,
          blockNumber,
        );

        const recipients: StakingRewardsRecipient[] =
          splitData?.recipients.map((recipient, idx) => ({
            address: recipient,
            allocation: splitData.allocations[idx] ?? 0n,
          })) ?? [];

        const totalAllocation =
          splitData && splitData.totalAllocation > 0n
            ? splitData.totalAllocation
            : 10_000n;

        const ourAllocation = this.getOurAllocation(
          recipients,
          totalAllocation,
        );

        const ourShare =
          totalAllocation > 0n
            ? (pendingRewards * ourAllocation) / totalAllocation
            : pendingRewards;
        const otherShare = pendingRewards - ourShare;

        const parsedEntry = StakingRewardsEntrySchema.parse({
          coinbase: entry.coinbase,
          attesters: entry.attesters,
          pendingRewards,
          ourShare,
          otherShare: otherShare >= 0n ? otherShare : 0n,
          totalAllocation,
          ourAllocation,
          recipients:
            recipients.length > 0
              ? recipients
              : [
                  {
                    address: this.safeAddress,
                    allocation: totalAllocation,
                  },
                ],
          lastUpdated: timestamp,
        });

        rewardsMap.set(entry.coinbase.toLowerCase(), parsedEntry);
        snapshots.push({
          ...parsedEntry,
          blockNumber,
          timestamp,
          ...(rollupAddressAtBlock
            ? { rollupAddress: rollupAddressAtBlock }
            : {}),
        });
        totalOurShare += ourShare;
      } catch (error) {
        // Check if this is a historical state unavailability error
        if (this.isHistoricalStateError(error)) {
          // Throw the error to propagate it up - we want to stop processing this block
          throw error;
        }
        // For other errors, just log and continue with next coinbase
        console.error(
          `[staking-rewards] Failed to process coinbase ${entry.coinbase} at block ${blockNumber}:`,
          error,
        );
      }
    }

    return { rewardsMap, snapshots, totalOurShare };
  }

  private async backfillHistory(): Promise<void> {
    if (!this.ethClient) {
      return;
    }

    if (this.backfillDisabled) {
      console.log(
        "[staking-rewards] Backfill is disabled due to historical state unavailability. " +
          "Configure ETHEREUM_ARCHIVE_NODE_URL with a proper archive node or adjust STAKING_REWARDS_SPLIT_FROM_BLOCK to enable backfill.",
      );
      return;
    }

    const coinbases = this.getCoinbaseEntries();
    if (coinbases.length === 0) {
      console.warn(
        "[staking-rewards] No coinbase data available, skipping staking rewards backfill",
      );
      await this.exportAggregatesAndCoinbases(); // still publish headers to Sheets
      return;
    }

    const client = this.ethClient.getPublicClient();
    const latestBlock = await client.getBlockNumber();

    if (this.startBlock > latestBlock) {
      console.warn(
        `[staking-rewards] Configured start block ${this.startBlock} is ahead of the current chain head ${latestBlock}, skipping backfill`,
      );
      return;
    }

    const startBlockData = await this.getBlockWithFallback(this.startBlock);
    const startTimestampMs = Number(startBlockData.timestamp) * 1000;
    const backfillStartMs = alignTimestampToHour(startTimestampMs);
    const now = Date.now();

    if (backfillStartMs > now) {
      return;
    }

    // Walk the entire [startBlock, now] range at hourly resolution and
    // only backfill hours that are NOT already present in state. This
    // makes backfill a gap-filler rather than a forward-extender — any
    // restart resumes from wherever the gap is, regardless of whether
    // the live scrape has already written a future-tagged snapshot.
    const filledHours = new Set<number>();
    for (const snap of getStakingRewardsHistory(this.network)) {
      filledHours.add(alignTimestampToHour(snap.timestamp.getTime()));
    }

    const totalHours =
      Math.floor((now - backfillStartMs) / ONE_HOUR_MS) + 1;
    const missingHours = Math.max(0, totalHours - filledHours.size);

    console.log(
      `[staking-rewards] Backfilling hourly snapshots from ${new Date(backfillStartMs).toISOString()} ` +
        `to ${new Date(now).toISOString()} — ${missingHours}/${totalHours} hours missing (start block ${this.startBlock})`,
    );

    if (missingHours === 0) {
      await this.exportAggregatesAndCoinbases();
      return;
    }

    let consecutiveHistoricalStateErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3; // Disable after 3 consecutive errors

    for (let ts = backfillStartMs; ts <= now; ts += ONE_HOUR_MS) {
      if (filledHours.has(ts)) {
        continue;
      }
      try {
        const { blockNumber, blockTimestampMs } =
          await this.findBlockAtOrBeforeTimestamp(
            ts,
            this.startBlock,
            latestBlock,
          );

        const { snapshots } = await this.collectRewardsForBlock(
          blockNumber,
          new Date(blockTimestampMs),
          coinbases,
          true,
        );

        recordStakingRewardsSnapshots(this.network, snapshots);
        filledHours.add(ts);
        consecutiveHistoricalStateErrors = 0; // Reset counter on success
      } catch (error) {
        if (this.isHistoricalStateError(error)) {
          consecutiveHistoricalStateErrors++;

          if (consecutiveHistoricalStateErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.warn(
              `[staking-rewards] Historical state unavailable for ${MAX_CONSECUTIVE_ERRORS} consecutive snapshots. ` +
                `Disabling backfill to avoid spamming the RPC node. ` +
                `Configure ETHEREUM_ARCHIVE_NODE_URL with a proper archive node or adjust STAKING_REWARDS_SPLIT_FROM_BLOCK to enable backfill.`,
            );
            this.backfillDisabled = true;
            return; // Exit backfill early
          }

          console.warn(
            `[staking-rewards] Historical state not available at ${new Date(ts).toISOString()} ` +
              `(${consecutiveHistoricalStateErrors}/${MAX_CONSECUTIVE_ERRORS} consecutive errors before disabling backfill)`,
          );
        } else {
          // For other errors, log and continue
          console.error(
            `[staking-rewards] Error during backfill at ${new Date(ts).toISOString()}:`,
            error,
          );
          consecutiveHistoricalStateErrors = 0; // Reset on non-historical errors
        }
      }
    }

    await this.exportAggregatesAndCoinbases();
  }

  private async findBlockAtOrBeforeTimestamp(
    targetTimestampMs: number,
    lowerBound: bigint,
    upperBound: bigint,
  ): Promise<{ blockNumber: bigint; blockTimestampMs: number }> {
    if (!this.ethClient) {
      throw new Error("Ethereum client not initialized");
    }

    let low = lowerBound;
    let high = upperBound;
    let best = lowerBound;

    while (low <= high) {
      const mid = (low + high) / 2n;
      const block = await this.getBlockWithFallback(mid);
      const timestampMs = Number(block.timestamp) * 1000;

      if (timestampMs === targetTimestampMs) {
        return { blockNumber: mid, blockTimestampMs: timestampMs };
      }

      if (timestampMs < targetTimestampMs) {
        best = mid;
        low = mid + 1n;
      } else {
        if (mid === 0n) {
          break;
        }
        high = mid - 1n;
      }
    }

    const bestBlock = await this.getBlockWithFallback(best);
    return {
      blockNumber: best,
      blockTimestampMs: Number(bestBlock.timestamp) * 1000,
    };
  }

  private async exportAggregatesAndCoinbases(): Promise<void> {
    try {
      await exportStakingRewardsDailyToSheets(this.network, this.config);
      await exportStakingRewardsDailyPerCoinbaseToSheets(
        this.network,
        this.config,
      );
      await exportStakingRewardsDailyEarnedToSheets(this.network, this.config);
      await exportCoinbasesToSheets(this.network, this.config);
    } catch (err) {
      console.warn("[staking-rewards] Failed to export to Google Sheets:", err);
    }
  }

  private async getBlockWithFallback(blockNumber: bigint) {
    if (!this.ethClient) {
      throw new Error("Ethereum client not initialized");
    }

    const primary = this.ethClient.getPublicClient();
    const archive = this.ethClient.getArchiveClient();

    try {
      return await primary.getBlock({ blockNumber });
    } catch (err) {
      if (!archive) {
        throw err;
      }
      console.warn(
        `[staking-rewards] Primary RPC failed to fetch block ${blockNumber}, trying archive...`,
        err,
      );
      return await archive.getBlock({ blockNumber });
    }
  }

  async shutdown(): Promise<void> {
    console.log("[staking-rewards] Shutting down...");
    this.ethClient = null;
    updateStakingRewardsData(this.network, null);
  }

  private async isCoinbaseDeployed(
    coinbase: string,
    blockNumber: bigint,
    useArchiveClient: boolean,
  ): Promise<boolean> {
    if (!this.ethClient) {
      throw new Error("Ethereum client not initialized");
    }

    const archiveClient = this.ethClient.getArchiveClient();
    const client =
      useArchiveClient && archiveClient
        ? archiveClient
        : this.ethClient.getPublicClient();

    try {
      const bytecode = await client.getCode({
        address: getAddress(coinbase as `0x${string}`),
        blockNumber,
      });
      return bytecode !== "0x";
    } catch (err) {
      console.warn(
        `[staking-rewards] Failed to check deployment for coinbase ${coinbase} at block ${blockNumber}, will retry next scrape`,
        err,
      );
      return false;
    }
  }

  private getCoinbaseEntries(): CoinbaseEntry[] {
    const coinbaseInfo = getAttesterCoinbaseInfo(this.network);
    if (!coinbaseInfo.size) {
      return [];
    }

    const map = new Map<string, Set<string>>();
    for (const [attester, rawCoinbase] of coinbaseInfo.entries()) {
      const attesterAddress = getAddress(attester as `0x${string}`);
      const targetCoinbase =
        rawCoinbase && rawCoinbase.length > 0 ? rawCoinbase : attesterAddress;
      const coinbase = getAddress(targetCoinbase as `0x${string}`);

      if (!map.has(coinbase)) {
        map.set(coinbase, new Set());
      }
      map.get(coinbase)!.add(attesterAddress);
    }

    const attesterStates = getAttesterStates(this.network);
    const history = getStakingRewardsHistory(this.network);

    // Build a map of coinbase -> latest pending rewards from history
    const latestPendingByCoinbase = new Map<string, bigint>();
    for (const snap of history) {
      const key = snap.coinbase.toLowerCase();
      latestPendingByCoinbase.set(key, snap.pendingRewards);
    }

    return Array.from(map.entries())
      .filter(([coinbase, attesters]) => {
        // Keep coinbases that have at least one non-exited attester
        const allExited = Array.from(attesters).every((addr) => {
          const state = attesterStates.get(addr);
          return state?.state === AttesterState.NO_LONGER_ACTIVE;
        });

        if (!allExited) {
          return true;
        }

        // All attesters exited — keep only if there are still pending rewards
        const lastPending =
          latestPendingByCoinbase.get(coinbase.toLowerCase()) ?? 0n;
        if (lastPending === 0n) {
          console.log(
            `[staking-rewards] Skipping coinbase ${coinbase}: all attesters exited and no pending rewards`,
          );
          return false;
        }

        return true;
      })
      .map(([coinbase, attesters]) => ({
        coinbase,
        attesters: Array.from(attesters),
      }));
  }

  private isHistoricalStateError(error: unknown): boolean {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return (
      errorMsg.includes("historical state") &&
      errorMsg.includes("is not available")
    );
  }

  private getOurAllocation(
    recipients: StakingRewardsRecipient[],
    totalAllocation: bigint,
  ): bigint {
    if (recipients.length === 0) {
      return totalAllocation;
    }

    const safeLower = this.safeAddress.toLowerCase();
    const allocation = recipients
      .filter((recipient) => recipient.address.toLowerCase() === safeLower)
      .reduce((sum, recipient) => sum + recipient.allocation, 0n);

    if (allocation === 0n) {
      return totalAllocation;
    }

    return allocation > totalAllocation ? totalAllocation : allocation;
  }
}
