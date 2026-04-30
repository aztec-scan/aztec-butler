import assert from "assert";
import { encodeFunctionData, getAddress } from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { STAKING_REGISTRY_ABI } from "../../types/index.js";

interface GetProviderAdminCalldataOptions {
  newProviderAdminAddress: string;
  oldProviderAdminAddress?: string;
  providerId?: bigint;
}

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: GetProviderAdminCalldataOptions,
) => {
  assert(
    options.oldProviderAdminAddress ||
      config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
    "AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS must be configured or --old-provider-admin-address must be provided.",
  );
  assert(
    options.providerId !== undefined ||
      config.AZTEC_STAKING_PROVIDER_ID !== undefined,
    "AZTEC_STAKING_PROVIDER_ID must be configured or --provider-id must be provided.",
  );

  const oldProviderAdminAddress =
    options.oldProviderAdminAddress ??
    config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS;
  const providerId = options.providerId ?? config.AZTEC_STAKING_PROVIDER_ID;
  assert(oldProviderAdminAddress);
  assert(providerId !== undefined);

  const stakingRegistryAddress = ethClient.getStakingRegistryAddress("native");
  const currentProviderAdminAddress = getAddress(oldProviderAdminAddress);
  const newProviderAdminAddress = getAddress(options.newProviderAdminAddress);

  console.log("\n=== Provider Admin Calldata ===\n");
  console.log("Arguments:");
  console.log(`  --new-provider-admin-address: ${newProviderAdminAddress}`);
  console.log(`  --old-provider-admin-address: ${currentProviderAdminAddress}`);
  console.log(`  --provider-id: ${providerId}`);
  console.log("");
  console.log("Registry target: native");
  console.log(`Registry address: ${stakingRegistryAddress}`);
  console.log(`Provider ID: ${providerId}`);
  console.log(`Current provider admin: ${currentProviderAdminAddress}`);
  console.log(`New provider admin: ${newProviderAdminAddress}`);

  const updateProviderAdminCallData = {
    contractToCall: stakingRegistryAddress,
    callData: encodeFunctionData({
      abi: STAKING_REGISTRY_ABI,
      functionName: "updateProviderAdmin",
      args: [providerId, newProviderAdminAddress],
    }),
  };

  const acceptProviderAdminCallData = {
    contractToCall: stakingRegistryAddress,
    callData: encodeFunctionData({
      abi: STAKING_REGISTRY_ABI,
      functionName: "acceptProviderAdmin",
      args: [providerId],
    }),
  };

  console.log("\nUPDATE PROVIDER ADMIN CALL DATA:");
  console.log(JSON.stringify(updateProviderAdminCallData, null, 2));
  console.log("\nACCEPT PROVIDER ADMIN CALL DATA:");
  console.log(JSON.stringify(acceptProviderAdminCallData, null, 2));
};

export default command;
