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
      console.log(`  Config Coinbase: ${configAttester.coinbase || "Not set"}`);
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

  // --all-active: Show all active attesters from on-chain
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
  }

  // --address: Show specific attester(s) by address
  if (options.addresses && options.addresses.length > 0) {
    console.log("Fetching specific attester status...\n");

    for (const address of options.addresses) {
      await displayAttester(address, false);
    }

    console.log();
  }

  // --update-config: Update scraper config with current states
  if (options.updateConfig) {
    console.log("Loading scraper config...");
    const scraperConfig = await loadScraperConfig(options.network);
    console.log(
      `✅ Loaded ${scraperConfig.attesters.length} attesters from config\n`,
    );

    console.log("Fetching on-chain data...");
    const onChainActive = await ethClient.getAllActiveAttesters();
    const onChainQueued = await ethClient.getAllQueuedAttesters();

    // Fetch provider queue
    const stakingProviderData = await ethClient.getStakingProvider(
      scraperConfig.stakingProviderAdmin,
    );
    let onChainProviderQueue: string[] = [];
    if (stakingProviderData) {
      const queueLength = await ethClient.getProviderQueueLength(
        stakingProviderData.providerId,
      );
      if (queueLength > 0n) {
        onChainProviderQueue = await ethClient.getProviderQueue(
          stakingProviderData.providerId,
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

    // Iterate through all attesters in config
    for (const attester of scraperConfig.attesters) {
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
    console.log(`  Total attesters: ${scraperConfig.attesters.length}`);
    console.log(`  State changes: ${changes.length}`);
    console.log(
      `  No changes: ${scraperConfig.attesters.length - changes.length}\n`,
    );

    console.log("State breakdown:");
    for (const [state, count] of Array.from(stateBreakdown.entries()).sort()) {
      console.log(`  ${state}: ${count}`);
    }
    console.log();

    // Update lastUpdated timestamp
    scraperConfig.lastUpdated = new Date().toISOString();

    // Save updated config
    const savedPath = await saveScraperConfig(scraperConfig);
    console.log(`✅ Config updated: ${savedPath}\n`);

    return;
  }

  // Default behavior or --active/--queued flags: show attesters from scraper config
  if (
    !options.allActive &&
    !options.allQueued &&
    (!options.addresses || options.addresses.length === 0)
  ) {
    try {
      const scraperConfig = await loadScraperConfig(options.network);

      if (scraperConfig.attesters.length === 0) {
        console.log("No attesters found in scraper config.\n");
        return;
      }

      // Determine which attesters to show based on flags
      // If no flags are provided, show all categories (default)
      // If one or more flags are provided, show only those categories
      const anyFlagProvided =
        options.active === true ||
        options.queued === true ||
        options.providerQueue === true;

      const shouldShowActive = anyFlagProvided ? options.active === true : true;
      const shouldShowQueued = anyFlagProvided ? options.queued === true : true;
      const shouldShowProviderQueue = anyFlagProvided
        ? options.providerQueue === true
        : true;

      console.log("Fetching attesters from scraper config...\n");

      // Create a set of config attester addresses for fast lookup
      const configAddressSet = new Set(
        scraperConfig.attesters.map((a) => a.address.toLowerCase()),
      );

      // Fetch and filter active attesters if needed
      let activeAttestersData: Array<{
        address: string;
        view: Awaited<ReturnType<typeof ethClient.getAttesterView>>;
        config: (typeof scraperConfig.attesters)[0];
      }> = [];

      if (shouldShowActive) {
        console.log("Checking which config attesters are active on-chain...\n");
        const onChainActive = await ethClient.getAllActiveAttesters();

        // Find config attesters that are in the active list
        for (const activeAddress of onChainActive) {
          if (configAddressSet.has(activeAddress.toLowerCase())) {
            const configAttester = scraperConfig.attesters.find(
              (a) => a.address.toLowerCase() === activeAddress.toLowerCase(),
            )!;
            const view = await ethClient.getAttesterView(activeAddress);
            if (view) {
              activeAttestersData.push({
                address: activeAddress,
                view,
                config: configAttester,
              });
            }
          }
        }
      }

      // Fetch and filter queued attesters if needed
      let queuedAttestersData: Array<{
        address: string;
        config: (typeof scraperConfig.attesters)[0];
      }> = [];

      if (shouldShowQueued) {
        console.log("Checking which config attesters are queued on-chain...\n");
        const onChainQueued = await ethClient.getAllQueuedAttesters();

        // Find config attesters that are in the queue
        for (const queuedAddress of onChainQueued) {
          if (configAddressSet.has(queuedAddress.toLowerCase())) {
            const configAttester = scraperConfig.attesters.find(
              (a) => a.address.toLowerCase() === queuedAddress.toLowerCase(),
            )!;
            queuedAttestersData.push({
              address: queuedAddress,
              config: configAttester,
            });
          }
        }
      }

      // Fetch and filter provider queue attesters if needed
      let providerQueueAttestersData: Array<{
        address: string;
        config: (typeof scraperConfig.attesters)[0];
      }> = [];

      if (shouldShowProviderQueue) {
        console.log(
          "Checking which config attesters are in provider queue...\n",
        );

        // Check if stakingProviderAdmin is set
        if (!scraperConfig.stakingProviderAdmin) {
          console.error(
            "❌ Error: stakingProviderAdmin is not set in scraper config.",
          );
          console.error(
            "   The --provider-queue flag requires a valid stakingProviderAdmin.\n",
          );
          return;
        }

        // Get staking provider data
        const stakingProviderData = await ethClient.getStakingProvider(
          scraperConfig.stakingProviderAdmin,
        );

        if (!stakingProviderData) {
          console.error(
            `❌ Error: No staking provider found for admin address ${scraperConfig.stakingProviderAdmin}`,
          );
          console.error(
            "   Please ensure the staking provider is registered on-chain.\n",
          );
          return;
        }

        const queueLength = await ethClient.getProviderQueueLength(
          stakingProviderData.providerId,
        );

        if (queueLength > 0n) {
          const providerQueue = await ethClient.getProviderQueue(
            stakingProviderData.providerId,
          );

          // Find config attesters that are in the provider queue
          for (const providerQueueAddress of providerQueue) {
            if (configAddressSet.has(providerQueueAddress.toLowerCase())) {
              const configAttester = scraperConfig.attesters.find(
                (a) =>
                  a.address.toLowerCase() ===
                  providerQueueAddress.toLowerCase(),
              )!;
              providerQueueAttestersData.push({
                address: providerQueueAddress,
                config: configAttester,
              });
            }
          }
        }
      }

      // Display active attesters if requested
      if (shouldShowActive) {
        if (activeAttestersData.length > 0) {
          console.log(
            `Active Attesters from Config (${activeAttestersData.length} total):`,
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
          console.log("No active attesters found in scraper config.\n");
        }
      }

      // Display queued attesters if requested
      if (shouldShowQueued) {
        if (queuedAttestersData.length > 0) {
          console.log(
            `Queued Attesters from Config (${queuedAttestersData.length} total):`,
          );
          queuedAttestersData.forEach((attesterData, index) => {
            console.log(`  [${index}] ${attesterData.address}`);
            console.log(
              `    Config Coinbase: ${attesterData.config.coinbase || "Not set"}`,
            );
          });
          console.log();
        } else {
          console.log("No queued attesters found in scraper config.\n");
        }
      }

      // Display provider queue attesters if requested
      if (shouldShowProviderQueue) {
        if (providerQueueAttestersData.length > 0) {
          console.log(
            `Provider Queue Attesters from Config (${providerQueueAttestersData.length} total):`,
          );
          providerQueueAttestersData.forEach((attesterData, index) => {
            console.log(`  [${index}] ${attesterData.address}`);
            console.log(
              `    Config Coinbase: ${attesterData.config.coinbase || "Not set"}`,
            );
            console.log(
              `    Last Seen State: ${attesterData.config.lastSeenState || "Not set"}`,
            );
          });
          console.log();
        } else {
          console.log("No provider queue attesters found in scraper config.\n");
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        console.log(
          "No scraper config found. Please specify one of the following options:",
        );
        console.log("  --all-active    : Scrape all active attesters on-chain");
        console.log("  --all-queued    : Scrape all queued attesters on-chain");
        console.log(
          "  --address <addr>: Scrape specific attester(s) (can specify multiple times)",
        );
        console.log("\nOr generate a scraper config first:");
        console.log(
          `  npm run cli -- generate-scraper-config --network ${options.network}`,
        );
        console.log("\nExamples:");
        console.log("  npm run cli -- scrape-attester-status");
        console.log("  npm run cli -- scrape-attester-status --active");
        console.log("  npm run cli -- scrape-attester-status --queued");
        console.log("  npm run cli -- scrape-attester-status --provider-queue");
        console.log("  npm run cli -- scrape-attester-status --all-active");
        console.log("  npm run cli -- scrape-attester-status --all-queued");
        console.log(
          "  npm run cli -- scrape-attester-status --address 0x123... --address 0x456...",
        );
        console.log(
          "  npm run cli -- scrape-attester-status --all-active --all-queued",
        );
        console.log("  npm run cli -- scrape-attester-status --update-config");
      } else {
        throw error;
      }
    }
  }
};

export default command;
