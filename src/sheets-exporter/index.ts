/**
 * Rewards accounting ledger exporter (Part 2 Phase B).
 *
 *   aztec-butler sheets-exporter --network mainnet              # recurring (daily)
 *   aztec-butler sheets-exporter --network mainnet --backfill   # one-time historical fill
 *
 * Builds the event-sourced staking-rewards ledger (`accrued = Δbalance + claims`)
 * and writes daily rows to Google Sheets. Self-contained: chain RPC + the GCP
 * credential. Runs on the monitoring server.
 */

import { getAddress, type Address } from "viem";
import { AztecClient } from "../core/components/AztecClient.js";
import { CoinbaseScraper } from "../core/components/CoinbaseScraper.js";
import { EthereumClient } from "../core/components/EthereumClient.js";
import {
  computeLedgerPeriod,
  sumLedgerRows,
  type LedgerRow,
} from "../core/components/rewards-ledger.js";
import { resolveRewardToken, type RewardToken } from "../core/components/rewards-compute.js";
import { loadSheetsExporterConfig, type SheetsExporterConfig } from "./config.js";
import { balancesFromRecord, balancesToRecord, loadCursor, saveCursor } from "./cursor.js";
import { RateLimiter } from "./rpc.js";
import { appendRows, getSheetsAccessToken, overwriteSheet, spliceSheet } from "./sheet-writer.js";

const AVG_BLOCK_SEC = 12; // L1 Ethereum (mainnet + Sepolia) — used only for day-boundary estimates
const DAY_SEC = 86_400;

const LEDGER_HEADER = [
  "date",
  "coinbase",
  "accrued_aztec",
  "claimed_aztec",
  "our_share_aztec",
  "other_delegate_aztec",
];
const TOTAL_HEADER = ["date", "accrued_aztec", "claimed_aztec", "our_share_aztec", "other_delegate_aztec"];

export interface SheetsExporterOptions {
  network?: string;
  backfill?: boolean;
  /** With `backfill`: recompute from this date (YYYY-MM-DD) onward. Splices the result. */
  backfillFromDate?: string;
  /** With `backfill`: recompute the last N complete days. Splices the result. */
  backfillDays?: number;
  once?: boolean;
  dryRun?: boolean;
  configFilePath?: string;
}

interface ChainContext {
  eth: EthereumClient;
  rollups: Address[];
  rewardToken: RewardToken;
  ourRecipient: string;
  coinbases: string[];
}

const ledgerRowCells = (date: string, row: LedgerRow): string[] => [
  date,
  row.coinbase,
  String(row.accruedAztec),
  String(row.claimedAztec),
  String(row.ourShareAztec),
  String(row.otherShareAztec),
];

const totalRowCells = (date: string, t: ReturnType<typeof sumLedgerRows>): string[] => [
  date,
  String(t.accruedAztec),
  String(t.claimedAztec),
  String(t.ourShareAztec),
  String(t.otherShareAztec),
];

/** Estimate the block number at a unix timestamp from the current block + avg block time. */
const estimateBlock = (
  tsSec: number,
  currentBlock: bigint,
  currentTsSec: number,
  floor: bigint,
): bigint => {
  const delta = BigInt(Math.round((currentTsSec - tsSec) / AVG_BLOCK_SEC));
  const estimate = currentBlock - delta;
  if (estimate < floor) return floor;
  if (estimate > currentBlock) return currentBlock;
  return estimate;
};

/** Resolve everything the ledger needs: chain client, rollups, token, coinbases. */
const prepareChain = async (config: SheetsExporterConfig): Promise<ChainContext> => {
  if (!config.archiveRpcUrl) {
    throw new Error(
      "sheets-exporter requires an archive RPC — set SHEETS_EXPORTER_ARCHIVE_RPC_URL " +
        "(or ETHEREUM_ARCHIVE_NODE_URL). Coinbase discovery and --backfill need it.",
    );
  }

  const nodeInfo = await new AztecClient({ nodeUrl: config.aztecNodeUrl }).getNodeInfo();
  if (nodeInfo.l1ChainId !== config.ethereumChainId) {
    throw new Error(
      `Chain ID mismatch: config ${config.ethereumChainId}, node reports ${nodeInfo.l1ChainId}.`,
    );
  }

  const eth = new EthereumClient({
    rpcUrl: config.ethereumNodeUrl,
    archiveRpcUrl: config.archiveRpcUrl,
    chainId: nodeInfo.l1ChainId,
    rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress as Address,
  });
  await eth.verifyChainId();

  const provider = await eth.getStakingProvider(config.nativeProviderAdminAddress, "native");
  if (!provider || provider.providerId === null) {
    throw new Error(
      `No native staking provider found for admin ${config.nativeProviderAdminAddress}.`,
    );
  }

  // All rollup versions to sum getSequencerRewards across.
  let rollups: Address[];
  try {
    const timeline = await eth.getRollupTimeline(
      getAddress(nodeInfo.l1ContractAddresses.registryAddress),
    );
    rollups =
      timeline.length > 0
        ? timeline.map((entry) => entry.rollup)
        : [getAddress(nodeInfo.l1ContractAddresses.rollupAddress)];
  } catch (error) {
    console.warn(
      `[sheets-exporter] Rollup timeline unavailable, using current rollup only: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    rollups = [getAddress(nodeInfo.l1ContractAddresses.rollupAddress)];
  }

  const rewardToken = await resolveRewardToken(eth, config.rewardTokenAddress);
  const ourRecipient = config.rewardRecipientAddress ?? provider.rewardsRecipient;

  // Coinbase set — discovered purely from StakedWithProvider events.
  const coinbaseScraper = new CoinbaseScraper({
    network: config.network,
    ethClient: eth,
    providerId: provider.providerId,
    attesterAddresses: [], // discover-all mode
    defaultStartBlock: config.stakingRewardsSplitFromBlock,
  });
  const { mappings } = await coinbaseScraper.scrapeIncremental();
  const seen = new Set<string>();
  const coinbases: string[] = [];
  for (const mapping of mappings) {
    const addr = getAddress(mapping.coinbaseAddress as `0x${string}`);
    if (!seen.has(addr.toLowerCase())) {
      seen.add(addr.toLowerCase());
      coinbases.push(addr);
    }
  }

  console.log(
    `[sheets-exporter] ${coinbases.length} coinbase(s), ${rollups.length} rollup version(s), ` +
      `reward token ${rewardToken.address} (decimals=${rewardToken.decimals})`,
  );
  return { eth, rollups, rewardToken, ourRecipient, coinbases };
};

/** Recurring run: one period since the cursor, append today's rows. */
const runRecurring = async (
  config: SheetsExporterConfig,
  ctx: ChainContext,
  dryRun: boolean,
): Promise<void> => {
  const currentBlock = await ctx.eth.getPublicClient().getBlockNumber();
  const today = new Date().toISOString().slice(0, 10);
  const cursor = await loadCursor(config.network);

  if (!cursor) {
    // First run — establish the baseline; the first ledger row comes next run.
    const { endBalances } = await computeLedgerPeriod({
      eth: ctx.eth,
      coinbases: ctx.coinbases,
      rollups: ctx.rollups,
      rewardToken: ctx.rewardToken,
      ourRecipient: ctx.ourRecipient,
      prevBalances: new Map(),
      startBlock: currentBlock,
      endBlock: currentBlock,
      splitScanFromBlock: config.stakingRewardsSplitFromBlock,
    });
    if (!dryRun) {
      await saveCursor({
        network: config.network,
        lastBlock: currentBlock.toString(),
        lastDate: today,
        balances: balancesToRecord(endBalances),
        updatedAt: new Date().toISOString(),
      });
    }
    console.log(
      dryRun
        ? "[sheets-exporter] --dry-run: baseline computed (cursor not persisted)."
        : "[sheets-exporter] Baseline established — first ledger row on the next run.",
    );
    return;
  }

  const startBlock = BigInt(cursor.lastBlock);
  if (currentBlock <= startBlock) {
    console.log("[sheets-exporter] No new blocks since last run — nothing to do.");
    return;
  }

  const { rows, endBalances } = await computeLedgerPeriod({
    eth: ctx.eth,
    coinbases: ctx.coinbases,
    rollups: ctx.rollups,
    rewardToken: ctx.rewardToken,
    ourRecipient: ctx.ourRecipient,
    prevBalances: balancesFromRecord(cursor.balances),
    startBlock,
    endBlock: currentBlock,
    splitScanFromBlock: config.stakingRewardsSplitFromBlock,
  });

  const ledgerCells = rows.map((row) => ledgerRowCells(today, row));
  const totalCells = [totalRowCells(today, sumLedgerRows(rows))];

  if (dryRun) {
    console.log(`[sheets-exporter] --dry-run: ledger rows for ${today}:`);
    console.table([...ledgerCells, ["—"], ...totalCells]);
  } else {
    const token = await getSheetsAccessToken(config.gcpKeyFile);
    await appendRows(config.spreadsheetId, config.ledgerRange, ledgerCells, token);
    await appendRows(config.spreadsheetId, config.dailyTotalRange, totalCells, token);
    console.log(`[sheets-exporter] Appended ${ledgerCells.length} ledger row(s) for ${today}.`);
  }

  if (!dryRun) {
    await saveCursor({
      network: config.network,
      lastBlock: currentBlock.toString(),
      lastDate: today,
      balances: balancesToRecord(endBalances),
      updatedAt: new Date().toISOString(),
    });
  }
};

interface BackfillRange {
  /** Recompute from this date (YYYY-MM-DD) onward. Mutually exclusive with `days`. */
  fromDate?: string;
  /** Recompute the last N complete days. Mutually exclusive with `fromDate`. */
  days?: number;
}

/**
 * Backfill: reconstruct daily ledger history from chain.
 *
 * Full (no range) → recompute genesis→yesterday and overwrite both tabs.
 * Ranged (`fromDate`/`days`) → recompute only that window and splice it into the
 * existing sheet, preserving every row outside the window.
 */
const runBackfill = async (
  config: SheetsExporterConfig,
  ctx: ChainContext,
  dryRun: boolean,
  range: BackfillRange = {},
): Promise<void> => {
  const client = ctx.eth.getPublicClient();
  const currentBlock = await client.getBlockNumber();
  const currentBlockData = await client.getBlock({ blockNumber: currentBlock });
  const currentTs = Number(currentBlockData.timestamp);

  const startBlockData = await client.getBlock({
    blockNumber: config.stakingRewardsSplitFromBlock,
  });
  const startTs = Number(startBlockData.timestamp);

  // Day boundaries: genesis = the split-from block's day; end = yesterday.
  const genesisDay = Math.floor(startTs / DAY_SEC) * DAY_SEC;
  const lastCompleteDay = Math.floor(currentTs / DAY_SEC) * DAY_SEC - DAY_SEC;

  // Resolve the window. Default = full history; a range narrows the start.
  let firstDay = genesisDay;
  if (range.fromDate) {
    const parsed = Date.parse(`${range.fromDate}T00:00:00Z`);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid --from-date "${range.fromDate}" — expected YYYY-MM-DD.`);
    }
    firstDay = Math.floor(parsed / 1000 / DAY_SEC) * DAY_SEC;
  } else if (range.days !== undefined) {
    firstDay = lastCompleteDay - (range.days - 1) * DAY_SEC;
  }
  if (firstDay < genesisDay) firstDay = genesisDay;
  if (firstDay > lastCompleteDay) {
    throw new Error(
      `Backfill window is empty: ${new Date(firstDay * 1000).toISOString().slice(0, 10)} ` +
        `is after the last complete day (${new Date(lastCompleteDay * 1000).toISOString().slice(0, 10)}).`,
    );
  }
  const ranged = firstDay > genesisDay;
  const fromDateStr = new Date(firstDay * 1000).toISOString().slice(0, 10);
  const toDateStr = new Date(lastCompleteDay * 1000).toISOString().slice(0, 10);

  const gate = new RateLimiter({ maxRps: config.maxRps }).run;
  const ledgerCells: string[][] = [];
  const totalCells: string[][] = [];
  let prevBalances = new Map<string, bigint>();
  let prevBlock = config.stakingRewardsSplitFromBlock;

  // A ranged backfill does not start at genesis, so it must anchor its opening
  // balances with one historical Σ getSequencerRewards read at the window start.
  if (ranged) {
    prevBlock = estimateBlock(firstDay, currentBlock, currentTs, config.stakingRewardsSplitFromBlock);
    console.log(
      `[sheets-exporter] ranged backfill ${fromDateStr}..${toDateStr} — ` +
        `anchoring opening balances at block ${prevBlock}`,
    );
    const anchor = await computeLedgerPeriod({
      eth: ctx.eth,
      coinbases: ctx.coinbases,
      rollups: ctx.rollups,
      rewardToken: ctx.rewardToken,
      ourRecipient: ctx.ourRecipient,
      prevBalances: new Map(),
      startBlock: prevBlock,
      endBlock: prevBlock,
      splitScanFromBlock: config.stakingRewardsSplitFromBlock,
      historical: true,
      gate,
    });
    prevBalances = anchor.endBalances;
  } else {
    console.log(`[sheets-exporter] full backfill ${fromDateStr}..${toDateStr}`);
  }

  let dayCount = 0;
  for (let dayStart = firstDay; dayStart <= lastCompleteDay; dayStart += DAY_SEC) {
    const date = new Date(dayStart * 1000).toISOString().slice(0, 10);
    const endBlock = estimateBlock(
      dayStart + DAY_SEC,
      currentBlock,
      currentTs,
      config.stakingRewardsSplitFromBlock,
    );

    const { rows, endBalances } = await computeLedgerPeriod({
      eth: ctx.eth,
      coinbases: ctx.coinbases,
      rollups: ctx.rollups,
      rewardToken: ctx.rewardToken,
      ourRecipient: ctx.ourRecipient,
      prevBalances,
      startBlock: prevBlock,
      endBlock,
      splitScanFromBlock: config.stakingRewardsSplitFromBlock,
      historical: true,
      gate,
    });

    for (const row of rows) ledgerCells.push(ledgerRowCells(date, row));
    totalCells.push(totalRowCells(date, sumLedgerRows(rows)));
    prevBalances = endBalances;
    prevBlock = endBlock;
    dayCount++;
    if (dayCount % 10 === 0) {
      console.log(`[sheets-exporter] backfill: ${dayCount} day(s) processed (through ${date})`);
    }
  }

  console.log(`[sheets-exporter] backfill computed ${dayCount} day(s), ${ledgerCells.length} rows.`);

  if (dryRun) {
    console.log("[sheets-exporter] --dry-run: not writing to Sheets. Daily totals:");
    console.table(
      totalCells.length <= 12
        ? totalCells
        : [...totalCells.slice(0, 5), ["…"], ...totalCells.slice(-5)],
    );
    return;
  }

  const token = await getSheetsAccessToken(config.gcpKeyFile);
  if (ranged) {
    // Splice: replace only the window's rows, preserve everything else.
    const led = await spliceSheet(
      config.spreadsheetId, config.ledgerRange, LEDGER_HEADER, ledgerCells, fromDateStr, toDateStr, token,
    );
    await spliceSheet(
      config.spreadsheetId, config.dailyTotalRange, TOTAL_HEADER, totalCells, fromDateStr, toDateStr, token,
    );
    console.log(
      `[sheets-exporter] spliced ${ledgerCells.length} ledger row(s) into ${fromDateStr}..${toDateStr}; ` +
        `${led.preserved} row(s) outside the window preserved.`,
    );
  } else {
    await overwriteSheet(config.spreadsheetId, config.ledgerRange, [LEDGER_HEADER, ...ledgerCells], token);
    await overwriteSheet(config.spreadsheetId, config.dailyTotalRange, [TOTAL_HEADER, ...totalCells], token);
  }

  await saveCursor({
    network: config.network,
    lastBlock: prevBlock.toString(),
    lastDate: new Date(lastCompleteDay * 1000).toISOString().slice(0, 10),
    balances: balancesToRecord(prevBalances),
    updatedAt: new Date().toISOString(),
  });
  console.log(
    ranged
      ? "[sheets-exporter] Ranged backfill complete — window spliced, cursor refreshed."
      : "[sheets-exporter] Backfill complete — Sheet filled, cursor handed off to the recurring service.",
  );
};

export const startSheetsExporter = async (options: SheetsExporterOptions = {}): Promise<void> => {
  const network = options.network?.trim();
  if (!network) {
    throw new Error("sheets-exporter requires --network <network>.");
  }

  if (options.backfillFromDate && options.backfillDays !== undefined) {
    throw new Error("Pass either --from-date or --days, not both.");
  }
  if ((options.backfillFromDate || options.backfillDays !== undefined) && !options.backfill) {
    throw new Error("--from-date / --days only apply together with --backfill.");
  }

  const config = options.configFilePath
    ? loadSheetsExporterConfig(network, { configFilePath: options.configFilePath })
    : loadSheetsExporterConfig(network);

  console.log(
    `[sheets-exporter] network=${config.network} mode=${options.backfill ? "backfill" : "recurring"} ` +
      `sheet=${config.spreadsheetId}`,
  );

  const ctx = await prepareChain(config);

  if (options.backfill) {
    await runBackfill(config, ctx, options.dryRun ?? false, {
      ...(options.backfillFromDate ? { fromDate: options.backfillFromDate } : {}),
      ...(options.backfillDays !== undefined ? { days: options.backfillDays } : {}),
    });
    return;
  }

  // Recurring mode.
  await runRecurring(config, ctx, options.dryRun ?? false);
  if (options.once || options.dryRun) {
    return;
  }

  const tick = () => {
    void runRecurring(config, ctx, false).catch((error) => {
      console.error("[sheets-exporter] Run failed:", error);
    });
  };
  const handle = setInterval(tick, config.intervalMs);

  const shutdown = () => {
    clearInterval(handle);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  console.log(
    `\n=== sheets-exporter running (every ${config.intervalMs / 3_600_000}h) ===\nPress Ctrl+C to stop\n`,
  );
};
