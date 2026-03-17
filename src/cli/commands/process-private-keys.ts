import fs from "fs/promises";
import path from "path";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { computeBn254G1PublicKeyCompressed } from "@aztec/foundation/crypto";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import { getServiceAccountCredentials } from "../../core/utils/googleAuth.js";
import type { ButlerConfig } from "../../core/config/index.js";
import type { HexString, StakingRegistryTarget } from "../../types/index.js";
import { checkAttesterDuplicatesAcrossRegistries } from "../utils/stakingRegistryChecks.js";

interface ProcessPrivateKeysOptions {
  privateKeyFile: string;
  outputFile?: string;
  registry: StakingRegistryTarget;
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
  publisher: string;
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

type SecretRole = "att" | "pub";
type SecretKeyType = "eth" | "bls";

interface SecretManagerContext {
  client: SecretManagerServiceClient;
  projectId: string;
  network: string;
}

interface SecretEntry {
  role: SecretRole;
  keyType: SecretKeyType;
  key: string;
  validatorIndex: number;
  publicKey: string;
}

const ensureReloadUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = "/reload";
    }
    return url.toString();
  } catch {
    // Fallback: attempt to treat rawUrl as host without protocol
    return `http://${rawUrl.replace(/\/$/, "")}/reload`;
  }
};

const triggerWeb3SignerReloads = async (
  network: string,
  reloadUrls?: string[],
) => {
  if (!reloadUrls || reloadUrls.length === 0) {
    console.log(`No web3signer reload URLs configured for ${network}`);
    return;
  }

  console.log(`\n=== Triggering web3signer reloads for ${network} ===`);

  const resolvedUrls = reloadUrls.map(ensureReloadUrl);

  const results = await Promise.allSettled(
    resolvedUrls.map(async (url) => {
      const response = await fetch(url, { method: "POST" });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `HTTP ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
        );
      }
    }),
  );

  let failures = 0;
  results.forEach((result, idx) => {
    const url = resolvedUrls[idx]!;
    if (result.status === "fulfilled") {
      console.log(`  🔄 Reload triggered: ${url}`);
    } else {
      failures += 1;
      console.error(
        `  ❌ Reload failed for ${url}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
    }
  });

  if (failures === 0) {
    console.log(
      `✅ web3signer reload requests completed for ${reloadUrls.length} instance(s)`,
    );
  } else {
    console.warn(
      `⚠️  web3signer reloads finished with ${failures}/${reloadUrls.length} failure(s)`,
    );
  }
};

const createSecretId = (
  network: string,
  keyType: SecretKeyType,
  role: SecretRole,
  id: number,
  publicKey: string,
) => `web3signer-${network}-${keyType}-${role}-${id}-${publicKey}`;

const isNotFoundError = (error: unknown) =>
  typeof error === "object" && error !== null && (error as any).code === 5;

const ensureSecretExists = async (
  ctx: SecretManagerContext,
  secretId: string,
  labels: Record<string, string>,
): Promise<string> => {
  const parent = `projects/${ctx.projectId}`;
  const name = `${parent}/secrets/${secretId}`;

  try {
    await ctx.client.getSecret({ name });
    return name;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }

    await ctx.client.createSecret({
      parent,
      secretId,
      secret: {
        replication: { automatic: {} },
        labels,
      },
    });

    console.log(
      `Created secret ${secretId} with labels ${JSON.stringify(labels)}`,
    );
    return name;
  }
};

const getExistingSecretInfo = async (
  ctx: SecretManagerContext,
  keyType: SecretKeyType,
  role: SecretRole,
) => {
  const parent = `projects/${ctx.projectId}`;
  const prefixRegex = new RegExp(
    `^web3signer-${ctx.network}-${keyType}-${role}-(\\d+)-(0x[0-9a-fA-F]+)$`,
  );

  let maxId = -1;
  const publicKeys = new Set<string>();
  const iterable = ctx.client.listSecretsAsync({ parent });

  for await (const secret of iterable) {
    const fullName = secret.name ?? "";
    const secretId = fullName.split("/").pop() ?? "";
    const match = prefixRegex.exec(secretId);
    if (!match) continue;

    const idNum = Number.parseInt(match[1] ?? "0", 10);
    if (!Number.isNaN(idNum) && idNum > maxId) {
      maxId = idNum;
    }

    const secretPublicKey = match[2];
    if (secretPublicKey) {
      publicKeys.add(secretPublicKey.toLowerCase());
    }
  }

  return { maxId, publicKeys };
};

const addSecretVersions = async (
  ctx: SecretManagerContext,
  entries: SecretEntry[],
) => {
  const grouped = entries.reduce<Record<string, SecretEntry[]>>(
    (acc, entry) => {
      const key = `${entry.role}-${entry.keyType}`;
      acc[key] ??= [];
      acc[key]!.push(entry);
      return acc;
    },
    {},
  );

  for (const groupKey of Object.keys(grouped)) {
    const [role, keyType] = groupKey.split("-") as [SecretRole, SecretKeyType];
    const groupEntries = grouped[groupKey] ?? [];
    if (groupEntries.length === 0) continue;

    const { maxId, publicKeys } = await getExistingSecretInfo(
      ctx,
      keyType,
      role,
    );
    let nextId = maxId + 1;

    for (const entry of groupEntries) {
      const normalizedPublicKey = entry.publicKey.toLowerCase();
      if (publicKeys.has(normalizedPublicKey)) {
        console.log(
          `  ⚠️ Skipping ${role}/${keyType} for validator ${entry.validatorIndex}: public key already uploaded`,
        );
        continue;
      }

      const secretId = createSecretId(
        ctx.network,
        keyType,
        role,
        nextId,
        normalizedPublicKey,
      );
      nextId += 1;
      publicKeys.add(normalizedPublicKey);

      const labels = {
        network: ctx.network,
        key_type: keyType,
        role,
        validator_index: String(entry.validatorIndex),
      };

      const secretName = await ensureSecretExists(ctx, secretId, labels);

      const [version] = await ctx.client.addSecretVersion({
        parent: secretName,
        payload: { data: Buffer.from(entry.key, "utf8") },
      });

      const versionId = version.name?.split("/").pop();
      console.log(
        `  ➕ Added version ${versionId ?? "<unknown>"} to ${secretId} (validator ${entry.validatorIndex})`,
      );
    }
  }
};

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: ProcessPrivateKeysOptions,
) => {
  const stakingProviderAdminAddress =
    config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS;

  if (
    !stakingProviderAdminAddress &&
    !(options.registry === "olla" && config.OLLA_AZTEC_STAKING_REGISTRY_ADDRESS)
  ) {
    throw new Error(
      "Staking provider admin address must be provided unless using --registry olla with OLLA_AZTEC_STAKING_REGISTRY_ADDRESS configured.",
    );
  }

  console.log("\n=== Processing Private Keys ===\n");
  const selectedRegistryAddress = ethClient.getStakingRegistryAddress(
    options.registry,
  );
  console.log(`Registry target: ${options.registry}`);
  console.log(`Registry address: ${selectedRegistryAddress}`);

  const allowedNetworks = ["mainnet", "testnet"] as const;
  if (
    !allowedNetworks.includes(
      config.NETWORK as (typeof allowedNetworks)[number],
    )
  ) {
    throw new Error(
      `Unsupported network '${config.NETWORK}'. Supported: ${allowedNetworks.join(", ")}`,
    );
  }

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

      // Validate publisher keys (string or array)
      if (validator.publisher === undefined || validator.publisher === null) {
        throw new Error(`Validator ${i}: missing publisher private key(s)`);
      }

      const validatorPublisherKeys = Array.isArray(validator.publisher)
        ? validator.publisher
        : [validator.publisher];

      if (validatorPublisherKeys.length === 0) {
        throw new Error(`Validator ${i}: missing publisher private key(s)`);
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

  // 3. Store secrets in GCP Secret Manager
  console.log("\n=== GCP Secret Storage ===");

  const serviceAccountCredentials = await getServiceAccountCredentials(config);
  const resolvedProjectId =
    serviceAccountCredentials.project_id || config.GCP_PROJECT_ID;

  const secretManagerClientOptions: ConstructorParameters<
    typeof SecretManagerServiceClient
  >[0] = {
    credentials: serviceAccountCredentials,
  };

  if (resolvedProjectId) {
    secretManagerClientOptions.projectId = resolvedProjectId;
  }

  const secretManagerClient = new SecretManagerServiceClient(
    secretManagerClientOptions,
  );

  const projectId =
    resolvedProjectId ||
    (await secretManagerClient.getProjectId().catch(() => undefined));

  if (!projectId) {
    throw new Error(
      "GCP project ID not found. Set GCP_PROJECT_ID or include project_id in the Google service account key JSON.",
    );
  }

  console.log(
    `Using Google service account ${serviceAccountCredentials.client_email} for project ${projectId}`,
  );

  const secretContext: SecretManagerContext = {
    client: secretManagerClient,
    projectId,
    network: config.NETWORK,
  };

  const secretEntries: SecretEntry[] = [];

  derivedKeys.forEach((keys, idx) => {
    secretEntries.push(
      {
        role: "att",
        keyType: "eth",
        key: keys.privateKeys.eth,
        validatorIndex: idx,
        publicKey: keys.publicKeys.eth,
      },
      {
        role: "att",
        keyType: "bls",
        key: keys.privateKeys.bls,
        validatorIndex: idx,
        publicKey: keys.publicKeys.bls,
      },
    );
  });

  // Publisher keys - skip storing to GCP with warnings
  console.log(
    "\n⚠️  Skipping publisher private keys - will not be stored to GCP",
  );
  derivedKeys.forEach((keys, idx) => {
    const validatorPublisherKeys = Array.isArray(
      privateKeysData.validators[idx]!.publisher,
    )
      ? privateKeysData.validators[idx]!.publisher
      : [privateKeysData.validators[idx]!.publisher];

    console.log(
      `  ⚠️  Validator ${idx}: Skipping ${validatorPublisherKeys.length} publisher key(s)`,
    );
  });

  await addSecretVersions(secretContext, secretEntries);
  console.log("✅ Stored private keys in GCP Secret Manager");

  await triggerWeb3SignerReloads(config.NETWORK, config.WEB3SIGNER_URLS);

  // 4. Check provider queue for duplicates
  console.log("\n=== Checking Provider Queue(s) ===");

  if (!stakingProviderAdminAddress) {
    console.warn(
      "⚠️  AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS not configured - skipping provider queue duplicate checks",
    );
  } else {
    const stakingProviderData = await ethClient.getStakingProvider(
      stakingProviderAdminAddress,
      options.registry,
    );

    if (!stakingProviderData) {
      console.warn(
        "⚠️  Staking provider not registered yet - skipping queue check",
      );
    } else {
      console.log(`Provider ID: ${stakingProviderData.providerId}`);

      const attesterAddresses = derivedKeys.map((k) => k.publicKeys.eth);

      const { duplicates } = await checkAttesterDuplicatesAcrossRegistries(
        ethClient,
        stakingProviderAdminAddress,
        attesterAddresses,
      );

      if (duplicates.size > 0) {
        const duplicateLines = Array.from(duplicates.entries()).map(
          ([attester, targets]) =>
            `  - ${attester}: ${Array.from(targets.values()).join(", ")}`,
        );
        throw new Error(
          "FATAL: Duplicate attester(s) found in staking provider queues across registries:\n" +
            duplicateLines.join("\n") +
            "\nCannot process keys that are already queued.",
        );
      }
      console.log(
        "✅ No duplicate attesters found across available registries",
      );
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
      publisher: "0x0000000000000000000000000000000000000000",
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
    `Public keys generated with: attester.eth, attester.bls, publisher (zero address), feeRecipient`,
  );
  console.log(
    `Publisher private keys were NOT stored to GCP (zero address used in output)`,
  );
  console.log(`Excluded from output: coinbase`);
  console.log("\n✅ Process complete!");
};

export default command;
