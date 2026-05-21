/**
 * Agent configuration.
 *
 * The agent is the local, read-only sequencer telemetry process. It loads
 * the standard per-network base.env (for chain/RPC settings) plus a set of
 * agent-specific BUTLER_AGENT_* fields.
 *
 * Agent mode is read-only by design. {@link buildAgentConfig} fails closed
 * when it sees any mutating or key-bearing configuration so an agent host
 * can never be accidentally given write-path credentials.
 */

import dotenv from "dotenv";
import envPath from "env-paths";
import path from "node:path";
import { z } from "zod";
import { PACKAGE_NAME } from "../core/config/index.js";

export const OTLP_PROTOCOLS = ["http/protobuf", "grpc"] as const;
export type OtlpProtocol = (typeof OTLP_PROTOCOLS)[number];

export const DEFAULT_OTLP_ENDPOINT = "http://127.0.0.1:4318/v1/metrics";
const DEFAULT_OTLP_EXPORT_INTERVAL_MS = 30_000;
const DEFAULT_SCRAPE_INTERVAL_MS = 30_000;
const DEFAULT_GLOBAL_SCRAPE_INTERVAL_MS = 60_000;

export interface AgentConfig {
  network: string;
  /** Logical host name for this sequencer (e.g. "beast-3"). Used as the `host` metric label. */
  host: string;

  // ── network / chain ──────────────────────────────────────────────────
  ethereumChainId: number;
  ethereumNodeUrl: string;
  ethereumArchiveNodeUrl?: string;
  aztecNodeUrl: string;

  // ── registry config ──────────────────────────────────────────────────
  nativeProviderAdminAddress?: string;
  ollaProviderAdminAddress?: string;
  ollaStakingRegistryAddress?: string;

  minEthPerAttester: string;
  scrapeIntervalMs: number;
  globalScrapeIntervalMs: number;

  // ── OTLP export ──────────────────────────────────────────────────────
  otlp: {
    enabled: boolean;
    endpoint: string;
    protocol: OtlpProtocol;
    exportIntervalMs: number;
  };

  // ── scraper toggles ──────────────────────────────────────────────────
  scrapers: {
    /** Read local registered-key files (presence / registry / coinbase). */
    localKeys: boolean;
    /** Read staking-registry provider-queue membership for local attesters. */
    l1Status: boolean;
    /** Read rollup `getAttesterView` for local attesters (lifecycle state). */
    rollupStatus: boolean;
    /** Read L1 ETH balances for local publishers. */
    publisherBalances: boolean;
    /** Export global chain state (entry queue, provider queues). Opt-in. */
    globalStats: boolean;
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
 * Build an {@link AgentConfig} from a raw env map. Pure and side-effect free
 * so it can be unit tested without touching `process.env` or the filesystem.
 */
export const buildAgentConfig = (
  env: Record<string, string | undefined>,
  network: string,
): AgentConfig => {
  assertReadOnlyEnv(env);

  const host = env.BUTLER_AGENT_HOST?.trim();
  if (!host) {
    throw new Error(
      "BUTLER_AGENT_HOST is required in agent mode — set it to this sequencer's host name (e.g. beast-3).",
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
    host,
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
    scrapers: {
      localKeys: parseBool(env.BUTLER_AGENT_LOCAL_KEYS_ENABLED, true),
      l1Status: parseBool(env.BUTLER_AGENT_L1_STATUS_ENABLED, true),
      rollupStatus: parseBool(env.BUTLER_AGENT_ROLLUP_STATUS_ENABLED, true),
      publisherBalances: parseBool(env.BUTLER_AGENT_PUBLISHER_BALANCES_ENABLED, true),
      globalStats: parseBool(env.BUTLER_AGENT_GLOBAL_STATS_ENABLED, false),
    },
  };

  const optionalArchive = archiveUrl ? requiredUrl("ETHEREUM_ARCHIVE_NODE_URL", archiveUrl) : undefined;
  if (optionalArchive) config.ethereumArchiveNodeUrl = optionalArchive;

  const nativeAdmin = optionalAddress("AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS", env.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS);
  if (nativeAdmin) config.nativeProviderAdminAddress = nativeAdmin;

  const ollaAdmin = optionalAddress(
    "OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS",
    env.OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
  );
  if (ollaAdmin) config.ollaProviderAdminAddress = ollaAdmin;

  const ollaRegistry = optionalAddress("OLLA_AZTEC_STAKING_REGISTRY_ADDRESS", env.OLLA_AZTEC_STAKING_REGISTRY_ADDRESS);
  if (ollaRegistry) config.ollaStakingRegistryAddress = ollaRegistry;

  return config;
};

/** Resolve the per-network base env file path used by every Butler mode. */
export const getAgentConfigPath = (network: string): string => {
  const configDir = envPath(PACKAGE_NAME, { suffix: "" }).config;
  return path.join(configDir, `${network}-base.env`);
};

/**
 * Load agent config for a network: read the base.env into `process.env`,
 * then build and validate the {@link AgentConfig}.
 */
export const loadAgentConfig = (
  network: string,
  options?: { configFilePath?: string },
): AgentConfig => {
  const configPath = options?.configFilePath ?? getAgentConfigPath(network);
  dotenv.config({ path: configPath });
  console.log(`[agent] Loading configuration from ${configPath}`);
  return buildAgentConfig(process.env, network);
};

/** One-line human summary of the agent's effective configuration. */
export const describeAgentConfig = (config: AgentConfig): string => {
  const enabledScrapers = Object.entries(config.scrapers)
    .filter(([, on]) => on)
    .map(([name]) => name);
  return [
    `network=${config.network}`,
    `host=${config.host}`,
    `chainId=${config.ethereumChainId}`,
    `otlp=${config.otlp.enabled ? `${config.otlp.protocol}->${config.otlp.endpoint}` : "disabled"}`,
    `scrapers=[${enabledScrapers.join(",")}]`,
  ].join(" ");
};
