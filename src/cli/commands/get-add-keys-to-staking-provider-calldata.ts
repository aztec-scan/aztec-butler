import assert from "assert";
import { encodeFunctionData, getAddress } from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import { DirData, STAKING_REGISTRY_ABI } from "../../types/index.js";
import { ButlerConfig } from "../../core/config/index.js";

const command = async (
  ethClient: EthereumClient,
  dirData: DirData,
  stakingProviderAdminAddress: ButlerConfig["PROVIDER_ADMIN_ADDRESS"],
) => {
  assert(
    stakingProviderAdminAddress,
    "Staking provider admin address must be provided.",
  );
  const stakingProviderData = await ethClient.getStakingProvider(
    stakingProviderAdminAddress,
  );

  if (!stakingProviderData) {
    console.error(
      "Staking provider not registered. Please register the staking provider first.",
    );
    return;
  }

  // Log staking provider information
  console.log(
    `${stakingProviderData.providerId} - Admin: ${stakingProviderData.admin}, Take Rate: ${stakingProviderData.takeRate}, Rewards Recipient: ${stakingProviderData.rewardsRecipient}`,
  );
  console.log(`Staking Provider ID: ${stakingProviderData.providerId}`);

  // TODO: check which attesters are already added to rollup
  // TODO: check which attesters are in rollup queue
  // TODO: check attesters in stakingReg queue

  if (dirData.attesterRegistrations.length === 0) {
    console.log("No attester registration files found.");
    return;
  }

  // Process each registration file separately
  for (const attesterRegistration of dirData.attesterRegistrations) {
    console.log(`\n=== Processing: ${attesterRegistration.path} ===`);

    if (attesterRegistration.data.length === 0) {
      console.log("No attester registrations found in this file.");
      continue;
    }

    console.log(
      `Found ${attesterRegistration.data.length} attester registrations`,
    );

    // Transform attester data to match ABI structure
    const keyStores = attesterRegistration.data.map((attesterData) => ({
      attester: getAddress(attesterData.attester),
      publicKeyG1: {
        x: BigInt(attesterData.publicKeyG1.x),
        y: BigInt(attesterData.publicKeyG1.y),
      },
      publicKeyG2: {
        x0: BigInt(attesterData.publicKeyG2.x0),
        x1: BigInt(attesterData.publicKeyG2.x1),
        y0: BigInt(attesterData.publicKeyG2.y0),
        y1: BigInt(attesterData.publicKeyG2.y1),
      },
      proofOfPossession: {
        x: BigInt(attesterData.proofOfPossession.x),
        y: BigInt(attesterData.proofOfPossession.y),
      },
    }));

    const callData = {
      contractToCall: ethClient.getStakingRegistryAddress(),
      callData: encodeFunctionData({
        abi: STAKING_REGISTRY_ABI,
        functionName: "addKeysToProvider",
        args: [stakingProviderData.providerId, keyStores],
      }),
    };

    console.log(
      `\nADD KEYS TO STAKING PROVIDER CALL DATA for ${attesterRegistration.path}:`,
    );
    console.log(JSON.stringify(callData, null, 2));

    // Also log individual attester addresses for reference
    console.log(`\nAttester addresses from ${attesterRegistration.path}:`);
    attesterRegistration.data.forEach((attester, index) => {
      console.log(`${index + 1}. ${attester.attester}`);
    });
  }
};

export default command;
