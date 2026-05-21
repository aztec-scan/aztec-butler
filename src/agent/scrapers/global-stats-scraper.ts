/**
 * Optional global stats scraper.
 *
 * Exports chain-wide state that is NOT host-specific: native/Olla provider
 * queues and the global rollup entry queue. Only ONE agent per network
 * should enable this (BUTLER_AGENT_GLOBAL_STATS_ENABLED=true) — two agents
 * emitting identical global series would create duplicate samples.
 *
 * Global metrics are exported without a `host` label (see agent-metrics.ts).
 */

import { AbstractScraper } from "../../server/scrapers/base-scraper.js";
import type { AgentChainContext } from "../chain.js";
import type { AgentConfig } from "../config.js";
import type { Registry } from "../keys/local-key-loader.js";
import { computeQueueTiming } from "../queue-timing.js";
import {
  getAgentState,
  markScraped,
  type EntryQueueStatsState,
  type ProviderQueueState,
} from "../state.js";

export class GlobalStatsScraper extends AbstractScraper {
  readonly name = "global_stats";
  readonly network: string;

  constructor(
    private readonly config: AgentConfig,
    private readonly chain: AgentChainContext,
  ) {
    super();
    this.network = config.network;
  }

  async scrape(): Promise<void> {
    const state = getAgentState();
    const eth = this.chain.ethClient;
    const nowSec = Math.floor(Date.now() / 1000);

    // ── entry queue ──────────────────────────────────────────────────────
    const entryQueueLength = await eth.getEntryQueueLength();
    const { timePerAttesterSeconds: timePerAttester } = await computeQueueTiming(eth);
    const lastArrival =
      entryQueueLength > 0n && timePerAttester > 0
        ? nowSec + Math.floor(Number(entryQueueLength) * timePerAttester)
        : null;

    const entryQueue: EntryQueueStatsState = {
      queueLength: entryQueueLength,
      timePerAttesterSeconds: timePerAttester,
      lastAttesterArrivalTimestamp: lastArrival,
      lastUpdated: new Date(),
    };
    state.global.entryQueue = entryQueue;

    // ── provider queues ──────────────────────────────────────────────────
    for (const registry of ["native", "olla"] as Registry[]) {
      const provider = this.chain.providers[registry];
      if (!provider || provider.providerId === null) {
        continue;
      }
      try {
        const queueLength = await eth.getProviderQueueLength(provider.providerId, registry);
        const queue = await eth.getProviderQueue(provider.providerId, registry);

        // Rough ETA: an attester entering the rollup entry queue now waits
        // behind the current entry queue. This intentionally ignores
        // provider-queue drip delay and is best-effort telemetry only.
        const nextArrival =
          queueLength > 0n && timePerAttester > 0 ? lastArrival : null;

        const providerState: ProviderQueueState = {
          registry,
          providerId: provider.providerId,
          adminAddress: provider.adminAddress,
          rewardsRecipient: provider.rewardsRecipient,
          queueLength,
          queue,
          nextArrivalTimestamp: nextArrival,
          lastUpdated: new Date(),
        };
        state.global.registries[registry] = providerState;
      } catch (error) {
        console.warn(
          `[${this.name}] Failed to read ${registry} provider queue: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    markScraped("global", this.name);

    const providerSummary = (["native", "olla"] as Registry[])
      .map((r) => {
        const s = state.global.registries[r];
        return s ? `${r}=${s.queueLength}` : null;
      })
      .filter(Boolean)
      .join(" ");
    console.log(
      `[${this.name}] entry_queue=${entryQueueLength} ` +
        `time_per_attester=${timePerAttester.toFixed(1)}s ${providerSummary}`,
    );
  }
}
