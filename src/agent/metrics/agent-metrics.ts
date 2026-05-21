/**
 * Agent metric instruments.
 *
 * Label model (PLAN.md §2 / §4):
 *   - LOCAL metrics describe this host -> include a `host` label.
 *   - GLOBAL metrics describe chain-wide state -> MUST NOT include `host`
 *     (otherwise two agents would emit identical-but-host-differing series).
 *
 * {@link localAttributes} / {@link globalAttributes} are the single source of
 * truth for that rule and are unit tested.
 */

import type { Attributes, Meter } from "@opentelemetry/api";
import { PACKAGE_NAME } from "../../core/config/index.js";
import type { AgentConfig } from "../config.js";
import { ATTESTER_LIFECYCLE_STATES } from "../lifecycle.js";
import { getAgentState } from "../state.js";

/** Build attributes for a LOCAL metric — always carries `network` + `host`. */
export const localAttributes = (
  network: string,
  host: string,
  extra: Record<string, string> = {},
): Attributes => ({ network, host, ...extra });

/** Build attributes for a GLOBAL metric — carries `network`, never `host`. */
export const globalAttributes = (
  network: string,
  extra: Record<string, string> = {},
): Attributes => {
  // Defensive: a `host` key must never reach a global series.
  if ("host" in extra) {
    throw new Error("Global metrics must not carry a `host` attribute.");
  }
  return { network, ...extra };
};

const metricName = (suffix: string): string => `${PACKAGE_NAME}_${suffix}`;

/**
 * Register all agent observable gauges against `meter`. Callbacks read live
 * agent state at export time.
 */
export const registerAgentMetrics = (meter: Meter, config: AgentConfig): void => {
  // ── local: attester presence ────────────────────────────────────────────
  const attesterPresent = meter.createObservableGauge(metricName("attester_present"), {
    description: "1 for each attester whose registered-key file is present on this host",
  });
  attesterPresent.addCallback((result) => {
    const { local } = getAgentState();
    for (const key of local.keys.values()) {
      result.observe(
        1,
        localAttributes(local.network, local.host, {
          registry: key.registry,
          attester_address: key.attesterAddress,
        }),
      );
    }
  });

  // ── local: coinbase configured ──────────────────────────────────────────
  const coinbaseConfigured = meter.createObservableGauge(
    metricName("attester_coinbase_configured"),
    { description: "1 when the local attester has a coinbase configured, 0 otherwise" },
  );
  coinbaseConfigured.addCallback((result) => {
    const { local } = getAgentState();
    for (const key of local.keys.values()) {
      result.observe(
        key.coinbase ? 1 : 0,
        localAttributes(local.network, local.host, {
          registry: key.registry,
          attester_address: key.attesterAddress,
        }),
      );
    }
  });

  // ── local: lifecycle state ──────────────────────────────────────────────
  const lifecycleState = meter.createObservableGauge(
    metricName("attester_lifecycle_state"),
    { description: "1 for the attester's current lifecycle state (one series per attester)" },
  );
  lifecycleState.addCallback((result) => {
    const { local } = getAgentState();
    for (const key of local.keys.values()) {
      result.observe(
        1,
        localAttributes(local.network, local.host, {
          registry: key.registry,
          attester_address: key.attesterAddress,
          state: key.lifecycleState,
        }),
      );
    }
  });

  // ── local: provider queue membership ────────────────────────────────────
  const providerQueueMembership = meter.createObservableGauge(
    metricName("attester_provider_queue_membership"),
    { description: "1 when the local attester is in its registry's staking-provider queue" },
  );
  providerQueueMembership.addCallback((result) => {
    const { local } = getAgentState();
    for (const key of local.keys.values()) {
      result.observe(
        key.inProviderQueue ? 1 : 0,
        localAttributes(local.network, local.host, {
          registry: key.registry,
          attester_address: key.attesterAddress,
        }),
      );
    }
  });

  // ── local: publisher balances ───────────────────────────────────────────
  const publisherBalance = meter.createObservableGauge(metricName("publisher_balance_wei"), {
    description: "L1 ETH balance of a local publisher address, in wei",
    unit: "wei",
  });
  publisherBalance.addCallback((result) => {
    const { local } = getAgentState();
    for (const pub of local.publishers.values()) {
      result.observe(
        Number(pub.balanceWei),
        localAttributes(local.network, local.host, { publisher_address: pub.publisherAddress }),
      );
    }
  });

  const publisherTopUp = meter.createObservableGauge(
    metricName("publisher_required_topup_wei"),
    { description: "ETH top-up required to fund a local publisher, in wei (0 when funded)", unit: "wei" },
  );
  publisherTopUp.addCallback((result) => {
    const { local } = getAgentState();
    for (const pub of local.publishers.values()) {
      result.observe(
        Number(pub.requiredTopUpWei),
        localAttributes(local.network, local.host, { publisher_address: pub.publisherAddress }),
      );
    }
  });

  // ── local: scrape freshness ─────────────────────────────────────────────
  const localScraped = meter.createObservableGauge(
    metricName("local_last_scraped_timestamp"),
    { description: "Unix timestamp of the last successful local scrape", unit: "s" },
  );
  localScraped.addCallback((result) => {
    const { local } = getAgentState();
    for (const [scraper, ts] of local.lastScraped) {
      result.observe(ts, localAttributes(local.network, local.host, { scraper }));
    }
  });

  // Global metrics are only emitted by the designated global-stats agent.
  if (config.scrapers.globalStats) {
    registerGlobalMetrics(meter);
  }
};

/** Register the chain-wide (host-less) metrics. */
const registerGlobalMetrics = (meter: Meter): void => {
  const entryQueueLength = meter.createObservableGauge(
    metricName("global_entry_queue_length"),
    { description: "Total attesters waiting in the global rollup entry queue" },
  );
  entryQueueLength.addCallback((result) => {
    const { global } = getAgentState();
    if (global.entryQueue) {
      result.observe(Number(global.entryQueue.queueLength), globalAttributes(global.network));
    }
  });

  const entryQueueLastArrival = meter.createObservableGauge(
    metricName("global_entry_queue_last_attester_timestamp"),
    {
      description: "Estimated unix timestamp the last attester in the global entry queue activates",
      unit: "s",
    },
  );
  entryQueueLastArrival.addCallback((result) => {
    const { global } = getAgentState();
    if (global.entryQueue?.lastAttesterArrivalTimestamp != null) {
      result.observe(
        global.entryQueue.lastAttesterArrivalTimestamp,
        globalAttributes(global.network),
      );
    }
  });

  const providerQueueLength = meter.createObservableGauge(
    metricName("global_provider_queue_length"),
    { description: "Length of a staking provider's queue (per registry)" },
  );
  providerQueueLength.addCallback((result) => {
    const { global } = getAgentState();
    for (const provider of Object.values(global.registries)) {
      result.observe(
        Number(provider.queueLength),
        globalAttributes(global.network, { registry: provider.registry }),
      );
    }
  });

  const providerNextArrival = meter.createObservableGauge(
    metricName("global_provider_next_arrival_timestamp"),
    {
      description: "Estimated unix timestamp the provider's next queued attester activates",
      unit: "s",
    },
  );
  providerNextArrival.addCallback((result) => {
    const { global } = getAgentState();
    for (const provider of Object.values(global.registries)) {
      if (provider.nextArrivalTimestamp != null) {
        result.observe(
          provider.nextArrivalTimestamp,
          globalAttributes(global.network, { registry: provider.registry }),
        );
      }
    }
  });

  const globalScraped = meter.createObservableGauge(
    metricName("global_last_scraped_timestamp"),
    { description: "Unix timestamp of the last successful global scrape", unit: "s" },
  );
  globalScraped.addCallback((result) => {
    const { global } = getAgentState();
    for (const [scraper, ts] of global.lastScraped) {
      result.observe(ts, globalAttributes(global.network, { scraper }));
    }
  });
};
