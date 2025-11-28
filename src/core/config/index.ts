import dotenv from "dotenv";
import envPath from "env-paths";
import fs from "fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { strict as assert } from "node:assert";
import z from "zod";

assert(
  process.env.npm_package_name !== undefined,
  "npm package name is undefined",
);
export const PACKAGE_NAME = process.env.npm_package_name!;

const DEFAULT_CONFIG_FILE_PATH =
  envPath(PACKAGE_NAME, { suffix: "" }).config + "/basic";

export type ButlerConfig = Awaited<ReturnType<typeof initConfig>>;

export const initConfig = async (
  supressLog?: boolean,
  userConfigFilePath?: string,
) => {
  console.log("\n\nInitializing configuration...\n\n");
  let configFilePath = userConfigFilePath || DEFAULT_CONFIG_FILE_PATH;
  dotenv.config({ path: configFilePath });

  const config = {
    AZTEC_DOCKER_DIR: z
      .string()
      .parse(process.env.AZTEC_DOCKER_DIR || path.join(process.cwd(), "..")),
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
    PROVIDER_ADMIN_ADDRESS: z
      .string()
      .startsWith("0x")
      .length(42)
      .optional()
      .parse(process.env.PROVIDER_ADMIN_ADDRESS),
    SAFE_ADDRESS: z
      .string()
      .startsWith("0x")
      .length(42)
      .optional()
      .parse(process.env.SAFE_ADDRESS || process.env.PROVIDER_ADMIN_ADDRESS),
    MULTISIG_PROPOSER_PRIVATE_KEY: z
      .string()
      .startsWith("0x")
      .length(66)
      .optional()
      .parse(process.env.MULTISIG_PROPOSER_PRIVATE_KEY),
    MIN_ETH_PER_ATTESTER: z
      .string()
      .parse(process.env.MIN_ETH_PER_ATTESTER),
    SAFE_API_KEY: z.string().optional().parse(process.env.SAFE_API_KEY),
    METRICS_BEARER_TOKEN: z
      .string()
      .parse(process.env.METRICS_BEARER_TOKEN || "default-api-key"),
    STAKING_REWARDS_SPLIT_FROM_BLOCK: z
      .coerce.bigint()
      .optional()
      .parse(process.env.STAKING_REWARDS_SPLIT_FROM_BLOCK ?? "23083526"),
    STAKING_REWARDS_SCRAPE_INTERVAL_MS: z
      .coerce.number()
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
    GOOGLE_SHEETS_RANGE: z
      .string()
      .optional()
      .parse(process.env.GOOGLE_SHEETS_RANGE || "DailyTotal!A1"),
    GOOGLE_SERVICE_ACCOUNT_KEY_PATH: z
      .string()
      .optional()
      .parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH),
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
  };
  await ensureConfigFile(configFilePath, !!userConfigFilePath, config);

  if (!supressLog) {
    // TODO: add default false "showSensitiveInfo"
    console.log(`CONFIGURATION (reading from ${configFilePath}):
${Object.entries(config)
        .map(([key, value]) => `  ${key}\t${value}`)
        .join("\n")}
`);
  }
  return config;
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
    await fs.writeFile(configFilePath, configFormattedString);
  }
};
