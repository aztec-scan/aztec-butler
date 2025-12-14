/**
 * CLI Command: Get Queue Stats
 *
 * Displays entry queue statistics and timing estimates for attesters
 */

import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";

interface GetQueueStatsOptions {
  network: string;
  json?: boolean;
}

/**
 * Fetch average L2 block time from Aztecscan API
 * @returns Block time in milliseconds
 * @throws Error if API call fails
 */
async function fetchL2BlockTime(): Promise<number> {
  const response = await fetch(
    "https://api.aztecscan.xyz/v1/temporary-api-key/l2/stats/average-block-time",
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch L2 block time from Aztecscan: ${response.status} ${response.statusText}`,
    );
  }

  const blockTimeStr = await response.text();
  const blockTimeMs = Number(JSON.parse(blockTimeStr));

  if (typeof blockTimeMs !== "number" || blockTimeMs <= 0) {
    throw new Error(
      `Invalid block time received from Aztecscan: ${blockTimeStr}`,
    );
  }

  return blockTimeMs;
}

/**
 * Format Unix timestamp to human-readable date and time in relative format
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffMinutes = diffMs / (1000 * 60);

  let relative = "";
  if (diffHours >= 1) {
    relative = `in ${diffHours.toFixed(1)} hours`;
  } else if (diffMinutes >= 1) {
    relative = `in ${diffMinutes.toFixed(1)} minutes`;
  } else if (diffMinutes > -1) {
    relative = "now";
  } else if (diffHours > -1) {
    relative = `${Math.abs(diffMinutes).toFixed(1)} minutes ago`;
  } else {
    relative = `${Math.abs(diffHours).toFixed(1)} hours ago`;
  }

  return `${date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC")} (${relative})`;
}

/**
 * Format duration in seconds to human-readable format
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours >= 1) {
    return `${hours} hour${hours > 1 ? "s" : ""}`;
  } else if (minutes >= 1) {
    return `~${minutes} minute${minutes > 1 ? "s" : ""}`;
  } else {
    return `~${Math.floor(seconds)} second${seconds !== 1 ? "s" : ""}`;
  }
}

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: GetQueueStatsOptions,
) => {
  // 1. Fetch L2 block time from Aztecscan
  const l2BlockTimeMs = await fetchL2BlockTime();
  const l2BlockTimeSec = l2BlockTimeMs / 1000;

  // 2. Fetch global entry queue data
  const totalQueueLength = await ethClient.getEntryQueueLength();
  const currentEpoch = await ethClient.getCurrentEpoch();
  const epochDurationSlots = await ethClient.getEpochDuration();
  const flushSize = await ethClient.getEntryQueueFlushSize();
  const availableFlushes = await ethClient.getAvailableValidatorFlushes();
  const nextFlushableEpoch = await ethClient.getNextFlushableEpoch();
  const isBootstrapped = await ethClient.getIsBootstrapped();

  // 3. Convert epoch duration from L2 slots to seconds using fetched block time
  const epochDuration = epochDurationSlots * BigInt(Math.floor(l2BlockTimeSec));

  // 4. Calculate time per attester
  const timePerAttester =
    flushSize > 0n ? Number(epochDuration) / Number(flushSize) : 0;

  // 5. Get global entry queue attesters
  const globalQueue = await ethClient.getAllQueuedAttesters();

  // 6. Calculate last attester estimated entry timestamp
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const lastAttesterPosition =
    globalQueue.length > 0 ? globalQueue.length - 1 : 0;
  const lastAttesterEstimatedEntryTimestamp =
    globalQueue.length > 0 && timePerAttester > 0
      ? currentTimestamp + Math.floor(lastAttesterPosition * timePerAttester)
      : currentTimestamp;

  // 7. Get provider data (if configured)
  let providerId: bigint | null = null;
  let providerQueueCount = 0;
  let providerNextAttesterArrivalTimestamp: number | null = null;
  let providerNextMissingCoinbaseArrivalTimestamp: number | null = null;
  let providerNextMissingCoinbaseAddress: string | null = null;
  let providerLastAttesterArrivalTimestamp: number | null = null;

  const stakingProviderAdmin = config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS;
  if (stakingProviderAdmin) {
    const stakingProviderData =
      await ethClient.getStakingProvider(stakingProviderAdmin);

    if (stakingProviderData) {
      providerId = stakingProviderData.providerId;

      // Load cached attesters to find YOUR attesters in the entry queue
      const { loadCachedAttesters } = await import(
        "../../core/utils/cachedAttestersOperations.js"
      );
      let cachedAttesters;
      try {
        cachedAttesters = await loadCachedAttesters(options.network);
      } catch (error) {
        console.warn(
          "Warning: Could not load cached attesters. Run scrape-attester-status first.",
        );
        cachedAttesters = null;
      }

      // Find YOUR attesters in global entry queue with positions
      const providerAttestersInQueue = cachedAttesters
        ? cachedAttesters.attesters
          .map((attester) => ({
            address: attester.address,
            position: globalQueue.findIndex(
              (addr) => addr.toLowerCase() === attester.address.toLowerCase(),
            ),
            coinbase: attester.coinbase,
          }))
          .filter((item) => item.position !== -1) // Only those actually in entry queue
          .sort((a, b) => a.position - b.position)
        : [];

      providerQueueCount = providerAttestersInQueue.length;

      // Calculate timestamps for provider attesters
      if (providerAttestersInQueue.length > 0 && timePerAttester > 0) {
        // Next attester
        const nextAttester = providerAttestersInQueue[0]!;
        providerNextAttesterArrivalTimestamp =
          currentTimestamp +
          Math.floor(nextAttester.position * timePerAttester);

        // Last attester
        const lastAttester =
          providerAttestersInQueue[providerAttestersInQueue.length - 1]!;
        providerLastAttesterArrivalTimestamp =
          currentTimestamp +
          Math.floor(lastAttester.position * timePerAttester);

        // Find next attester missing coinbase (now using coinbase from cached data)
        const nextMissingCoinbase = providerAttestersInQueue.find(
          (item) => !item.coinbase,
        );

        if (nextMissingCoinbase) {
          providerNextMissingCoinbaseArrivalTimestamp =
            currentTimestamp +
            Math.floor(nextMissingCoinbase.position * timePerAttester);
          providerNextMissingCoinbaseAddress = nextMissingCoinbase.address;
        }
      }
    }
  }

  // Output JSON or human-readable format
  if (options.json) {
    const output = {
      network: options.network,
      providerId: providerId?.toString() || null,
      global: {
        totalQueueLength: Number(totalQueueLength),
        currentEpoch: Number(currentEpoch),
        epochDuration: Number(epochDuration),
        flushSize: Number(flushSize),
        availableFlushes: Number(availableFlushes),
        nextFlushableEpoch: Number(nextFlushableEpoch),
        isBootstrapped,
        timePerAttester,
        lastAttesterTimestamp: lastAttesterEstimatedEntryTimestamp,
      },
      provider: {
        queueCount: providerQueueCount,
        nextArrivalTimestamp: providerNextAttesterArrivalTimestamp,
        nextMissingCoinbase: providerNextMissingCoinbaseArrivalTimestamp
          ? {
            timestamp: providerNextMissingCoinbaseArrivalTimestamp,
            address: providerNextMissingCoinbaseAddress,
          }
          : null,
        lastArrivalTimestamp: providerLastAttesterArrivalTimestamp,
      },
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    // Human-readable output
    console.log("=== Entry Queue Statistics ===\n");
    console.log(`Network: ${options.network}`);
    if (providerId !== null) {
      console.log(`Provider ID: ${providerId}`);
    }
    console.log();

    console.log("📊 Global Queue Status:");
    console.log(`  Total Attesters in Queue: ${totalQueueLength}`);
    console.log(`  Current Epoch: ${currentEpoch}`);
    console.log(`  Epoch Duration: ${formatDuration(Number(epochDuration))}`);
    console.log(`  Flush Size per Epoch: ${flushSize} attesters`);
    console.log(
      `  Time per Attester: ${timePerAttester > 0 ? formatDuration(timePerAttester) : "N/A"}`,
    );
    console.log();

    if (totalQueueLength > 0n) {
      console.log(
        `  ⏰ Last Attester Estimated Entry: ${formatTimestamp(lastAttesterEstimatedEntryTimestamp)}`,
      );
      console.log();
    }

    if (providerId !== null) {
      console.log("🏢 Provider Queue Status:");
      console.log(`  Your Attesters in Queue: ${providerQueueCount}`);
      console.log();

      // Always show timestamps, even if NULL
      console.log(
        `  ⏰ Next Attester Arrival: ${providerNextAttesterArrivalTimestamp !== null ? formatTimestamp(providerNextAttesterArrivalTimestamp) : "NULL (no attesters in queue)"}`,
      );
      console.log();

      if (
        providerNextMissingCoinbaseArrivalTimestamp !== null &&
        providerNextMissingCoinbaseAddress !== null
      ) {
        console.log(
          `  ⚠️  Next Attester Missing Coinbase: ${formatTimestamp(providerNextMissingCoinbaseArrivalTimestamp)}`,
        );
        console.log(
          `      Address: ${providerNextMissingCoinbaseAddress.slice(0, 10)}...${providerNextMissingCoinbaseAddress.slice(-8)}`,
        );
        console.log(
          "      ⚡ Action Required: Configure coinbase before activation",
        );
        console.log();
      } else {
        console.log(
          `  ⚠️  Next Attester Missing Coinbase: NULL (all have coinbase or no attesters in queue)`,
        );
        console.log();
      }

      console.log(
        `  ⏰ Last Attester Arrival: ${providerLastAttesterArrivalTimestamp !== null ? formatTimestamp(providerLastAttesterArrivalTimestamp) : "NULL (no attesters in queue)"}`,
      );
      console.log();

      console.log(
        "💡 Tip: Use 'npm run cli -- scrape-coinbases' to update coinbase configurations",
      );
    } else {
      console.log(
        "⚠️  No staking provider configured (AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS not set)",
      );
    }
  }
};

export default command;
