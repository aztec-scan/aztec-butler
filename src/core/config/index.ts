import dotenv from "dotenv";
import envPath from "env-paths";
import fs from "fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { strict as assert } from "node:assert";
import z from "zod";

const parseUrlList = (value?: string) =>
  value
    ?.split(",")
    .map((url) => url.trim())
    .filter(Boolean);

// Allow environment variable override for npm_package_version/name (useful when running via ts-node)
const packageVersion =
  process.env.npm_package_version || process.env.NPM_PACKAGE_VERSION || "2.0.0";
const packageName =
  process.env.npm_package_name ||
  process.env.NPM_PACKAGE_NAME ||
  "aztec-butler";

const SENSITIVE_CONFIG_KEYS = new Set([
  "METRICS_BEARER_TOKEN",
  "SAFE_API_KEY",
  "MULTISIG_PROPOSER_PRIVATE_KEY",
]);

export const PACKAGE_VERSION = packageVersion;
export const PACKAGE_NAME = packageName;

const getConfigDir = (): string => {
  return envPath(PACKAGE_NAME, { suffix: "" }).config;
};

/**
 * Find all available network configs
 */
async function findNetworkConfigs(): Promise<string[]> {
  try {
    const configDir = getConfigDir();
    const files = await fs.readdir(configDir);
    return files
      .filter((f) => f.endsWith("-base.env"))
      .map((f) => f.replace("-base.env", ""));
  } catch (error) {
    // Directory doesn't exist yet
    return [];
  }
}

/**
 * Load specific network config
 */
async function loadNetworkConfig(
  network: string,
  suppressLog?: boolean,
  userConfigFilePath?: string,
): Promise<ReturnType<typeof buildConfig>> {
  const configPath =
    userConfigFilePath || path.join(getConfigDir(), `${network}-base.env`);
  dotenv.config({ path: configPath });

  const config = buildConfig(network);
  await ensureConfigFile(configPath, !!userConfigFilePath, config);

  if (!suppressLog) {
    // TODO: add default false "showSensitiveInfo"
    console.log(`CONFIGURATION (reading from ${configPath}):
${Object.entries(config)
  .map(([key, value]) =>
    `  ${key}\t${SENSITIVE_CONFIG_KEYS.has(key) ? "[redacted]" : value}`,
  )
  .join("\n")}
`);
  }
  return config;
}

/**
 * Build config object from environment variables
 */
function buildConfig(network: string) {
  return {
    NETWORK: z.string().parse(network),
    SERVER_ID: z
      .string()
      .optional()
      .parse(process.env.SERVER_ID || "server-01"),
    ETHEREUM_CHAIN_ID: z.coerce
      .number()
      .int()
      .parse(process.env.ETHEREUM_CHAIN_ID),
    ETHEREUM_NODE_URL: z
      .string()
      .url()
      .parse(process.env.ETHEREUM_NODE_URL || "http://localhost:8545"),
    ETHEREUM_ARCHIVE_NODE_URL: z
      .string()
      .url()
      .optional()
      .parse(process.env.ETHEREUM_ARCHIVE_NODE_URL),
    AZTEC_NODE_URL: z
      .string()
      .url()
      .parse(process.env.AZTEC_NODE_URL || "http://localhost:8080"),
    AZTEC_STAKING_PROVIDER_ID: z.coerce
      .bigint()
      .optional()
      .parse(process.env.AZTEC_STAKING_PROVIDER_ID),
    STAKING_PROVIDER_ID: z
      .string()
      .optional()
      .parse(process.env.STAKING_PROVIDER_ID),
    AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS: z
      .string()
      .startsWith("0x")
      .length(42)
      .optional()
      .parse(process.env.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS),
    SAFE_ADDRESS: z
      .string()
      .startsWith("0x")
      .length(42)
      .optional()
      .parse(
        process.env.SAFE_ADDRESS ||
          process.env.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
      ),
    SAFE_PROPOSALS_ENABLED: z
      .string()
      .transform((val) => val === "true" || val === "1")
      .pipe(z.boolean())
      .optional()
      .parse(process.env.SAFE_PROPOSALS_ENABLED ?? "false"),
    MULTISIG_PROPOSER_PRIVATE_KEY: z
      .string()
      .startsWith("0x")
      .length(66)
      .optional()
      .parse(process.env.MULTISIG_PROPOSER_PRIVATE_KEY),
    MIN_ETH_PER_ATTESTER: z
      .string()
      .parse(process.env.MIN_ETH_PER_ATTESTER || "0.1"),
    SAFE_API_KEY: z.string().optional().parse(process.env.SAFE_API_KEY),
    METRICS_BEARER_TOKEN: z
      .string()
      .parse(process.env.METRICS_BEARER_TOKEN || "default-api-key"),
    STAKING_REWARDS_SPLIT_FROM_BLOCK: z.coerce
      .bigint()
      .optional()
      .parse(process.env.STAKING_REWARDS_SPLIT_FROM_BLOCK ?? "23083526"),
    STAKING_REWARDS_SCRAPE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .parse(
        process.env.STAKING_REWARDS_SCRAPE_INTERVAL_MS ??
          (60 * 60 * 1000).toString(),
      ),
    GOOGLE_SHEETS_SPREADSHEET_ID: z
      .string()
      .optional()
      .parse(process.env.GOOGLE_SHEETS_SPREADSHEET_ID),
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: z
      .string()
      .optional()
      .parse(
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
      ),
    GOOGLE_SHEETS_RANGE: z
      .string()
      .optional()
      .parse(process.env.GOOGLE_SHEETS_RANGE || "DailyTotal!A1"),
    GCP_PROJECT_ID: z
      .string()
      .optional()
      .parse(process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT),
    GOOGLE_SHEETS_COINBASES_RANGE: z
      .string()
      .optional()
      .parse(process.env.GOOGLE_SHEETS_COINBASES_RANGE || "Coinbases!A1"),
    GOOGLE_SHEETS_DAILY_PER_COINBASE_RANGE: z
      .string()
      .optional()
      .parse(
        process.env.GOOGLE_SHEETS_DAILY_PER_COINBASE_RANGE ||
          "DailyPerCoinbase!A1",
      ),
    GOOGLE_SHEETS_DAILY_EARNED_RANGE: z
      .string()
      .optional()
      .parse(process.env.GOOGLE_SHEETS_DAILY_EARNED_RANGE || "DailyEarned!A1"),
    WEB3SIGNER_URLS: z
      .array(z.string().url())
      .optional()
      .parse(parseUrlList(process.env.WEB3SIGNER_URLS)),
  };
}

export type ButlerConfig = ReturnType<typeof buildConfig>;

/**
 * Initialize configuration with network selection
 */
export const initConfig = async (options?: {
  suppressLog?: boolean;
  userConfigFilePath?: string;
  network?: string;
}): Promise<ButlerConfig> => {
  console.log("\n\nInitializing configuration...\n\n");

  const availableNetworks = await findNetworkConfigs();

  let selectedNetwork: string;
  if (options?.network) {
    // User specified network
    selectedNetwork = options.network;
  } else if (options?.userConfigFilePath) {
    // User provided a specific config file path
    // Try to extract network name from filename
    const fileName = path.basename(options.userConfigFilePath);
    const match = fileName.match(/^(.+)-base\.env$/);
    selectedNetwork = match?.[1] ?? "unknown";
  } else if (availableNetworks.length === 1) {
    // Only one network available
    selectedNetwork = availableNetworks[0]!;
    console.log(`Using network: ${selectedNetwork}`);
  } else if (availableNetworks.length === 0) {
    // No configs found, create testnet default
    console.warn(
      "No network configurations found. Creating default testnet config.",
    );
    selectedNetwork = "testnet";
  } else if (availableNetworks.includes("testnet")) {
    // Default to testnet
    console.log(
      `Multiple networks found (${availableNetworks.join(", ")}), defaulting to testnet`,
    );
    selectedNetwork = "testnet";
  } else {
    throw new Error(
      "Multiple network configs found. Please specify --network flag.\n" +
        `Available: ${availableNetworks.join(", ")}`,
    );
  }

  return await loadNetworkConfig(
    selectedNetwork,
    options?.suppressLog,
    options?.userConfigFilePath,
  );
};

/**
 * Load all available network configurations
 * Used by server mode to support multi-network operation
 */
export const loadAllAvailableNetworkConfigs = async (options?: {
  suppressLog?: boolean;
  specificNetwork?: string;
}): Promise<Map<string, ButlerConfig>> => {
  const configs = new Map<string, ButlerConfig>();

  if (options?.specificNetwork) {
    // Load only the specified network
    console.log(
      `[Config] Loading specific network: ${options.specificNetwork}`,
    );
    const config = await loadNetworkConfig(
      options.specificNetwork,
      options?.suppressLog,
    );
    configs.set(options.specificNetwork, config);
    console.log(`[Config] Loaded only: ${options.specificNetwork}`);
    return configs;
  }

  // Find all available network configs
  const availableNetworks = await findNetworkConfigs();

  if (availableNetworks.length === 0) {
    console.warn(
      "No network configurations found. Please create network configs.",
    );
    return configs;
  }

  console.log(
    `[Config] Loading all available networks: ${availableNetworks.join(", ")}`,
  );

  // Load all available networks
  for (const network of availableNetworks) {
    try {
      const config = await loadNetworkConfig(network, options?.suppressLog);
      configs.set(network, config);
      console.log(`✓ Loaded config for network: ${network}`);
    } catch (error) {
      console.error(`✗ Failed to load config for network ${network}:`, error);
      // Continue loading other networks
    }
  }

  console.log(`[Config] Total configs loaded: ${configs.size}`);
  return configs;
};

const ensureConfigFile = async (
  configFilePath: string,
  isUserDefined: boolean,
  conf: ButlerConfig,
) => {
  const configFormattedString = Object.entries(conf).map(
    ([key, value]) => (value ? `${key}=${value}` : `# ${key}=`) + "\n",
  );
  try {
    await fs.stat(configFilePath);
  } catch (e) {
    if (isUserDefined) {
      throw new Error(
        `Config file not found at provided path: ${configFilePath}`,
      );
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = (
      await rl.question(
        `\nWarning: No config found. Create default config at\n   ${configFilePath}\n\nContinue? (Y/n) `,
      )
    )
      .trim()
      .toLowerCase();

    rl.close();

    if (answer !== "" && answer !== "y" && answer !== "yes") {
      console.log("Operation cancelled.");
      process.exit(0);
    }

    await fs.mkdir(path.dirname(configFilePath), { recursive: true });
    await fs.writeFile(configFilePath, configFormattedString.join(""));
  }
};
