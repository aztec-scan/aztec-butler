import assert from "assert";
import { encodeFunctionData, getAddress, type Address } from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import { SafeGlobalClient } from "../../core/components/SafeGlobalClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { STAKING_REGISTRY_ABI } from "../../types/index.js";

interface GetChangeProviderCommissionCalldataOptions {
  providerId?: bigint;
  commissionBasisPoints: number;
  proposeToSafe?: boolean;
  safeAddress?: string;
}

const proposeCommissionChangeToSafe = async ({
  config,
  safeAddress,
  contractToCall,
  callData,
}: {
  config: ButlerConfig;
  safeAddress: Address;
  contractToCall: Address;
  callData: `0x${string}`;
}) => {
  if (!config.MULTISIG_PROPOSER_PRIVATE_KEY) {
    throw new Error(
      "MULTISIG_PROPOSER_PRIVATE_KEY must be configured to propose to Safe.",
    );
  }
  if (!config.SAFE_API_KEY) {
    throw new Error("SAFE_API_KEY must be configured to propose to Safe.");
  }

  const safeClient = new SafeGlobalClient({
    safeAddress,
    chainId: config.ETHEREUM_CHAIN_ID,
    rpcUrl: config.ETHEREUM_NODE_URL,
    proposerPrivateKey: config.MULTISIG_PROPOSER_PRIVATE_KEY,
    safeApiKey: config.SAFE_API_KEY,
  });

  await safeClient.proposeTransaction({
    to: contractToCall,
    data: callData,
    value: "0",
  });
};

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: GetChangeProviderCommissionCalldataOptions,
) => {
  assert(
    options.providerId !== undefined ||
      config.AZTEC_STAKING_PROVIDER_ID !== undefined,
    "AZTEC_STAKING_PROVIDER_ID must be configured or --provider-id must be provided.",
  );

  const providerId = options.providerId ?? config.AZTEC_STAKING_PROVIDER_ID;
  assert(providerId !== undefined);

  const safeAddress = options.safeAddress ?? config.SAFE_ADDRESS;
  if (options.proposeToSafe && !safeAddress) {
    throw new Error(
      "SAFE_ADDRESS, AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS, or --safe-address must be set to propose to Safe.",
    );
  }

  const stakingRegistryAddress = ethClient.getStakingRegistryAddress("native");
  const commissionPercentage = options.commissionBasisPoints / 100;

  console.log("\n=== Provider Commission Calldata ===\n");
  console.log("Arguments:");
  console.log(`  --provider-id: ${providerId}`);
  console.log(`  --commission-bps: ${options.commissionBasisPoints}`);
  console.log("");
  console.log("Registry target: native");
  console.log(`Registry address: ${stakingRegistryAddress}`);
  console.log(`Provider ID: ${providerId}`);
  console.log(
    `New commission: ${options.commissionBasisPoints} bps (${commissionPercentage}%)`,
  );

  const providerData = await ethClient.getStakingProviderById(providerId);
  if (!providerData) {
    console.warn(
      `\n⚠️  No native staking provider found for provider ID ${providerId}. Calldata will still be generated.`,
    );
  } else {
    console.log(
      `Current provider: Admin: ${providerData.admin}, Take Rate: ${providerData.takeRate} bps (${providerData.takeRate / 100}%), Rewards Recipient: ${providerData.rewardsRecipient}`,
    );
  }

  const updateProviderCommissionCallData = {
    contractToCall: stakingRegistryAddress,
    callData: encodeFunctionData({
      abi: STAKING_REGISTRY_ABI,
      functionName: "updateProviderTakeRate",
      args: [providerId, options.commissionBasisPoints],
    }),
  };

  console.log("\nUPDATE PROVIDER COMMISSION CALL DATA:");
  console.log(JSON.stringify(updateProviderCommissionCallData, null, 2));

  if (options.proposeToSafe && safeAddress) {
    const normalizedSafeAddress = getAddress(safeAddress);
    console.log("\n🔄 Proposing provider commission update to Safe...");
    console.log(`Safe address: ${normalizedSafeAddress}`);
    await proposeCommissionChangeToSafe({
      config,
      safeAddress: normalizedSafeAddress,
      contractToCall: updateProviderCommissionCallData.contractToCall,
      callData: updateProviderCommissionCallData.callData,
    });
    console.log("\n✅ Provider commission update proposed to Safe multisig.");
    console.log(
      `   View in Safe UI: https://app.safe.global/transactions/queue?safe=eth:${normalizedSafeAddress}`,
    );
  } else {
    console.log(
      "\n💡 To propose this directly to the provider-admin Safe, rerun with --propose-to-safe.",
    );
  }
};

export default command;
