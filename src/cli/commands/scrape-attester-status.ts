import type { EthereumClient } from "../../core/components/EthereumClient.js";
import { AttesterOnChainStatus } from "../../types/index.js";
import { loadScraperConfig } from "../../core/utils/scraperConfigOperations.js";

interface ScrapeAttesterStatusOptions {
  allActive?: boolean;
  allQueued?: boolean;
  active?: boolean;
  queued?: boolean;
  addresses?: string[];
  network: string;
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
    configAttester?: { coinbase: string; publisher: string },
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
      console.log(`  Config Coinbase: ${configAttester.coinbase}`);
      console.log(`  Config Publisher: ${configAttester.publisher}`);
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
      // If both flags are explicitly set, show all
      // If only one flag is set, show only that category
      const shouldShowActive =
        options.active !== undefined ? options.active : !options.queued;
      const shouldShowQueued =
        options.queued !== undefined ? options.queued : !options.active;

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
            console.log(`    Config Coinbase: ${attesterData.config.coinbase}`);
            console.log(
              `    Config Publisher: ${attesterData.config.publisher}`,
            );
          });
          console.log();
        } else {
          console.log("No queued attesters found in scraper config.\n");
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
        console.log("  npm run cli -- scrape-attester-status --all-active");
        console.log("  npm run cli -- scrape-attester-status --all-queued");
        console.log(
          "  npm run cli -- scrape-attester-status --address 0x123... --address 0x456...",
        );
        console.log(
          "  npm run cli -- scrape-attester-status --all-active --all-queued",
        );
      } else {
        throw error;
      }
    }
  }
};

export default command;
