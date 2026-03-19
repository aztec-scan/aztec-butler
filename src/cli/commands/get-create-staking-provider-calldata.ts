import assert from "assert";
import { encodeFunctionData, getAddress } from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import {
  STAKING_REGISTRY_ABI,
  type StakingRegistryTarget,
} from "../../types/index.js";
import { ButlerConfig } from "../../core/config/index.js";

const DEFAULT_COMISSION_RATE_PERCENTAGE = 10;

interface GetCreateStakingProviderCalldataOptions {
  registry: StakingRegistryTarget;
}

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: GetCreateStakingProviderCalldataOptions,
) => {
  const selectedAdminAddress =
    options.registry === "olla"
      ? config.OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS
      : config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS;
  assert(
    selectedAdminAddress,
    `Staking provider admin address must be provided for '${options.registry}' registry.`,
  );
  const stakingRegistryAddress = ethClient.getStakingRegistryAddress(
    options.registry,
  );
  console.log(`Registry target: ${options.registry}`);
  console.log(`Registry address: ${stakingRegistryAddress}`);
  const stakingProviderAdminAddress = getAddress(selectedAdminAddress);

  if (options.registry === "olla") {
    console.log(
      "Olla staking provider is configured during deployment/initialization; registerProvider calldata is not applicable.",
    );
    const providerData = await ethClient.getStakingProvider(
      stakingProviderAdminAddress,
      options.registry,
    );
    if (providerData) {
      console.log("Current Olla provider configuration:");
      console.log(
        `${providerData.providerId} - Admin: ${providerData.admin}, Rewards Recipient: ${providerData.rewardsRecipient}`,
      );
    } else {
      console.log(
        "Configured admin does not match on-chain Olla provider config. Check OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS.",
      );
    }
    return;
  }

  const rewardsRecipientAddress = stakingProviderAdminAddress; // For simplicity, using the same address
  const comissionBasisPoints = DEFAULT_COMISSION_RATE_PERCENTAGE * 100; // Convert percentage to basis points
  const callData = {
    contractToCall: stakingRegistryAddress,
    callData: encodeFunctionData({
      abi: STAKING_REGISTRY_ABI,
      functionName: "registerProvider",
      args: [
        stakingProviderAdminAddress,
        comissionBasisPoints,
        rewardsRecipientAddress,
      ],
    }),
  };
  const stakingProviderData = await ethClient.getStakingProvider(
    stakingProviderAdminAddress,
    options.registry,
  );
  if (stakingProviderData) {
    console.log("Staking provider already registered on-chain.");
    console.log(
      `${stakingProviderData.providerId} - Admin: ${stakingProviderData.admin}, Take Rate: ${stakingProviderData.takeRate}, Rewards Recipient: ${stakingProviderData.rewardsRecipient}`,
    );
  } else {
    console.log(
      "REGISTER STAKING PROVIDER CALL DATA:",
      JSON.stringify(callData, null, 2),
    );
  }
};

export default command;
