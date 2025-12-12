import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { computeBn254G1PublicKeyCompressed } from "@aztec/foundation/crypto";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import type { HexString } from "../../types/index.js";

interface ProcessPrivateKeysOptions {
  privateKeyFile: string;
  outputFile?: string;
}

interface PrivateKeyValidator {
  attester: {
    eth: string;
    bls: string;
  };
  publisher: string | string[];
  feeRecipient: string;
  coinbase?: string;
}

interface PrivateKeysFile {
  schemaVersion?: number;
  validators: PrivateKeyValidator[];
}

interface PublicKeyValidator {
  attester: {
    eth: string;
    bls: string;
  };
  feeRecipient: string;
}

interface PublicKeysFile {
  schemaVersion: number;
  validators: PublicKeyValidator[];
}

interface DerivedKeys {
  privateKeys: {
    eth: string;
    bls: string;
  };
  publicKeys: {
    eth: string;
    bls: string;
  };
  feeRecipient: string;
}

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: ProcessPrivateKeysOptions,
) => {
  assert(
    config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
    "Staking provider admin address must be provided.",
  );

  console.log("\n=== Processing Private Keys ===\n");

  // 1. Load private keys file
  console.log(`Loading private keys: ${options.privateKeyFile}`);
  let privateKeysData: PrivateKeysFile;
  try {
    const content = await fs.readFile(options.privateKeyFile, "utf-8");
    privateKeysData = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to load private keys file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    !privateKeysData.validators ||
    !Array.isArray(privateKeysData.validators)
  ) {
    throw new Error(
      "Invalid private keys file: must contain a 'validators' array",
    );
  }

  console.log(
    `✅ Loaded ${privateKeysData.validators.length} validator(s) from private keys file`,
  );

  // 2. Derive public keys and validate
  console.log("\nDeriving public keys...");
  const derivedKeys: DerivedKeys[] = [];

  for (let i = 0; i < privateKeysData.validators.length; i++) {
    const validator = privateKeysData.validators[i]!;

    try {
      // Validate required fields
      if (!validator.attester?.eth) {
        throw new Error(`Validator ${i}: missing attester.eth private key`);
      }
      if (!validator.attester?.bls) {
        throw new Error(`Validator ${i}: missing attester.bls private key`);
      }
      if (!validator.feeRecipient) {
        throw new Error(`Validator ${i}: missing feeRecipient`);
      }

      // Derive ETH address from private key
      let ethAddress: string;
      try {
        const account = privateKeyToAccount(
          validator.attester.eth as HexString,
        );
        ethAddress = getAddress(account.address);
      } catch (error) {
        throw new Error(
          `Validator ${i}: malformed attester.eth private key - ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Derive BLS public key from private key
      let blsPublicKey: string;
      try {
        // computeBn254G1PublicKeyCompressed accepts a hex string (with or without 0x) or bigint
        blsPublicKey = await computeBn254G1PublicKeyCompressed(
          validator.attester.bls,
        );
      } catch (error) {
        throw new Error(
          `Validator ${i}: malformed attester.bls private key - ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      derivedKeys.push({
        privateKeys: {
          eth: validator.attester.eth,
          bls: validator.attester.bls,
        },
        publicKeys: {
          eth: ethAddress,
          bls: blsPublicKey,
        },
        feeRecipient: validator.feeRecipient,
      });

      console.log(
        `  ${i + 1}. ETH: ${ethAddress.slice(0, 10)}... BLS: ${blsPublicKey.slice(0, 10)}...`,
      );
    } catch (error) {
      throw new Error(
        `Failed to process validator ${i}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(`✅ Successfully derived ${derivedKeys.length} public key(s)`);

  // 3. GCP Storage Placeholder
  console.log("\n=== GCP Storage (Placeholder) ===");
  console.log("TODO: Implement GCP storage for private keys");
  console.log("\nPrivate Keys & Derived Public Keys:");
  for (let i = 0; i < derivedKeys.length; i++) {
    const keys = derivedKeys[i]!;
    console.log(`\nValidator ${i + 1}:`);
    console.log(`  Private ETH Key: ${keys.privateKeys.eth}`);
    console.log(`  Private BLS Key: ${keys.privateKeys.bls}`);
    console.log(`  Public ETH Address: ${keys.publicKeys.eth}`);
    console.log(`  Public BLS Key: ${keys.publicKeys.bls}`);
    console.log(`  Fee Recipient: ${keys.feeRecipient}`);
  }

  // 4. Check provider queue for duplicates
  console.log("\n=== Checking Provider Queue ===");

  const stakingProviderData = await ethClient.getStakingProvider(
    config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
  );

  if (!stakingProviderData) {
    console.warn(
      "⚠️  Staking provider not registered yet - skipping queue check",
    );
  } else {
    console.log(`Provider ID: ${stakingProviderData.providerId}`);

    const queueLength = await ethClient.getProviderQueueLength(
      stakingProviderData.providerId,
    );
    console.log(`Provider queue length: ${queueLength}`);

    const attesterAddresses = derivedKeys.map((k) => k.publicKeys.eth);

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
              `Cannot process keys that are already queued.`,
          );
        }
      }
      console.log("✅ No duplicate attesters found in queue");
    } else {
      console.log("✅ Queue is empty, no duplicates possible");
    }
  }

  // 5. Create output file
  const outputFile =
    options.outputFile || `public-${path.basename(options.privateKeyFile)}`;

  console.log(`\n=== Generating Public Keys File ===`);
  console.log(`Output file: ${outputFile}`);

  const publicKeysData: PublicKeysFile = {
    schemaVersion: privateKeysData.schemaVersion || 1,
    validators: derivedKeys.map((k) => ({
      attester: {
        eth: k.publicKeys.eth,
        bls: k.publicKeys.bls,
      },
      feeRecipient: k.feeRecipient,
    })),
  };

  try {
    await fs.writeFile(
      outputFile,
      JSON.stringify(publicKeysData, null, 2) + "\n",
    );
    console.log(`✅ Successfully wrote public keys to ${outputFile}`);
  } catch (error) {
    throw new Error(
      `Failed to write output file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  console.log("\n=== Summary ===");
  console.log(`Processed ${derivedKeys.length} validator(s)`);
  console.log(`Output: ${outputFile}`);
  console.log(
    `Public keys generated with: attester.eth, attester.bls, feeRecipient`,
  );
  console.log(`Excluded from output: publisher, coinbase`);
  console.log("\n✅ Process complete!");
};

export default command;
