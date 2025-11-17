import assert from "assert";
import { encodeFunctionData, getAddress } from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import { DirData, MOCK_REGISTRY_ABI } from "../../types.js";
import { ButlerConfig } from "../../core/config/index.js";

const DEFAULT_COMISSION_RATE_PERCENTAGE = 10;

const command = async (
  ethClient: EthereumClient,
  dirData: DirData,
  providerAdmin: ButlerConfig["PROVIDER_ADMIN_ADDRESS"],
) => {
  assert(providerAdmin, "Provider admin address must be provided.");
  const stakingRegistryAddress = ethClient.getStakingRegistryAddress();
  const providerAdminAddress = getAddress(providerAdmin);
  const rewardsRecipientAddress = providerAdminAddress; // For simplicity, using the same address
  const comissionBasisPoints = DEFAULT_COMISSION_RATE_PERCENTAGE * 100; // Convert percentage to basis points
  const callData = {
    contractToCall: stakingRegistryAddress,
    callData: encodeFunctionData({
      abi: MOCK_REGISTRY_ABI,
      functionName: "registerProvider",
      args: [
        providerAdminAddress,
        comissionBasisPoints,
        rewardsRecipientAddress,
      ],
    }),
  };
  const providerId = await ethClient.getProviderId(providerAdminAddress);
  if (providerId >= 0n) {
    console.log("Provider already registered on-chain.");
  } else {
    console.log(
      "REGISTER PROVIDER CALL DATA:",
      JSON.stringify(callData, null, 2),
    );
  }
};

export default command;
