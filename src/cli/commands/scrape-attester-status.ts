import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { AttesterOnChainStatus } from "../../types/index.js";
import { loadAttestersForCLI } from "../utils/loadAttesters.js";

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
  hasCoinbase: boolean,
  isInQueue: boolean,
  isInProviderQueue: boolean,
  onChainStatus: AttesterOnChainStatus | null,
  existingState?: string,
): string | undefined {
  // Check provider queue FIRST (before entry queue)
  // This is because attesters move from provider queue -> entry queue -> active
  if (isInProviderQueue) {
    return "IN_STAKING_PROVIDER_QUEUE";
  }

  // Attester is in entry queue
  if (isInQueue) {
    return "ROLLUP_ENTRY_QUEUE";
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
    return existingState; // Keep existing state
  }

  return existingState; // Default: keep existing
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

  const displayAttester = async (address: string, coinbase?: string) => {
    console.log(`\nAttester: ${address}`);
    const view = await ethClient.getAttesterView(address);

    if (!view) {
      console.log("  Status: Not found on-chain (NONE)");
      return null;
    }

    console.log(`  Status: ${statusToString(view.status)}`);
    console.log(`  Balance: ${formatBalance(view.effectiveBalance)}`);
    console.log(`  Withdrawer: ${view.config.withdrawer}`);

    if (coinbase) {
      console.log(`  Coinbase: ${coinbase}`);
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
        await displayAttester(attester);
      }
      console.log();
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
      await displayAttester(address);
    }

    console.log();
    return;
  }

  // Default behavior: Load from keys files and show status
  console.log("Loading attesters from keys files...");
  const { addresses, attestersWithCoinbase, filesLoaded } =
    await loadAttestersForCLI(options.network);

  console.log(
    `✅ Loaded ${addresses.length} attester(s) from ${filesLoaded.length} file(s)\n`,
  );

  if (addresses.length === 0) {
    console.log("No attesters found in keys files.\n");
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

  // Create coinbase map
  const coinbaseMap = new Map<string, string>();
  for (const attester of attestersWithCoinbase) {
    coinbaseMap.set(attester.address.toLowerCase(), attester.coinbase);
  }

  // Create map of on-chain views
  const onChainViews = new Map<string, AttesterOnChainStatus>();
  for (const activeAddress of onChainActive) {
    const view = await ethClient.getAttesterView(activeAddress);
    if (view) {
      onChainViews.set(activeAddress.toLowerCase(), view.status);
    }
  }

  console.log("Analyzing attester states...\n");

  const stateBreakdown = new Map<string, number>();

  // Iterate through all attesters
  for (const address of addresses) {
    const addressLower = address.toLowerCase();
    const isInQueue = queuedAddressSet.has(addressLower);
    const isInProviderQueue = providerQueueSet.has(addressLower);
    const onChainStatus = onChainViews.get(addressLower) ?? null;
    const hasCoinbase = coinbaseMap.has(addressLower);

    const state = determineNewState(
      hasCoinbase,
      isInQueue,
      isInProviderQueue,
      onChainStatus,
    );

    // Track state breakdown
    const currentState = state || "NEW";
    stateBreakdown.set(
      currentState,
      (stateBreakdown.get(currentState) || 0) + 1,
    );
  }

  // Display summary
  console.log("Summary:");
  console.log(`  Total attesters: ${addresses.length}\n`);

  console.log("State breakdown:");
  for (const [state, count] of Array.from(stateBreakdown.entries()).sort()) {
    console.log(`  ${state}: ${count}`);
  }
  console.log();

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

    const attesterAddressSet = new Set(addresses.map((a) => a.toLowerCase()));

    // Active attesters
    if (shouldShowActive) {
      const activeAttestersData = onChainActive.filter((addr) =>
        attesterAddressSet.has(addr.toLowerCase()),
      );

      if (activeAttestersData.length > 0) {
        console.log(
          `Active Attesters from Keys Files (${activeAttestersData.length} total):`,
        );
        for (const address of activeAttestersData) {
          await displayAttester(
            address,
            coinbaseMap.get(address.toLowerCase()),
          );
        }
        console.log();
      } else {
        console.log("No active attesters found in keys files.\n");
      }
    }

    // Queued attesters
    if (shouldShowQueued) {
      const queuedAttestersData = onChainQueued.filter((addr) =>
        attesterAddressSet.has(addr.toLowerCase()),
      );

      if (queuedAttestersData.length > 0) {
        console.log(
          `Queued Attesters from Keys Files (${queuedAttestersData.length} total):`,
        );
        queuedAttestersData.forEach((address, index) => {
          console.log(`  [${index}] ${address}`);
          const coinbase = coinbaseMap.get(address.toLowerCase());
          console.log(`    Coinbase: ${coinbase || "Not set"}`);
        });
        console.log();
      } else {
        console.log("No queued attesters found in keys files.\n");
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

      const providerQueueAttestersData = onChainProviderQueue.filter((addr) =>
        attesterAddressSet.has(addr.toLowerCase()),
      );

      if (providerQueueAttestersData.length > 0) {
        console.log(
          `Provider Queue Attesters from Keys Files (${providerQueueAttestersData.length} total):`,
        );
        providerQueueAttestersData.forEach((address, index) => {
          console.log(`  [${index}] ${address}`);
          const coinbase = coinbaseMap.get(address.toLowerCase());
          console.log(`    Coinbase: ${coinbase || "Not set"}`);
        });
        console.log();
      } else {
        console.log("No provider queue attesters found in keys files.\n");
      }
    }
  }
};

export default command;
