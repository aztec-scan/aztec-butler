import { AbstractScraper } from "./base-scraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { AztecClient } from "../../core/components/AztecClient.js";
import { EthereumClient } from "../../core/components/EthereumClient.js";
import {
  getAttesterCoinbaseInfo,
  updateStakingRewardsData,
  recordStakingRewardsSnapshots,
  getLatestStakingRewardsSnapshotTimestamp,
} from "../state/index.js";
import {
  StakingRewardsEntrySchema,
  type StakingRewardsMap,
  type StakingRewardsRecipient,
  type StakingRewardsSnapshot,
} from "../../types/index.js";
import { getAddress } from "viem";
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

    console.log(
      `Staking rewards scraper initialized (target Safe ${this.safeAddress})`,
    );

    await this.backfillHistory();
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
    const rollupContract = useArchiveClient
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

    const lastSnapshotTimestamp =
      getLatestStakingRewardsSnapshotTimestamp(this.network)?.getTime() ?? null;

    const effectiveStartMs = lastSnapshotTimestamp
      ? lastSnapshotTimestamp + ONE_HOUR_MS
      : startTimestampMs;
    const backfillStartMs = alignTimestampToHour(effectiveStartMs);
    const now = Date.now();

    if (backfillStartMs > now) {
      return;
    }

    console.log(
      `[staking-rewards] Backfilling hourly snapshots from ${new Date(backfillStartMs).toISOString()} (start block ${this.startBlock})`,
    );

    let consecutiveHistoricalStateErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3; // Disable after 3 consecutive errors

    for (let ts = backfillStartMs; ts <= now; ts += ONE_HOUR_MS) {
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
      useArchiveClient && archiveClient ? archiveClient : this.ethClient.getPublicClient();

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

    return Array.from(map.entries()).map(([coinbase, attesters]) => ({
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
