import type { EthereumClient } from "../../core/components/EthereumClient.js";

interface GetProviderIdOptions {
  adminAddress: string;
}

const command = async (
  ethClient: EthereumClient,
  options: GetProviderIdOptions,
) => {
  console.log("\n=== Query Staking Provider ID ===\n");

  console.log(`Admin Address: ${options.adminAddress}`);
  console.log("\nQuerying staking provider from chain...");

  const providerData = await ethClient.getStakingProvider(options.adminAddress);

  if (!providerData) {
    console.error(
      `\n❌ Staking provider not found for admin address: ${options.adminAddress}`,
    );
    console.error("Please ensure the staking provider is registered on-chain.");
    process.exit(1);
  }

  console.log("\n✅ Staking Provider Found:\n");
  console.log(`  Provider ID: ${providerData.providerId}`);
  console.log(`  Admin: ${providerData.admin}`);
  console.log(
    `  Take Rate: ${providerData.takeRate} (${providerData.takeRate / 100}%)`,
  );
  console.log(`  Rewards Recipient: ${providerData.rewardsRecipient}`);

  console.log("\n💡 You can use this provider ID in other commands:");
  console.log(
    `   npm run cli -- scrape-coinbases --provider-id ${providerData.providerId}`,
  );
  console.log(
    `   npm run cli -- generate-scraper-config --provider-id ${providerData.providerId}`,
  );
};

export default command;
