/**
 * Agent configuration.
 *
 * The agent is the local, read-only sequencer telemetry process. It runs in one
 * of three explicit modes (see {@link AgentMode}); the mode selects the scraper
 * set and the metric-instrument set. It loads the standard per-network base.env
 * (for chain/RPC settings) plus a set of agent-specific BUTLER_AGENT_* fields.
 *
 * Agent mode is read-only by design. {@link buildAgentConfig} fails closed when
 * it sees any mutating or key-bearing configuration so an agent host can never
 * be accidentally given write-path credentials.
 */

import dotenv from "dotenv";
import envPath from "env-paths";
import path from "node:path";
import { z } from "zod";
import { PACKAGE_NAME } from "../core/config/index.js";

export const OTLP_PROTOCOLS = ["http/protobuf", "grpc"] as const;
export type OtlpProtocol = (typeof OTLP_PROTOCOLS)[number];

/**
 * Agent run modes:
 * - `node`   — local sequencer-node telemetry (keys, status, publishers, ETA)
 * - `global` — chain-wide telemetry (entry/provider queues, rewards); one per network
 * - `all`    — both; dev / test / single-box only
 */
export const AGENT_MODES = ["node", "global", "all"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** True when the mode runs the local (host-scoped) scrapers + metrics. */
export const modeHasLocalScrapers = (mode: AgentMode): boolean =>
  mode === "node" || mode === "all";

/** True when the mode runs the global (chain-wide) scrapers + metrics. */
export const modeHasGlobalScrapers = (mode: AgentMode): boolean =>
  mode === "global" || mode === "all";

export const DEFAULT_OTLP_ENDPOINT = "http://127.0.0.1:4318/v1/metrics";
const DEFAULT_OTLP_EXPORT_INTERVAL_MS = 30_000;
const DEFAULT_SCRAPE_INTERVAL_MS = 30_000;
const DEFAULT_GLOBAL_SCRAPE_INTERVAL_MS = 60_000;
const DEFAULT_ENTRY_QUEUE_ETA_INTERVAL_MS = 120_000;
const DEFAULT_REWARDS_INTERVAL_MS = 3_600_000;

export interface AgentConfig {
  network: string;
  /** Run mode — selects the scraper set and the metric-instrument set. */
  mode: AgentMode;
  /**
   * Logical host name for this sequencer (e.g. "beast-3"); the `host` metric
   * label. Required for `node`/`all` mode; absent for `global` mode, which has
   * no host identity.
   */
  host?: string;

  // ── network / chain ──────────────────────────────────────────────────
  ethereumChainId: number;
  ethereumNodeUrl: string;
  ethereumArchiveNodeUrl?: string;
  aztecNodeUrl: string;

  // ── registry config ──────────────────────────────────────────────────
  /**
   * Native staking provider id — the stable identifier for the provider.
   * Preferred over {@link nativeProviderAdminAddress}: the id never changes,
   * resolves in a single read, and avoids registry iteration. When set, it
   * takes precedence over the admin-address resolution path.
   */
  nativeProviderId?: bigint;
  nativeProviderAdminAddress?: string;
  ollaProviderAdminAddress?: string;
  ollaStakingRegistryAddress?: string;

  minEthPerAttester: string;
  scrapeIntervalMs: number;
  globalScrapeIntervalMs: number;
  /** Interval for the per-host entry-queue ETA scraper (`node`/`all` mode). */
  entryQueueEtaIntervalMs: number;

  // ── rewards (Part 2 Phase A — `global`/`all` mode) ────────────────────
  /** Enable the staking-rewards scraper. */
  rewardsEnabled: boolean;
  rewardsIntervalMs: number;
  /** Start block for the `StakedWithProvider` event scan. Required when rewards enabled. */
  stakingRewardsSplitFromBlock?: bigint;
  /** Override the reward token; default = the rollup's staking asset. */
  rewardTokenAddress?: string;
  /** Recipient counted as "ours" in split allocations; default = the provider's rewardsRecipient. */
  safeAddress?: string;

  // ── OTLP export ──────────────────────────────────────────────────────
  otlp: {
    enabled: boolean;
    endpoint: string;
    protocol: OtlpProtocol;
    exportIntervalMs: number;
  };
}

/** Parse a boolean-ish env var. Unset → `defaultValue`. */
const parseBool = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined || value === "") return defaultValue;
  return value === "true" || value === "1";
};

/** Address validator: 0x-prefixed, 42 chars. */
const optionalAddress = (label: string, value: string | undefined): string | undefined => {
  if (value === undefined || value === "") return undefined;
  const result = z.string().startsWith("0x").length(42).safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid configuration for ${label}: expected a 0x-prefixed 42-char address, got "${value}"`);
  }
  return result.data;
};

const requiredUrl = (label: string, value: string | undefined): string => {
  const result = z.string().url().safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid configuration for ${label}: a valid URL is required (got "${value ?? "<unset>"}")`);
  }
  return result.data;
};

const positiveInt = (label: string, value: string | undefined, defaultValue: number): number => {
  if (value === undefined || value === "") return defaultValue;
  const result = z.coerce.number().int().positive().safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid configuration for ${label}: a positive integer is required (got "${value}")`);
  }
  return result.data;
};

/**
 * Fail closed on unsafe/mutating configuration. Agent mode must never be
 * given write-path credentials or be allowed to broadcast/propose.
 */
export const assertReadOnlyEnv = (env: Record<string, string | undefined>): void => {
  const violations: string[] = [];

  if (parseBool(env.SAFE_PROPOSALS_ENABLED, false)) {
    violations.push("SAFE_PROPOSALS_ENABLED is true — agent mode never proposes Safe transactions.");
  }
  if (env.MULTISIG_PROPOSER_PRIVATE_KEY) {
    violations.push("MULTISIG_PROPOSER_PRIVATE_KEY is set — agent mode must not be given private keys.");
  }
  if (env.SAFE_API_KEY) {
    violations.push("SAFE_API_KEY is set — agent mode does not use the Safe API.");
  }

  if (violations.length > 0) {
    throw new Error(
      "Refusing to start agent: agent mode is read-only and must not receive mutating or key-bearing config.\n" +
        violations.map((v) => `  - ${v}`).join("\n") +
        "\n\nUse a dedicated, minimal agent env file (see docs/agent-deployment.md).",
    );
  }
};

/**
 * Build an {@link AgentConfig} from a raw env map and a run mode. Pure and
 * side-effect free so it can be unit tested without touching `process.env` or
 * the filesystem.
 *
 * @param mode  the run mode, typically from the `--mode` CLI flag
 */
export const buildAgentConfig = (
  env: Record<string, string | undefined>,
  network: string,
  mode: string,
): AgentConfig => {
  assertReadOnlyEnv(env);

  if (!AGENT_MODES.includes(mode as AgentMode)) {
    throw new Error(
      `Invalid agent mode "${mode}". Expected one of: ${AGENT_MODES.join(", ")}.`,
    );
  }
  const agentMode = mode as AgentMode;

  const host = env.BUTLER_AGENT_HOST?.trim();
  if (modeHasLocalScrapers(agentMode) && !host) {
    throw new Error(
      `BUTLER_AGENT_HOST is required in "${agentMode}" mode — set it to this ` +
        `sequencer's host name (e.g. beast-3).`,
    );
  }

  const ethereumChainId = positiveInt("ETHEREUM_CHAIN_ID", env.ETHEREUM_CHAIN_ID, 0);
  if (ethereumChainId === 0) {
    throw new Error("Invalid configuration for ETHEREUM_CHAIN_ID: a positive integer is required.");
  }

  const protocolRaw = (env.BUTLER_AGENT_OTLP_PROTOCOL ?? "http/protobuf").trim();
  if (!OTLP_PROTOCOLS.includes(protocolRaw as OtlpProtocol)) {
    throw new Error(
      `Invalid configuration for BUTLER_AGENT_OTLP_PROTOCOL: expected one of ${OTLP_PROTOCOLS.join(", ")}, got "${protocolRaw}".`,
    );
  }
  const protocol = protocolRaw as OtlpProtocol;
  if (protocol === "grpc") {
    throw new Error(
      "BUTLER_AGENT_OTLP_PROTOCOL=grpc is not bundled in this build. Install @opentelemetry/exporter-metrics-otlp-grpc " +
        "and wire it into src/agent/metrics/otlp.ts, or use the default http/protobuf transport.",
    );
  }

  const archiveUrl = env.ETHEREUM_ARCHIVE_NODE_URL;

  const config: AgentConfig = {
    network,
    mode: agentMode,
    ethereumChainId,
    ethereumNodeUrl: requiredUrl("ETHEREUM_NODE_URL", env.ETHEREUM_NODE_URL),
    aztecNodeUrl: requiredUrl("AZTEC_NODE_URL", env.AZTEC_NODE_URL),
    minEthPerAttester: env.MIN_ETH_PER_ATTESTER?.trim() || "0.1",
    scrapeIntervalMs: positiveInt(
      "BUTLER_AGENT_SCRAPE_INTERVAL_MS",
      env.BUTLER_AGENT_SCRAPE_INTERVAL_MS,
      DEFAULT_SCRAPE_INTERVAL_MS,
    ),
    globalScrapeIntervalMs: positiveInt(
      "BUTLER_AGENT_GLOBAL_SCRAPE_INTERVAL_MS",
      env.BUTLER_AGENT_GLOBAL_SCRAPE_INTERVAL_MS,
      DEFAULT_GLOBAL_SCRAPE_INTERVAL_MS,
    ),
    entryQueueEtaIntervalMs: positiveInt(
      "BUTLER_AGENT_ENTRY_QUEUE_ETA_INTERVAL_MS",
      env.BUTLER_AGENT_ENTRY_QUEUE_ETA_INTERVAL_MS,
      DEFAULT_ENTRY_QUEUE_ETA_INTERVAL_MS,
    ),
    rewardsEnabled: parseBool(env.BUTLER_AGENT_REWARDS_ENABLED, false),
    rewardsIntervalMs: positiveInt(
      "BUTLER_AGENT_REWARDS_INTERVAL_MS",
      env.BUTLER_AGENT_REWARDS_INTERVAL_MS,
      DEFAULT_REWARDS_INTERVAL_MS,
    ),
    otlp: {
      enabled: parseBool(env.BUTLER_AGENT_OTLP_ENABLED, true),
      endpoint: env.BUTLER_AGENT_OTLP_ENDPOINT?.trim() || DEFAULT_OTLP_ENDPOINT,
      protocol,
      exportIntervalMs: positiveInt(
        "BUTLER_AGENT_OTLP_EXPORT_INTERVAL_MS",
        env.BUTLER_AGENT_OTLP_EXPORT_INTERVAL_MS,
        DEFAULT_OTLP_EXPORT_INTERVAL_MS,
      ),
    },
  };

  if (host) config.host = host;

  const optionalArchive = archiveUrl ? requiredUrl("ETHEREUM_ARCHIVE_NODE_URL", archiveUrl) : undefined;
  if (optionalArchive) config.ethereumArchiveNodeUrl = optionalArchive;

  const providerIdRaw = env.AZTEC_STAKING_PROVIDER_ID?.trim();
  if (providerIdRaw) {
    const parsed = z.coerce.bigint().nonnegative().safeParse(providerIdRaw);
    if (!parsed.success) {
      throw new Error(
        `Invalid configuration for AZTEC_STAKING_PROVIDER_ID: a non-negative integer is required (got "${providerIdRaw}")`,
      );
    }
    config.nativeProviderId = parsed.data;
  }

  const nativeAdmin = optionalAddress("AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS", env.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS);
  if (nativeAdmin) config.nativeProviderAdminAddress = nativeAdmin;

  const ollaAdmin = optionalAddress(
    "OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS",
    env.OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
  );
  if (ollaAdmin) config.ollaProviderAdminAddress = ollaAdmin;

  const ollaRegistry = optionalAddress("OLLA_AZTEC_STAKING_REGISTRY_ADDRESS", env.OLLA_AZTEC_STAKING_REGISTRY_ADDRESS);
  if (ollaRegistry) config.ollaStakingRegistryAddress = ollaRegistry;

  const splitFromBlockRaw = env.STAKING_REWARDS_SPLIT_FROM_BLOCK?.trim();
  if (splitFromBlockRaw) {
    const parsed = z.coerce.bigint().nonnegative().safeParse(splitFromBlockRaw);
    if (!parsed.success) {
      throw new Error(
        `Invalid configuration for STAKING_REWARDS_SPLIT_FROM_BLOCK: a non-negative integer is required (got "${splitFromBlockRaw}")`,
      );
    }
    config.stakingRewardsSplitFromBlock = parsed.data;
  }

  const rewardToken = optionalAddress("REWARD_TOKEN_ADDRESS", env.REWARD_TOKEN_ADDRESS);
  if (rewardToken) config.rewardTokenAddress = rewardToken;

  const safe = optionalAddress("SAFE_ADDRESS", env.SAFE_ADDRESS);
  if (safe) config.safeAddress = safe;

  // Rewards (in global/all mode) needs archive RPC + an event-scan start block.
  if (config.rewardsEnabled && modeHasGlobalScrapers(agentMode)) {
    if (!config.ethereumArchiveNodeUrl) {
      throw new Error(
        "BUTLER_AGENT_REWARDS_ENABLED requires ETHEREUM_ARCHIVE_NODE_URL — the " +
          "StakedWithProvider event scan needs an archive node.",
      );
    }
    if (config.stakingRewardsSplitFromBlock === undefined) {
      throw new Error(
        "BUTLER_AGENT_REWARDS_ENABLED requires STAKING_REWARDS_SPLIT_FROM_BLOCK — " +
          "the event-scan start block.",
      );
    }
  }

  return config;
};

/** Resolve the per-network base env file path used by every Butler mode. */
export const getAgentConfigPath = (network: string): string => {
  const configDir = envPath(PACKAGE_NAME, { suffix: "" }).config;
  return path.join(configDir, `${network}-base.env`);
};

/**
 * Load agent config for a network: read the base.env into `process.env`,
 * then build and validate the {@link AgentConfig} for the given run mode.
 */
export const loadAgentConfig = (
  network: string,
  mode: string,
  options?: { configFilePath?: string },
): AgentConfig => {
  const configPath = options?.configFilePath ?? getAgentConfigPath(network);
  dotenv.config({ path: configPath });
  console.log(`[agent] Loading configuration from ${configPath}`);
  return buildAgentConfig(process.env, network, mode);
};

/** One-line human summary of the agent's effective configuration. */
export const describeAgentConfig = (config: AgentConfig): string => {
  return [
    `network=${config.network}`,
    `mode=${config.mode}`,
    `host=${config.host ?? "(none)"}`,
    `chainId=${config.ethereumChainId}`,
    `otlp=${config.otlp.enabled ? `${config.otlp.protocol}->${config.otlp.endpoint}` : "disabled"}`,
  ].join(" ");
};
