import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_MODES,
  DEFAULT_OTLP_ENDPOINT,
  buildAgentConfig,
  modeHasGlobalScrapers,
  modeHasLocalScrapers,
} from "../../src/agent/config.js";

/** A minimal valid agent env (includes a host, for node/all modes). */
function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    BUTLER_AGENT_HOST: "beast-4",
    ETHEREUM_CHAIN_ID: "1",
    ETHEREUM_NODE_URL: "https://eth.example.com",
    AZTEC_NODE_URL: "http://aztec.example.com:8080",
    ...overrides,
  };
}

// ── mode helpers ───────────────────────────────────────────────────────────

test("modeHasLocalScrapers — node and all, not global", () => {
  assert.equal(modeHasLocalScrapers("node"), true);
  assert.equal(modeHasLocalScrapers("all"), true);
  assert.equal(modeHasLocalScrapers("global"), false);
});

test("modeHasGlobalScrapers — global and all, not node", () => {
  assert.equal(modeHasGlobalScrapers("global"), true);
  assert.equal(modeHasGlobalScrapers("all"), true);
  assert.equal(modeHasGlobalScrapers("node"), false);
});

test("AGENT_MODES are exactly node, global, all", () => {
  assert.deepEqual([...AGENT_MODES], ["node", "global", "all"]);
});

// ── building config ────────────────────────────────────────────────────────

test("builds a valid node-mode config with sane defaults", () => {
  const config = buildAgentConfig(validEnv(), "mainnet", "node");
  assert.equal(config.network, "mainnet");
  assert.equal(config.mode, "node");
  assert.equal(config.host, "beast-4");
  assert.equal(config.ethereumChainId, 1);
  assert.equal(config.otlp.enabled, true);
  assert.equal(config.otlp.endpoint, DEFAULT_OTLP_ENDPOINT);
  assert.equal(config.otlp.protocol, "http/protobuf");
});

test("builds a valid global-mode config", () => {
  const config = buildAgentConfig(validEnv(), "mainnet", "global");
  assert.equal(config.mode, "global");
});

test("rejects an invalid mode", () => {
  assert.throws(
    () => buildAgentConfig(validEnv(), "mainnet", "monitor"),
    /Invalid agent mode "monitor"/,
  );
});

// ── per-mode host requirement ──────────────────────────────────────────────

test("node mode requires BUTLER_AGENT_HOST", () => {
  const env = validEnv();
  delete env.BUTLER_AGENT_HOST;
  assert.throws(() => buildAgentConfig(env, "mainnet", "node"), /BUTLER_AGENT_HOST is required/);
});

test("all mode requires BUTLER_AGENT_HOST", () => {
  const env = validEnv();
  delete env.BUTLER_AGENT_HOST;
  assert.throws(() => buildAgentConfig(env, "mainnet", "all"), /BUTLER_AGENT_HOST is required/);
});

test("global mode does NOT require BUTLER_AGENT_HOST", () => {
  const env = validEnv();
  delete env.BUTLER_AGENT_HOST;
  const config = buildAgentConfig(env, "mainnet", "global");
  assert.equal(config.mode, "global");
  assert.equal(config.host, undefined);
});

// ── fail-closed safety ─────────────────────────────────────────────────────

test("fails closed when SAFE_PROPOSALS_ENABLED is true", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ SAFE_PROPOSALS_ENABLED: "true" }), "mainnet", "node"),
    /mode is read-only/i,
  );
});

test("fails closed when a private key is present", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ MULTISIG_PROPOSER_PRIVATE_KEY: "0xabc" }), "mainnet", "node"),
    /must not be given private keys/i,
  );
});

test("fails closed when SAFE_API_KEY is present", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ SAFE_API_KEY: "secret" }), "mainnet", "global"),
    /does not use the Safe API/i,
  );
});

// ── other validation ───────────────────────────────────────────────────────

test("requires a valid ETHEREUM_CHAIN_ID", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ ETHEREUM_CHAIN_ID: "not-a-number" }), "mainnet", "node"),
    /ETHEREUM_CHAIN_ID/,
  );
});

test("rejects grpc protocol (not bundled in this build)", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ BUTLER_AGENT_OTLP_PROTOCOL: "grpc" }), "mainnet", "node"),
    /grpc is not bundled/,
  );
});

test("rejects an unknown OTLP protocol", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ BUTLER_AGENT_OTLP_PROTOCOL: "carrier-pigeon" }), "mainnet", "node"),
    /BUTLER_AGENT_OTLP_PROTOCOL/,
  );
});

test("honours BUTLER_AGENT_OTLP_ENABLED=false", () => {
  const config = buildAgentConfig(validEnv({ BUTLER_AGENT_OTLP_ENABLED: "false" }), "mainnet", "all");
  assert.equal(config.otlp.enabled, false);
});

// ── native provider id ─────────────────────────────────────────────────────

test("parses AZTEC_STAKING_PROVIDER_ID as a bigint", () => {
  const config = buildAgentConfig(validEnv({ AZTEC_STAKING_PROVIDER_ID: "4" }), "mainnet", "global");
  assert.equal(config.nativeProviderId, 4n);
});

test("accepts AZTEC_STAKING_PROVIDER_ID=0", () => {
  const config = buildAgentConfig(validEnv({ AZTEC_STAKING_PROVIDER_ID: "0" }), "mainnet", "global");
  assert.equal(config.nativeProviderId, 0n);
});

test("nativeProviderId is undefined when AZTEC_STAKING_PROVIDER_ID is unset", () => {
  const config = buildAgentConfig(validEnv(), "mainnet", "global");
  assert.equal(config.nativeProviderId, undefined);
});

test("rejects a non-integer AZTEC_STAKING_PROVIDER_ID", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ AZTEC_STAKING_PROVIDER_ID: "not-a-number" }), "mainnet", "global"),
    /AZTEC_STAKING_PROVIDER_ID/,
  );
});

test("rejects a negative AZTEC_STAKING_PROVIDER_ID", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ AZTEC_STAKING_PROVIDER_ID: "-1" }), "mainnet", "global"),
    /AZTEC_STAKING_PROVIDER_ID/,
  );
});
