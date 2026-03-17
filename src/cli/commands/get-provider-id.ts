import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { StakingRegistryTarget } from "../../types/index.js";

interface GetProviderIdOptions {
  adminAddress: string;
  registry: StakingRegistryTarget;
}

const command = async (
  ethClient: EthereumClient,
  options: GetProviderIdOptions,
) => {
  console.log("\n=== Query Staking Provider ID ===\n");
  const registryAddress = ethClient.getStakingRegistryAddress(options.registry);

  console.log(`Registry Target: ${options.registry}`);
  console.log(`Registry Address: ${registryAddress}`);
  console.log(`Admin Address: ${options.adminAddress}`);
  console.log("\nQuerying staking provider from chain...");

  const providerData = await ethClient.getStakingProvider(
    options.adminAddress,
    options.registry,
  );

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
};

export default command;
