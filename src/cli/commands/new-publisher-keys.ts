import fs from "fs/promises";
import path from "path";
import { randomBytes } from "node:crypto";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { getServiceAccountCredentials } from "../../core/utils/googleAuth.js";
import type { ButlerConfig } from "../../core/config/index.js";
import type { HexString } from "../../types/index.js";

interface NewPublisherKeysOptions {
  count: number;
  outputAddressesFile?: string;
}

interface SecretManagerContext {
  client: SecretManagerServiceClient;
  projectId: string;
  secretNetwork: string;
}

interface PublisherSecretEntry {
  key: string;
  publicKey: string;
}

const getEthereumNetworkName = (chainId: number): string => {
  switch (chainId) {
    case 1:
      return "mainnet";
    case 11155111:
      return "sepolia";
    default:
      return `chain-${chainId}`;
  }
};

const isNotFoundError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: number }).code === 5;

const hasEnabledSecretVersion = async (
  ctx: SecretManagerContext,
  secretName: string,
): Promise<boolean> => {
  const versions = ctx.client.listSecretVersionsAsync({ parent: secretName });

  for await (const version of versions) {
    if (version.state === "ENABLED") {
      return true;
    }
  }

  return false;
};

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

const getExistingPublisherSecretInfo = async (ctx: SecretManagerContext) => {
  const parent = `projects/${ctx.projectId}`;
  const publisherRegex = new RegExp(
    `^web3signer-${ctx.secretNetwork}-eth-pub-(0x[0-9a-fA-F]+)$`,
  );

  const secretNamesByPublicKey = new Map<string, string[]>();
  const iterable = ctx.client.listSecretsAsync({ parent });

  for await (const secret of iterable) {
    const fullName = secret.name ?? "";
    const secretId = fullName.split("/").pop() ?? "";
    const match = publisherRegex.exec(secretId);
    const publicKey = match?.[1];
    if (!publicKey) continue;

    const normalizedPublicKey = publicKey.toLowerCase();
    const secretName = `${parent}/secrets/${secretId}`;
    const existing = secretNamesByPublicKey.get(normalizedPublicKey) ?? [];
    existing.push(secretName);
    secretNamesByPublicKey.set(normalizedPublicKey, existing);
  }

  return secretNamesByPublicKey;
};

const addPublisherSecretVersions = async (
  ctx: SecretManagerContext,
  entries: PublisherSecretEntry[],
) => {
  const secretNamesByPublicKey = await getExistingPublisherSecretInfo(ctx);

  for (const entry of entries) {
    const normalizedPublicKey = entry.publicKey.toLowerCase();
    const existingSecretNames =
      secretNamesByPublicKey.get(normalizedPublicKey) ?? [];

    if (existingSecretNames.length > 0) {
      let reusedSecretName: string | null = null;
      let hasEnabledVersion = false;

      for (const existingSecretName of existingSecretNames) {
        if (await hasEnabledSecretVersion(ctx, existingSecretName)) {
          hasEnabledVersion = true;
          break;
        }
        reusedSecretName = existingSecretName;
      }

      if (hasEnabledVersion) {
        console.log(
          `  ⚠️ Skipping publisher key ${normalizedPublicKey}: public key already uploaded`,
        );
        continue;
      }

      if (reusedSecretName) {
        const [version] = await ctx.client.addSecretVersion({
          parent: reusedSecretName,
          payload: { data: Buffer.from(entry.key, "utf8") },
        });

        const secretId = reusedSecretName.split("/").pop() ?? "<unknown>";
        const versionId = version.name?.split("/").pop();
        console.log(
          `  ➕ Added missing version ${versionId ?? "<unknown>"} to ${secretId} (publisher key ${normalizedPublicKey})`,
        );
        continue;
      }
    }

    const secretId = `web3signer-${ctx.secretNetwork}-eth-pub-${normalizedPublicKey}`;
    const labels: Record<string, string> = {
      network: ctx.secretNetwork,
      key_type: "eth",
      role: "pub",
    };

    const secretName = await ensureSecretExists(ctx, secretId, labels);
    const existing = secretNamesByPublicKey.get(normalizedPublicKey) ?? [];
    existing.push(secretName);
    secretNamesByPublicKey.set(normalizedPublicKey, existing);

    const [version] = await ctx.client.addSecretVersion({
      parent: secretName,
      payload: { data: Buffer.from(entry.key, "utf8") },
    });

    const versionId = version.name?.split("/").pop();
    console.log(
      `  ➕ Added version ${versionId ?? "<unknown>"} to ${secretId} (publisher key ${normalizedPublicKey})`,
    );
  }
};

const generateValidPrivateKey = (): HexString => {
  while (true) {
    const key = `0x${randomBytes(32).toString("hex")}` as HexString;
    try {
      privateKeyToAccount(key);
      return key;
    } catch {
      // retry on invalid secp256k1 scalar
    }
  }
};

const getTimestamp = (date: Date): string => {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const command = async (
  config: ButlerConfig,
  options: NewPublisherKeysOptions,
) => {
  if (!Number.isInteger(options.count) || options.count <= 0) {
    throw new Error("--count/-n must be a positive integer");
  }

  console.log("\n=== Creating New Publisher Keys ===\n");
  console.log(`Generating ${options.count} publisher private key(s)...`);

  const generated = Array.from({ length: options.count }, () => {
    const privateKey = generateValidPrivateKey();
    const account = privateKeyToAccount(privateKey);
    const address = getAddress(account.address);
    return { privateKey, address };
  });

  const uniqueByAddress = new Map<
    string,
    { privateKey: string; address: string }
  >();
  generated.forEach((entry) => {
    uniqueByAddress.set(entry.address.toLowerCase(), entry);
  });

  if (uniqueByAddress.size !== generated.length) {
    console.warn(
      `⚠️  Duplicate generated addresses detected (${generated.length - uniqueByAddress.size}); deduplicating before upload`,
    );
  }

  const publishers = Array.from(uniqueByAddress.values());

  console.log(`✅ Generated ${publishers.length} unique publisher key(s)`);

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
    secretNetwork: getEthereumNetworkName(config.ETHEREUM_CHAIN_ID),
  };

  await addPublisherSecretVersions(
    secretContext,
    publishers.map((publisher) => ({
      key: publisher.privateKey,
      publicKey: publisher.address,
    })),
  );

  console.log("✅ Stored publisher private keys in GCP Secret Manager");

  const defaultOutputFile = `new-publisher-keys-${config.NETWORK}-${getTimestamp(new Date())}.json`;
  const outputFile = options.outputAddressesFile || defaultOutputFile;
  const outputPath = path.resolve(outputFile);

  const addresses = publishers.map((p) => p.address);
  await fs.writeFile(outputPath, JSON.stringify({ addresses }, null, 2) + "\n");

  console.log(`\n✅ Wrote publisher addresses to ${outputPath}`);
  console.log("\nPublisher addresses (fund these):");
  addresses.forEach((address) => console.log(`  - ${address}`));
};

export default command;
