import assert from "assert";
import { encodeFunctionData, getAddress } from "viem";
import { getProviderId, getStakingRegistryAddress } from "../components/ethereumClient.js";
import { ButlerConfig } from "../config.js";
import { DirData, MOCK_REGISTRY_ABI } from "../types.js";

const command = async (l1ChainId: number, dirData: DirData, providerAdminAddress: ButlerConfig["PROVIDER_ADMIN_ADDRESS"]) => {
  assert(providerAdminAddress, "Provider admin address must be provided.");
  const providerId = await getProviderId(providerAdminAddress, l1ChainId);

  if (providerId < 0n) {
    console.error("Provider not registered. Please register the provider first.");
    return;
  }

  console.log(`Provider ID: ${providerId}`);

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

    console.log(`Found ${attesterRegistration.data.length} attester registrations`);

    // Transform attester data to match ABI structure
    const keyStores = attesterRegistration.data.map(attesterData => ({
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
      contractToCall: getStakingRegistryAddress(l1ChainId),
      callData: encodeFunctionData({
        abi: MOCK_REGISTRY_ABI,
        functionName: "addKeysToProvider",
        args: [
          providerId,
          keyStores,
        ]
      })
    };

    console.log(`\nADD KEYS TO PROVIDER CALL DATA for ${attesterRegistration.path}:`);
    console.log(JSON.stringify(callData, null, 2));

    // Also log individual attester addresses for reference
    console.log(`\nAttester addresses from ${attesterRegistration.path}:`);
    attesterRegistration.data.forEach((attester, index) => {
      console.log(`${index + 1}. ${attester.attester}`);
    });
  }
};

export default command;
