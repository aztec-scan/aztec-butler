import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentConfig } from "../../src/agent/config.js";
import { registerAgentMetrics } from "../../src/agent/metrics/agent-metrics.js";
import { initAgentMeterProvider } from "../../src/agent/metrics/otlp.js";
import { getAgentState, initAgentState } from "../../src/agent/state.js";

/**
 * Integration check for the metrics + OTLP pipeline that needs no network:
 * populate agent state, register the instruments, and flush. Exercises the
 * real OpenTelemetry SDK (observable callbacks, ConsoleMetricExporter) and
 * verifies the OTLP exporter wiring constructs cleanly.
 */

function config(mode = "all", overrides: Record<string, string | undefined> = {}) {
  return buildAgentConfig(
    {
      BUTLER_AGENT_HOST: "test-host",
      ETHEREUM_CHAIN_ID: "1",
      ETHEREUM_NODE_URL: "https://eth.example.com",
      AZTEC_NODE_URL: "http://aztec.example.com:8080",
      ...overrides,
    },
    "mainnet",
    mode,
  );
}

test("metrics pipeline registers and flushes without throwing (all mode)", async () => {
  initAgentState("mainnet", "test-host");
  const state = getAgentState();
  state.local.keys.set("0xaa01", {
    attesterAddress: "0xaa01",
    registry: "olla",
    coinbase: "0xcc01",
    publishers: ["0xbb01"],
    lifecycleState: "ACTIVE",
    inProviderQueue: false,
    lastUpdated: new Date(),
  });
  state.local.publishers.set("0xbb01", {
    publisherAddress: "0xbb01",
    balanceWei: 123_000_000_000_000_000n,
    requiredTopUpWei: 0n,
    attesterCount: 1,
    lastUpdated: new Date(),
  });
  state.global.entryQueue = {
    queueLength: 42n,
    timePerAttesterSeconds: 60,
    lastAttesterArrivalTimestamp: 1_760_000_000,
    lastUpdated: new Date(),
  };

  // dryRun -> ConsoleMetricExporter, so no network is touched.
  const provider = initAgentMeterProvider(config("all"), { dryRun: true });
  registerAgentMetrics(provider.meter, config("all"));

  await provider.forceFlush();
  await provider.shutdown();
});

test("global mode registers only global instruments", async () => {
  initAgentState("mainnet", "");
  const provider = initAgentMeterProvider(config("global"), { dryRun: true });
  // Should not throw — global mode skips local instruments entirely.
  registerAgentMetrics(provider.meter, config("global"));
  await provider.forceFlush();
  await provider.shutdown();
});

test("OTLP meter provider constructs and shuts down cleanly", async () => {
  initAgentState("mainnet", "test-host");
  // Not dryRun: builds the real OTLPMetricExporter. shutdown() must not
  // require the collector to be reachable.
  const provider = initAgentMeterProvider(config("all"), { exportIntervalMs: 600_000 });
  registerAgentMetrics(provider.meter, config("all"));
  await provider.shutdown();
});
