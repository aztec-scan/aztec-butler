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
import { extractAttesterCoinbasePairs } from "../../core/utils/keystoreOperations.js";
import { SafeGlobalClient } from "../../core/components/SafeGlobalClient.js";

interface AddKeysOptions {
  keystorePath: string;
  network: string;
  // updateConfig option removed - deprecated with scraper config format
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

  // 1. Load keystore (with lenient coinbase validation for this command)
  console.log(`Loading keystore: ${options.keystorePath}`);
  const { loadKeystoresFromPaths } = await import(
    "../../core/utils/keystoreOperations.js"
  );
  const keystores = await loadKeystoresFromPaths([options.keystorePath], {
    lenientCoinbaseValidation: true,
  });
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
    client as unknown as ViemPublicClient,
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

  // 5. Split into chunks of 50
  const CHUNK_SIZE = 50;
  const chunks: (typeof keyStores)[] = [];
  for (let i = 0; i < keyStores.length; i += CHUNK_SIZE) {
    chunks.push(keyStores.slice(i, i + CHUNK_SIZE));
  }

  console.log(
    `\n📦 Splitting ${keyStores.length} attester(s) into ${chunks.length} chunk(s) of up to ${CHUNK_SIZE}`,
  );

  // 6. Generate calldata for each chunk
  const callDataChunks = chunks.map((chunk, index) => ({
    chunkNumber: index + 1,
    attestersCount: chunk.length,
    contractToCall: ethClient.getStakingRegistryAddress(),
    callData: encodeFunctionData({
      abi: STAKING_REGISTRY_ABI,
      functionName: "addKeysToProvider",
      args: [stakingProviderData.providerId, chunk],
    }),
  }));

  // Log calldata for each chunk
  for (const chunkData of callDataChunks) {
    console.log(
      `\n=== ADD KEYS TO STAKING PROVIDER CALL DATA - CHUNK ${chunkData.chunkNumber}/${chunks.length} (${chunkData.attestersCount} attesters) ===`,
    );
    console.log(
      JSON.stringify(
        {
          contractToCall: chunkData.contractToCall,
          callData: chunkData.callData,
        },
        null,
        2,
      ),
    );
  }

  // List attester addresses by chunk
  console.log(`\n=== Attester Addresses by Chunk ===`);
  chunks.forEach((chunk, chunkIndex) => {
    console.log(
      `\nChunk ${chunkIndex + 1}/${chunks.length} (${chunk.length} attesters):`,
    );
    chunk.forEach((keyStore, index) => {
      const globalIndex = chunkIndex * CHUNK_SIZE + index;
      console.log(`${globalIndex + 1}. ${keyStore.attester}`);
    });
  });

  // Check if automatic Safe proposal is enabled
  if (
    config.SAFE_PROPOSALS_ENABLED &&
    config.SAFE_ADDRESS &&
    config.MULTISIG_PROPOSER_PRIVATE_KEY &&
    config.SAFE_API_KEY
  ) {
    console.log("\n🔄 Automatic multisig proposal is enabled...");
    console.log(`📤 Proposing ${callDataChunks.length} transaction(s) to Safe`);

    try {
      const safeClient = new SafeGlobalClient({
        safeAddress: config.SAFE_ADDRESS,
        chainId: config.ETHEREUM_CHAIN_ID,
        rpcUrl: config.ETHEREUM_NODE_URL,
        proposerPrivateKey: config.MULTISIG_PROPOSER_PRIVATE_KEY,
        safeApiKey: config.SAFE_API_KEY,
      });

      for (const chunkData of callDataChunks) {
        console.log(
          `\n📝 Proposing chunk ${chunkData.chunkNumber}/${chunks.length} (${chunkData.attestersCount} attesters)...`,
        );
        await safeClient.proposeTransaction({
          to: chunkData.contractToCall,
          data: chunkData.callData,
          value: "0",
        });
        console.log(
          `✅ Chunk ${chunkData.chunkNumber}/${chunks.length} successfully proposed!`,
        );
      }

      console.log(
        "\n✅ All transactions successfully proposed to Safe multisig!",
      );
      console.log(
        `   View in Safe UI: https://app.safe.global/transactions/queue?safe=eth:${config.SAFE_ADDRESS}`,
      );
    } catch (error) {
      console.error("\n❌ Failed to propose transaction to Safe:");
      console.error(error);
      console.warn(
        "\n⚠️  Please copy the calldata above and propose it manually to your Safe multisig.",
      );
    }
  } else {
    console.warn("\n⚠️  Note: Automatic multisig proposal is not enabled.");
    console.warn(
      "    Please copy the calldata above and propose it manually to your Safe multisig.",
    );

    if (!config.SAFE_PROPOSALS_ENABLED) {
      console.log(
        "\n💡 To enable automatic proposals, set SAFE_PROPOSALS_ENABLED=true in your config",
      );
    }
    if (!config.SAFE_ADDRESS) {
      console.log("💡 Set SAFE_ADDRESS in your config");
    }
    if (!config.MULTISIG_PROPOSER_PRIVATE_KEY) {
      console.log("💡 Set MULTISIG_PROPOSER_PRIVATE_KEY in your config");
    }
    if (!config.SAFE_API_KEY) {
      console.log(
        "💡 Set SAFE_API_KEY in your config (get one from https://app.safe.global/settings/api-key)",
      );
    }
  }
};

export default command;
