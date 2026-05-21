import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OTLP_ENDPOINT,
  assertReadOnlyEnv,
  buildAgentConfig,
} from "../../src/agent/config.js";

/** A minimal valid agent env. */
function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    BUTLER_AGENT_HOST: "beast-4",
    ETHEREUM_CHAIN_ID: "1",
    ETHEREUM_NODE_URL: "https://eth.example.com",
    AZTEC_NODE_URL: "http://aztec.example.com:8080",
    ...overrides,
  };
}

test("builds a valid agent config with sane defaults", () => {
  const config = buildAgentConfig(validEnv(), "mainnet");
  assert.equal(config.network, "mainnet");
  assert.equal(config.host, "beast-4");
  assert.equal(config.ethereumChainId, 1);
  assert.equal(config.otlp.enabled, true);
  assert.equal(config.otlp.endpoint, DEFAULT_OTLP_ENDPOINT);
  assert.equal(config.otlp.protocol, "http/protobuf");
  // Duplicate-exporter guard: global stats must be OPT-IN, never default-on.
  assert.equal(config.scrapers.globalStats, false);
  assert.equal(config.scrapers.localKeys, true);
});

test("fails closed when SAFE_PROPOSALS_ENABLED is true", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ SAFE_PROPOSALS_ENABLED: "true" }), "mainnet"),
    /agent mode is read-only/i,
  );
});

test("fails closed when a private key is present", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ MULTISIG_PROPOSER_PRIVATE_KEY: "0xabc" }), "mainnet"),
    /must not be given private keys/i,
  );
});

test("fails closed when SAFE_API_KEY is present", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ SAFE_API_KEY: "secret" }), "mainnet"),
    /does not use the Safe API/i,
  );
});

test("assertReadOnlyEnv passes for a clean env", () => {
  assert.doesNotThrow(() => assertReadOnlyEnv(validEnv()));
});

test("requires BUTLER_AGENT_HOST", () => {
  const env = validEnv();
  delete env.BUTLER_AGENT_HOST;
  assert.throws(() => buildAgentConfig(env, "mainnet"), /BUTLER_AGENT_HOST is required/);
});

test("requires a valid ETHEREUM_CHAIN_ID", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ ETHEREUM_CHAIN_ID: "not-a-number" }), "mainnet"),
    /ETHEREUM_CHAIN_ID/,
  );
});

test("rejects grpc protocol (not bundled in this build)", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ BUTLER_AGENT_OTLP_PROTOCOL: "grpc" }), "mainnet"),
    /grpc is not bundled/,
  );
});

test("rejects an unknown OTLP protocol", () => {
  assert.throws(
    () => buildAgentConfig(validEnv({ BUTLER_AGENT_OTLP_PROTOCOL: "carrier-pigeon" }), "mainnet"),
    /BUTLER_AGENT_OTLP_PROTOCOL/,
  );
});

test("global stats can be explicitly enabled", () => {
  const config = buildAgentConfig(
    validEnv({ BUTLER_AGENT_GLOBAL_STATS_ENABLED: "true" }),
    "mainnet",
  );
  assert.equal(config.scrapers.globalStats, true);
});

test("scraper toggles honour explicit false", () => {
  const config = buildAgentConfig(
    validEnv({
      BUTLER_AGENT_PUBLISHER_BALANCES_ENABLED: "false",
      BUTLER_AGENT_OTLP_ENABLED: "false",
    }),
    "mainnet",
  );
  assert.equal(config.scrapers.publisherBalances, false);
  assert.equal(config.otlp.enabled, false);
});
