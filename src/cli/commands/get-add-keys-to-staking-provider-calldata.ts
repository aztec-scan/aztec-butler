import assert from "assert";
import { encodeFunctionData, getAddress } from "viem";
import {
  getAddressFromPrivateKey,
  GSEContract,
  ViemPublicClient,
} from "@aztec/ethereum";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import { STAKING_REGISTRY_ABI, HexString } from "../../types/index.js";
import { ButlerConfig } from "../../core/config/index.js";
import {
  loadScraperConfig,
  saveScraperConfig,
} from "../../core/utils/scraperConfigOperations.js";
import { extractAttesterCoinbasePairs } from "../../core/utils/keystoreOperations.js";

interface AddKeysOptions {
  keystorePath: string;
  network: string;
  updateConfig?: boolean;
}

const get0xString = (bn: bigint): HexString => {
  return `0x${bn.toString(16).padStart(64, "0")}`;
};

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: AddKeysOptions,
) => {
  assert(
    config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
    "Staking provider admin address must be provided.",
  );

  console.log("\n=== Generating Add Keys Calldata ===\n");

  // 1. Load keystore
  console.log(`Loading keystore: ${options.keystorePath}`);
  const { loadKeystoresFromPaths } = await import(
    "../../core/utils/keystoreOperations.js"
  );
  const keystores = await loadKeystoresFromPaths([options.keystorePath]);
  const keystore = keystores[0]!;
  console.log(
    `✅ Loaded keystore with ${keystore.data.validators.length} validator(s)`,
  );

  // 2. Get staking provider info
  const stakingProviderData = await ethClient.getStakingProvider(
    config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
  );

  if (!stakingProviderData) {
    console.error(
      "Staking provider not registered. Please register the staking provider first.",
    );
    return;
  }

  console.log(
    `\n${stakingProviderData.providerId} - Admin: ${stakingProviderData.admin}, Take Rate: ${stakingProviderData.takeRate}, Rewards Recipient: ${stakingProviderData.rewardsRecipient}`,
  );
  console.log(`Staking Provider ID: ${stakingProviderData.providerId}`);

  // 3. Check for duplicate attesters in provider queue
  console.log("\nChecking for duplicate attesters in provider queue...");
  const queueLength = await ethClient.getProviderQueueLength(
    stakingProviderData.providerId,
  );
  console.log(`Provider queue length: ${queueLength}`);

  const attesterAddresses = keystore.data.validators.map((v: any) =>
    getAddressFromPrivateKey(v.attester.eth as `0x${string}`),
  );

  if (queueLength > 0n) {
    const providerQueue = await ethClient.getProviderQueue(
      stakingProviderData.providerId,
    );
    console.log(`Loaded ${providerQueue.length} attester(s) from queue`);

    // Check if any attesters are already in queue
    const queueSet = new Set(providerQueue.map((addr) => addr.toLowerCase()));

    for (const attesterAddr of attesterAddresses) {
      if (queueSet.has(attesterAddr.toLowerCase())) {
        throw new Error(
          `FATAL: Attester ${attesterAddr} is already in provider queue!\n` +
            `Cannot add keys that are already queued. This would result in an on-chain transaction failure.`,
        );
      }
    }
    console.log("✅ No duplicate attesters found");
  } else {
    console.log("✅ Queue is empty, no duplicates possible");
  }

  // 4. Generate registration data
  console.log("\nGenerating registration data...");
  const client = ethClient.getPublicClient();
  const rollupContract = ethClient.getRollupContract();
  const gse = new GSEContract(
    client as ViemPublicClient,
    getAddress(await rollupContract.read.getGSE()) as any,
  );

  const keyStores = [];
  for (const validator of keystore.data.validators) {
    const registrationTuple = await gse.makeRegistrationTuple(
      BigInt(validator.attester.bls),
    );

    const attesterAddr = getAddressFromPrivateKey(
      validator.attester.eth as `0x${string}`,
    );

    keyStores.push({
      attester: getAddress(attesterAddr),
      publicKeyG1: {
        x: BigInt(get0xString(registrationTuple.publicKeyInG1.x)),
        y: BigInt(get0xString(registrationTuple.publicKeyInG1.y)),
      },
      publicKeyG2: {
        x0: BigInt(get0xString(registrationTuple.publicKeyInG2.x0)),
        x1: BigInt(get0xString(registrationTuple.publicKeyInG2.x1)),
        y0: BigInt(get0xString(registrationTuple.publicKeyInG2.y0)),
        y1: BigInt(get0xString(registrationTuple.publicKeyInG2.y1)),
      },
      proofOfPossession: {
        x: BigInt(get0xString(registrationTuple.proofOfPossession.x)),
        y: BigInt(get0xString(registrationTuple.proofOfPossession.y)),
      },
    });
  }

  console.log(
    `✅ Generated registration data for ${keyStores.length} attester(s)`,
  );

  // 5. Generate calldata
  const callData = {
    contractToCall: ethClient.getStakingRegistryAddress(),
    callData: encodeFunctionData({
      abi: STAKING_REGISTRY_ABI,
      functionName: "addKeysToProvider",
      args: [stakingProviderData.providerId, keyStores],
    }),
  };

  console.log(`\n=== ADD KEYS TO STAKING PROVIDER CALL DATA ===`);
  console.log(JSON.stringify(callData, null, 2));

  // List attester addresses
  console.log(`\n=== Attester Addresses ===`);
  attesterAddresses.forEach((attester: string, index: number) => {
    console.log(`${index + 1}. ${attester}`);
  });

  // 6. Update scraper config if requested
  if (options.updateConfig) {
    console.log("\n=== Updating Scraper Config ===\n");

    try {
      const scraperConfig = await loadScraperConfig(options.network);
      console.log("✅ Loaded existing scraper config");

      // Extract new attesters from keystore
      const { extractAttesterDataWithPublisher } = await import(
        "../../core/utils/keystoreOperations.js"
      );
      const attesterData = extractAttesterDataWithPublisher([keystore]);

      // Add new attesters (avoid duplicates)
      const existingAttesterAddrs = new Set(
        scraperConfig.attesters.map((a) => a.address.toLowerCase()),
      );
      const newAttesters = attesterData
        .filter(
          (data) => !existingAttesterAddrs.has(data.address.toLowerCase()),
        )
        .map((data) => ({
          address: data.address,
          coinbase:
            data.coinbase || "0x0000000000000000000000000000000000000000",
          publisher: data.publisher,
        }));

      if (newAttesters.length === 0) {
        console.log("⚠️  All attesters already in config");
      } else {
        scraperConfig.attesters.push(...newAttesters);
        scraperConfig.lastUpdated = new Date().toISOString();

        await saveScraperConfig(scraperConfig);
        console.log(`✅ Updated scraper config:`);
        console.log(`   Added ${newAttesters.length} new attester(s)`);

        // Count unique publishers
        const uniquePublishers = new Set(
          scraperConfig.attesters.map((a) => a.publisher),
        ).size;
        console.log(`   Total unique publishers: ${uniquePublishers}`);
      }
    } catch (error) {
      console.warn(
        `\n⚠️  Could not update scraper config: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.warn(
        "   Run generate-scraper-config to create a new config with all keystores.",
      );
    }
  }

  console.warn(
    "\n⚠️  Note: Automatic multisig proposal is not yet implemented.",
  );
  console.warn(
    "    Please copy the calldata above and propose it manually to your Safe multisig.",
  );
};

export default command;
