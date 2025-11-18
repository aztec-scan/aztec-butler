import assert from "assert";
import { encodeFunctionData, getAddress } from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import { DirData, MOCK_REGISTRY_ABI } from "../../types.js";
import { ButlerConfig } from "../../core/config/index.js";

const DEFAULT_COMISSION_RATE_PERCENTAGE = 10;

const command = async (
  ethClient: EthereumClient,
  dirData: DirData,
  stakingProviderAdmin: ButlerConfig["PROVIDER_ADMIN_ADDRESS"],
) => {
  assert(
    stakingProviderAdmin,
    "Staking provider admin address must be provided.",
  );
  const stakingRegistryAddress = ethClient.getStakingRegistryAddress();
  const stakingProviderAdminAddress = getAddress(stakingProviderAdmin);
  const rewardsRecipientAddress = stakingProviderAdminAddress; // For simplicity, using the same address
  const comissionBasisPoints = DEFAULT_COMISSION_RATE_PERCENTAGE * 100; // Convert percentage to basis points
  const callData = {
    contractToCall: stakingRegistryAddress,
    callData: encodeFunctionData({
      abi: MOCK_REGISTRY_ABI,
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
