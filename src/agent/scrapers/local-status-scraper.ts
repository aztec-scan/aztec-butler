/**
 * Local L1/L2 status scraper.
 *
 * For attesters present on THIS host:
 *   - reads rollup `getAttesterView` (when rollupStatus is enabled)
 *   - checks registry-specific staking-provider queue membership (when
 *     l1Status is enabled)
 *   - derives the common lifecycle state
 *
 * Olla queue reconstruction is event-derived and may need archive RPC.
 */

import { AbstractScraper } from "../../server/scrapers/base-scraper.js";
import type { AttesterView } from "../../types/index.js";
import type { AgentChainContext } from "../chain.js";
import type { AgentConfig } from "../config.js";
import type { Registry } from "../keys/local-key-loader.js";
import { deriveLifecycleState } from "../lifecycle.js";
import { getAgentState, markScraped } from "../state.js";

export class LocalStatusScraper extends AbstractScraper {
  readonly name = "local_status";
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
    if (state.local.keys.size === 0) {
      console.log(`[${this.name}] No local attesters yet — skipping.`);
      return;
    }

    // Which registries actually have local attesters this round.
    const registriesInUse = new Set<Registry>();
    for (const key of state.local.keys.values()) {
      registriesInUse.add(key.registry);
    }

    // Fetch each in-use registry's provider queue once per scrape.
    const queuePositions = new Map<Registry, Map<string, number>>();
    if (this.config.scrapers.l1Status) {
      for (const registry of registriesInUse) {
        const provider = this.chain.providers[registry];
        if (!provider || provider.providerId === null) {
          continue;
        }
        try {
          const queue = await this.chain.ethClient.getProviderQueue(
            provider.providerId,
            registry,
          );
          const positions = new Map<string, number>();
          queue.forEach((addr, index) => positions.set(addr.toLowerCase(), index));
          queuePositions.set(registry, positions);
        } catch (error) {
          console.warn(
            `[${this.name}] Failed to read ${registry} provider queue: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    const lifecycleCounts: Record<string, number> = {};

    for (const [addrKey, runtime] of state.local.keys) {
      let onChainView: AttesterView | null = null;
      if (this.config.scrapers.rollupStatus) {
        try {
          onChainView = await this.chain.ethClient.getAttesterView(runtime.attesterAddress);
        } catch (error) {
          console.warn(
            `[${this.name}] getAttesterView failed for ${runtime.attesterAddress}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const positions = queuePositions.get(runtime.registry);
      const position = positions?.get(addrKey);
      const inProviderQueue = position !== undefined;

      const lifecycleState = deriveLifecycleState({ onChainView, inProviderQueue });

      runtime.lifecycleState = lifecycleState;
      runtime.inProviderQueue = inProviderQueue;
      runtime.lastUpdated = new Date();
      if (onChainView) {
        runtime.onChainView = onChainView;
      } else {
        delete runtime.onChainView;
      }
      if (position !== undefined) {
        runtime.providerQueuePosition = position;
      } else {
        delete runtime.providerQueuePosition;
      }

      lifecycleCounts[lifecycleState] = (lifecycleCounts[lifecycleState] ?? 0) + 1;
    }

    markScraped("local", this.name);
    console.log(
      `[${this.name}] Updated ${state.local.keys.size} attester(s): ${JSON.stringify(lifecycleCounts)}`,
    );
  }
}
