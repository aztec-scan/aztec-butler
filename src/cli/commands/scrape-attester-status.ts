import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import {
  AttesterOnChainStatus,
  type ScraperAttester,
} from "../../types/index.js";
import {
  loadCachedAttesters,
  saveCachedAttesters,
} from "../../core/utils/cachedAttestersOperations.js";

interface ScrapeAttesterStatusOptions {
  allActive?: boolean;
  allQueued?: boolean;
  active?: boolean;
  queued?: boolean;
  providerQueue?: boolean;
  addresses?: string[];
  network: string;
}

/**
 * Determine the new state for an attester based on on-chain status
 */
function determineNewState(
  attester: ScraperAttester,
  isInQueue: boolean,
  isInProviderQueue: boolean,
  onChainStatus: AttesterOnChainStatus | null,
): string | undefined {
  const hasCoinbase = attester.coinbase != null;

  // Check provider queue FIRST (before entry queue)
  // This is because attesters move from provider queue -> entry queue -> active
  if (isInProviderQueue) {
    return "IN_STAKING_PROVIDER_QUEUE";
  }

  // Attester is in entry queue
  if (isInQueue) {
    return "IN_STAKING_QUEUE";
  }

  // Attester is on-chain
  if (onChainStatus !== null) {
    if (onChainStatus === AttesterOnChainStatus.VALIDATING) {
      return "ACTIVE";
    }

    // ZOMBIE or EXITING
    if (
      onChainStatus === AttesterOnChainStatus.ZOMBIE ||
      onChainStatus === AttesterOnChainStatus.EXITING
    ) {
      if (hasCoinbase) {
        return "NO_LONGER_ACTIVE";
      }
    }
  }

  // Not found on-chain (status NONE or null)
  if (onChainStatus === null || onChainStatus === AttesterOnChainStatus.NONE) {
    // Only update to NO_LONGER_ACTIVE if has coinbase
    if (hasCoinbase) {
      return "NO_LONGER_ACTIVE";
    }
    // For attesters without coinbase, don't change state
    return attester.lastSeenState; // Keep existing state
  }

  return attester.lastSeenState; // Default: keep existing
}

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: ScrapeAttesterStatusOptions,
) => {
  console.log("\n=== Attester On-Chain Status ===\n");

  const statusToString = (status: AttesterOnChainStatus): string => {
    switch (status) {
      case AttesterOnChainStatus.NONE:
        return "NONE";
      case AttesterOnChainStatus.VALIDATING:
        return "VALIDATING";
      case AttesterOnChainStatus.ZOMBIE:
        return "ZOMBIE";
      case AttesterOnChainStatus.EXITING:
        return "EXITING";
      default:
        return "UNKNOWN";
    }
  };

  const formatBalance = (balance: bigint): string => {
    // Assuming 18 decimals like most ERC20 tokens
    const balanceStr = balance.toString();
    const decimals = 18;
    if (balanceStr.length <= decimals) {
      return `0.${"0".repeat(decimals - balanceStr.length)}${balanceStr}`;
    }
    const intPart = balanceStr.slice(0, balanceStr.length - decimals);
    const fracPart = balanceStr.slice(balanceStr.length - decimals);
    return `${intPart}.${fracPart}`;
  };

  const formatTimestamp = (timestamp: bigint): string => {
    if (timestamp === 0n) {
      return "N/A";
    }
    const date = new Date(Number(timestamp) * 1000);
    return date.toISOString();
  };

  const displayAttester = async (
    address: string,
    showConfigInfo: boolean = false,
    configAttester?: ScraperAttester,
  ) => {
    console.log(`\nAttester: ${address}`);
    const view = await ethClient.getAttesterView(address);

    if (!view) {
      console.log("  Status: Not found on-chain (NONE)");
      return null;
    }

    console.log(`  Status: ${statusToString(view.status)}`);
    console.log(`  Balance: ${formatBalance(view.effectiveBalance)}`);
    console.log(`  Withdrawer: ${view.config.withdrawer}`);

    if (showConfigInfo && configAttester) {
      console.log(`  Cached Coinbase: ${configAttester.coinbase || "Not set"}`);
    }

    if (view.exit.exists) {
      console.log(`  Exit Info:`);
      console.log(`    Withdrawal ID: ${view.exit.withdrawalId}`);
      console.log(`    Amount: ${formatBalance(view.exit.amount)}`);
      console.log(`    Exitable At: ${formatTimestamp(view.exit.exitableAt)}`);
      console.log(
        `    Recipient/Withdrawer: ${view.exit.recipientOrWithdrawer}`,
      );
      console.log(`    Is Recipient: ${view.exit.isRecipient}`);
    }

    return view;
  };

  // Load cached attesters (if exists) - will be used/updated if available
  let cachedAttesters: ScraperAttester[] = [];
  let cacheExists = false;
  try {
    const cache = await loadCachedAttesters(options.network);
    cachedAttesters = cache.attesters;
    cacheExists = true;
  } catch (error) {
    // Cache doesn't exist yet, which is okay
    cacheExists = false;
  }

  // --all-active: Show all active attesters from on-chain and update cache
  if (options.allActive) {
    console.log("Fetching all active attesters from on-chain...\n");
    const activeAttesters = await ethClient.getAllActiveAttesters();
    console.log(`Active Attesters (${activeAttesters.length} total):`);

    if (activeAttesters.length === 0) {
      console.log("  No active attesters found\n");
    } else {
      for (const attester of activeAttesters) {
        await displayAttester(attester, false);
      }
      console.log();
    }

    // Update cache with all active attesters
    if (activeAttesters.length > 0) {
      console.log("Updating attester cache...");
      const updatedAttesters = activeAttesters.map(
        (address): ScraperAttester => {
          const existing = cachedAttesters.find(
            (a) => a.address.toLowerCase() === address.toLowerCase(),
          );
          return existing || { address, lastSeenState: "ACTIVE" };
        },
      );

      const savedPath = await saveCachedAttesters(
        options.network,
        updatedAttesters,
      );
      console.log(`✅ Attester cache updated: ${savedPath}\n`);
    }

    return;
  }

  // --all-queued: Show all queued attesters from on-chain
  if (options.allQueued) {
    console.log("Fetching all queued attesters from on-chain...\n");
    const queuedAttesters = await ethClient.getAllQueuedAttesters();
    console.log(`Queued Attesters (${queuedAttesters.length} total):`);

    if (queuedAttesters.length === 0) {
      console.log("  No queued attesters found\n");
    } else {
      queuedAttesters.forEach((attester, index) => {
        console.log(`  [${index}] ${attester}`);
      });
      console.log();
    }

    return;
  }

  // --address: Show specific attester(s) by address
  if (options.addresses && options.addresses.length > 0) {
    console.log("Fetching specific attester status...\n");

    for (const address of options.addresses) {
      await displayAttester(address, false);
    }

    console.log();
    return;
  }

  // Default behavior: automatically update cache if it exists, or show help if it doesn't
  if (!cacheExists) {
    console.log(
      "No cached attesters found. This is normal if you haven't run this command before.",
    );
    console.log("\nTo populate the cache, use one of the following options:");
    console.log("  --all-active    : Scrape all active attesters on-chain");
    console.log("  --all-queued    : Scrape all queued attesters on-chain");
    console.log(
      "  --address <addr>: Scrape specific attester(s) (can specify multiple times)",
    );
    console.log("\nExamples:");
    console.log("  aztec-butler scrape-attester-status --all-active");
    console.log("  aztec-butler scrape-attester-status --all-queued");
    console.log(
      "  aztec-butler scrape-attester-status --address 0x123... --address 0x456...",
    );
    return;
  }

  // Cache exists - automatically update it with current states
  console.log("Loading cached attesters...");
  console.log(`✅ Loaded ${cachedAttesters.length} attesters from cache\n`);

  if (cachedAttesters.length === 0) {
    console.log("No attesters found in cache.\n");
    return;
  }

  console.log("Fetching on-chain data...");
  const onChainActive = await ethClient.getAllActiveAttesters();
  const onChainQueued = await ethClient.getAllQueuedAttesters();

  // Fetch provider queue if provider ID is available
  let onChainProviderQueue: string[] = [];
  if (config.AZTEC_STAKING_PROVIDER_ID) {
    const queueLength = await ethClient.getProviderQueueLength(
      config.AZTEC_STAKING_PROVIDER_ID,
    );
    if (queueLength > 0n) {
      onChainProviderQueue = await ethClient.getProviderQueue(
        config.AZTEC_STAKING_PROVIDER_ID,
      );
    }
  }

  console.log(`✅ Found ${onChainActive.length} active attesters on-chain`);
  console.log(`✅ Found ${onChainQueued.length} queued attesters on-chain`);
  console.log(
    `✅ Found ${onChainProviderQueue.length} attesters in provider queue\n`,
  );

  // Create lookup maps for fast checking
  const activeAddressSet = new Set(onChainActive.map((a) => a.toLowerCase()));
  const queuedAddressSet = new Set(onChainQueued.map((a) => a.toLowerCase()));
  const providerQueueSet = new Set(
    onChainProviderQueue.map((a) => a.toLowerCase()),
  );

  // Create map of on-chain views
  const onChainViews = new Map<string, AttesterOnChainStatus>();
  for (const activeAddress of onChainActive) {
    const view = await ethClient.getAttesterView(activeAddress);
    if (view) {
      onChainViews.set(activeAddress.toLowerCase(), view.status);
    }
  }

  console.log("Analyzing attester states...\n");

  interface StateChange {
    address: string;
    oldState: string | undefined;
    newState: string | undefined;
  }

  const changes: StateChange[] = [];
  const stateBreakdown = new Map<string, number>();

  // Iterate through all attesters in cache
  for (const attester of cachedAttesters) {
    const addressLower = attester.address.toLowerCase();
    const isInQueue = queuedAddressSet.has(addressLower);
    const isInProviderQueue = providerQueueSet.has(addressLower);
    const onChainStatus = onChainViews.get(addressLower) ?? null;

    const newState = determineNewState(
      attester,
      isInQueue,
      isInProviderQueue,
      onChainStatus,
    );

    if (newState !== attester.lastSeenState) {
      changes.push({
        address: attester.address,
        oldState: attester.lastSeenState,
        newState,
      });
      attester.lastSeenState = newState as any;
    }

    // Track state breakdown
    const currentState = attester.lastSeenState || "NEW";
    stateBreakdown.set(
      currentState,
      (stateBreakdown.get(currentState) || 0) + 1,
    );
  }

  // Display state changes
  if (changes.length > 0) {
    console.log("State Changes:");
    for (const change of changes) {
      console.log(
        `  ${change.address}: ${change.oldState || "undefined"} → ${change.newState || "undefined"}`,
      );
    }
    console.log();
  }

  // Display summary
  console.log("Summary:");
  console.log(`  Total attesters: ${cachedAttesters.length}`);
  console.log(`  State changes: ${changes.length}`);
  console.log(`  No changes: ${cachedAttesters.length - changes.length}\n`);

  console.log("State breakdown:");
  for (const [state, count] of Array.from(stateBreakdown.entries()).sort()) {
    console.log(`  ${state}: ${count}`);
  }
  console.log();

  // Save updated cache (always save, even if no changes - updates timestamp)
  const savedPath = await saveCachedAttesters(options.network, cachedAttesters);
  console.log(`✅ Attester cache updated: ${savedPath}\n`);

  // Determine which attesters to show based on flags
  const anyFlagProvided =
    options.active === true ||
    options.queued === true ||
    options.providerQueue === true;

  const shouldShowActive = anyFlagProvided ? options.active === true : true;
  const shouldShowQueued = anyFlagProvided ? options.queued === true : true;
  const shouldShowProviderQueue = anyFlagProvided
    ? options.providerQueue === true
    : true;

  // Display filtered results
  if (shouldShowActive || shouldShowQueued || shouldShowProviderQueue) {
    console.log("Fetching detailed attester information...\n");

    const cachedAddressSet = new Set(
      cachedAttesters.map((a) => a.address.toLowerCase()),
    );

    // Active attesters
    if (shouldShowActive) {
      const activeAttestersData: Array<{
        address: string;
        config: ScraperAttester;
      }> = [];

      for (const activeAddress of onChainActive) {
        if (cachedAddressSet.has(activeAddress.toLowerCase())) {
          const cachedAttester = cachedAttesters.find(
            (a) => a.address.toLowerCase() === activeAddress.toLowerCase(),
          )!;
          activeAttestersData.push({
            address: activeAddress,
            config: cachedAttester,
          });
        }
      }

      if (activeAttestersData.length > 0) {
        console.log(
          `Active Attesters from Cache (${activeAttestersData.length} total):`,
        );
        for (const attesterData of activeAttestersData) {
          await displayAttester(
            attesterData.address,
            true,
            attesterData.config,
          );
        }
        console.log();
      } else {
        console.log("No active attesters found in cache.\n");
      }
    }

    // Queued attesters
    if (shouldShowQueued) {
      const queuedAttestersData: Array<{
        address: string;
        config: ScraperAttester;
      }> = [];

      for (const queuedAddress of onChainQueued) {
        if (cachedAddressSet.has(queuedAddress.toLowerCase())) {
          const cachedAttester = cachedAttesters.find(
            (a) => a.address.toLowerCase() === queuedAddress.toLowerCase(),
          )!;
          queuedAttestersData.push({
            address: queuedAddress,
            config: cachedAttester,
          });
        }
      }

      if (queuedAttestersData.length > 0) {
        console.log(
          `Queued Attesters from Cache (${queuedAttestersData.length} total):`,
        );
        queuedAttestersData.forEach((attesterData, index) => {
          console.log(`  [${index}] ${attesterData.address}`);
          console.log(
            `    Cached Coinbase: ${attesterData.config.coinbase || "Not set"}`,
          );
        });
        console.log();
      } else {
        console.log("No queued attesters found in cache.\n");
      }
    }

    // Provider queue attesters
    if (shouldShowProviderQueue) {
      if (!config.AZTEC_STAKING_PROVIDER_ID) {
        console.error(
          "❌ Error: AZTEC_STAKING_PROVIDER_ID is not set in config.",
        );
        console.error(
          "   The --provider-queue flag requires AZTEC_STAKING_PROVIDER_ID in your base.env file.\n",
        );
        return;
      }

      const providerQueueAttestersData: Array<{
        address: string;
        config: ScraperAttester;
      }> = [];

      for (const providerQueueAddress of onChainProviderQueue) {
        if (cachedAddressSet.has(providerQueueAddress.toLowerCase())) {
          const cachedAttester = cachedAttesters.find(
            (a) =>
              a.address.toLowerCase() === providerQueueAddress.toLowerCase(),
          )!;
          providerQueueAttestersData.push({
            address: providerQueueAddress,
            config: cachedAttester,
          });
        }
      }

      if (providerQueueAttestersData.length > 0) {
        console.log(
          `Provider Queue Attesters from Cache (${providerQueueAttestersData.length} total):`,
        );
        providerQueueAttestersData.forEach((attesterData, index) => {
          console.log(`  [${index}] ${attesterData.address}`);
          console.log(
            `    Cached Coinbase: ${attesterData.config.coinbase || "Not set"}`,
          );
          console.log(
            `    Last Seen State: ${attesterData.config.lastSeenState || "Not set"}`,
          );
        });
        console.log();
      } else {
        console.log("No provider queue attesters found in cache.\n");
      }
    }
  }
};

export default command;
