/**
 * Configuration for the `sheets-exporter` — the staking-rewards accounting
 * ledger (Part 2 Phase B). Loads the per-network base.env plus SHEETS_EXPORTER_*
 * fields.
 *
 * Like agent mode, it is read-only with respect to the chain and fails closed
 * on mutating/key-bearing config — its only write surface is Google Sheets.
 */

import dotenv from "dotenv";
import envPath from "env-paths";
import path from "node:path";
import { z } from "zod";
import { assertReadOnlyEnv } from "../agent/config.js";
import { PACKAGE_NAME } from "../core/config/index.js";

const DEFAULT_INTERVAL_MS = 86_400_000; // daily
const DEFAULT_MAX_RPS = 8; // backfill self-rate-limit
const DEFAULT_LEDGER_RANGE = "RewardsLedger!A1";
const DEFAULT_DAILY_TOTAL_RANGE = "RewardsDailyTotal!A1";

export interface SheetsExporterConfig {
  network: string;
  ethereumChainId: number;
  ethereumNodeUrl: string;
  /** Archive RPC for `--backfill` historical reads. Optional; required only for backfill. */
  archiveRpcUrl?: string;
  aztecNodeUrl: string;
  /**
   * Native staking provider id — the stable identifier, preferred over the
   * admin address. The build requires exactly one of `nativeProviderId` /
   * `nativeProviderAdminAddress` to be configured.
   */
  nativeProviderId?: bigint;
  /** Native staking-provider admin — fallback when the provider id is unset. */
  nativeProviderAdminAddress?: string;
  /** Recipient counted as "ours" in split allocations; default = provider rewardsRecipient. */
  rewardRecipientAddress?: string;
  /** Reward token override; default = the rollup's staking asset. */
  rewardTokenAddress?: string;
  /** Start block for the `StakedWithProvider` scan and the backfill. */
  stakingRewardsSplitFromBlock: bigint;
  gcpKeyFile: string;
  spreadsheetId: string;
  ledgerRange: string;
  dailyTotalRange: string;
  intervalMs: number;
  /** Backfill self-rate-limit, requests/sec, to stay under a free archive tier. */
  maxRps: number;
}

const requiredUrl = (label: string, value: string | undefined): string => {
  const r = z.string().url().safeParse(value);
  if (!r.success) throw new Error(`Invalid ${label}: a valid URL is required (got "${value ?? "<unset>"}")`);
  return r.data;
};

const requiredStr = (label: string, value: string | undefined): string => {
  const v = value?.trim();
  if (!v) throw new Error(`${label} is required for the sheets-exporter.`);
  return v;
};

const optionalAddress = (label: string, value: string | undefined): string | undefined => {
  if (!value?.trim()) return undefined;
  if (!z.string().startsWith("0x").length(42).safeParse(value.trim()).success) {
    throw new Error(`Invalid ${label}: expected a 0x-prefixed 42-char address, got "${value}"`);
  }
  return value.trim();
};

const positiveInt = (label: string, value: string | undefined, dflt: number): number => {
  if (!value?.trim()) return dflt;
  const r = z.coerce.number().int().positive().safeParse(value);
  if (!r.success) throw new Error(`Invalid ${label}: a positive integer is required (got "${value}")`);
  return r.data;
};

/** Build a {@link SheetsExporterConfig} from a raw env map. Pure, unit-testable. */
export const buildSheetsExporterConfig = (
  env: Record<string, string | undefined>,
  network: string,
): SheetsExporterConfig => {
  assertReadOnlyEnv(env);

  const chainId = positiveInt("ETHEREUM_CHAIN_ID", env.ETHEREUM_CHAIN_ID, 0);
  if (chainId === 0) throw new Error("ETHEREUM_CHAIN_ID is required.");

  const splitFromBlockRaw = requiredStr("STAKING_REWARDS_SPLIT_FROM_BLOCK", env.STAKING_REWARDS_SPLIT_FROM_BLOCK);
  const splitFromBlock = z.coerce.bigint().nonnegative().safeParse(splitFromBlockRaw);
  if (!splitFromBlock.success) {
    throw new Error(`Invalid STAKING_REWARDS_SPLIT_FROM_BLOCK: a non-negative integer is required.`);
  }

  const config: SheetsExporterConfig = {
    network,
    ethereumChainId: chainId,
    ethereumNodeUrl: requiredUrl("ETHEREUM_NODE_URL", env.ETHEREUM_NODE_URL),
    aztecNodeUrl: requiredUrl("AZTEC_NODE_URL", env.AZTEC_NODE_URL),
    stakingRewardsSplitFromBlock: splitFromBlock.data,
    gcpKeyFile: requiredStr("GOOGLE_SERVICE_ACCOUNT_KEY_FILE", env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE),
    spreadsheetId: requiredStr("GOOGLE_SHEETS_SPREADSHEET_ID", env.GOOGLE_SHEETS_SPREADSHEET_ID),
    ledgerRange: env.SHEETS_EXPORTER_LEDGER_RANGE?.trim() || DEFAULT_LEDGER_RANGE,
    dailyTotalRange: env.SHEETS_EXPORTER_DAILY_TOTAL_RANGE?.trim() || DEFAULT_DAILY_TOTAL_RANGE,
    intervalMs: positiveInt("SHEETS_EXPORTER_INTERVAL_MS", env.SHEETS_EXPORTER_INTERVAL_MS, DEFAULT_INTERVAL_MS),
    maxRps: positiveInt("SHEETS_EXPORTER_MAX_RPS", env.SHEETS_EXPORTER_MAX_RPS, DEFAULT_MAX_RPS),
  };

  // Native provider: resolved by id (preferred) or admin address. The
  // sheets-exporter cannot run without a provider, so one of the two is required.
  const providerIdRaw = env.AZTEC_STAKING_PROVIDER_ID?.trim();
  if (providerIdRaw) {
    const parsed = z.coerce.bigint().nonnegative().safeParse(providerIdRaw);
    if (!parsed.success) {
      throw new Error(
        `Invalid AZTEC_STAKING_PROVIDER_ID: a non-negative integer is required (got "${providerIdRaw}")`,
      );
    }
    config.nativeProviderId = parsed.data;
  }
  const nativeAdmin = optionalAddress(
    "AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS",
    env.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
  );
  if (nativeAdmin) config.nativeProviderAdminAddress = nativeAdmin;
  if (config.nativeProviderId === undefined && !config.nativeProviderAdminAddress) {
    throw new Error(
      "The sheets-exporter requires a native staking provider: set " +
        "AZTEC_STAKING_PROVIDER_ID (preferred) or AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS.",
    );
  }

  // Archive endpoint: dedicated override, else the shared ETHEREUM_ARCHIVE_NODE_URL.
  const archive = env.SHEETS_EXPORTER_ARCHIVE_RPC_URL?.trim() || env.ETHEREUM_ARCHIVE_NODE_URL?.trim();
  if (archive) config.archiveRpcUrl = requiredUrl("SHEETS_EXPORTER_ARCHIVE_RPC_URL", archive);

  const recipient = optionalAddress("SAFE_ADDRESS", env.SAFE_ADDRESS);
  if (recipient) config.rewardRecipientAddress = recipient;

  const rewardToken = optionalAddress("REWARD_TOKEN_ADDRESS", env.REWARD_TOKEN_ADDRESS);
  if (rewardToken) config.rewardTokenAddress = rewardToken;

  return config;
};

/** Load sheets-exporter config: read the network base.env, then build it. */
export const loadSheetsExporterConfig = (
  network: string,
  options?: { configFilePath?: string },
): SheetsExporterConfig => {
  const configDir = envPath(PACKAGE_NAME, { suffix: "" }).config;
  const configPath = options?.configFilePath ?? path.join(configDir, `${network}-base.env`);
  dotenv.config({ path: configPath });
  console.log(`[sheets-exporter] Loading configuration from ${configPath}`);
  return buildSheetsExporterConfig(process.env, network);
};
