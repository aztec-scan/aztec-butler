/**
 * Local entry-queue ETA scraper.
 *
 * For attesters present on THIS host, finds each one's position in the global
 * rollup entry queue and estimates when it will activate:
 *
 *   etaTimestamp = now + position * timePerAttester
 *
 * Part of the `node`/`all` scraper set. The entry queue is global data, but
 * reading it to locate *this host's* attesters is cheap and read-only — only
 * the exported global aggregate must stay single-source. The queue scan stops
 * early once every local attester has been located (see
 * `getQueuedAttestersUntilAllFound`).
 */

import { AbstractScraper } from "../../server/scrapers/base-scraper.js";
import type { AgentChainContext } from "../chain.js";
import type { AgentConfig } from "../config.js";
import { computeQueueTiming } from "../queue-timing.js";
import { getAgentState, markScraped } from "../state.js";

export class LocalEntryQueueEtaScraper extends AbstractScraper {
  readonly name = "entry_queue_eta";
  readonly network: string;

  constructor(
    config: AgentConfig,
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

    // Locate this host's attesters in the global entry queue. The scan stops
    // once all are found, so cost is bounded by the last attester's position.
    const targets = [...state.local.keys.values()].map((k) => k.attesterAddress);
    const queue = await this.chain.ethClient.getQueuedAttestersUntilAllFound(targets);
    const positions = new Map<string, number>();
    queue.forEach((addr, index) => positions.set(addr.toLowerCase(), index));

    const { timePerAttesterSeconds } = await computeQueueTiming(this.chain.ethClient);
    const nowSec = Math.floor(Date.now() / 1000);

    let inQueue = 0;
    for (const [addrKey, runtime] of state.local.keys) {
      const position = positions.get(addrKey);

      if (position === undefined) {
        // Not in the entry queue — clear any stale position/ETA.
        delete runtime.entryQueuePosition;
        delete runtime.entryQueueEtaTimestamp;
        continue;
      }

      runtime.entryQueuePosition = position;
      if (timePerAttesterSeconds > 0) {
        runtime.entryQueueEtaTimestamp =
          nowSec + Math.floor(position * timePerAttesterSeconds);
      } else {
        // Queue drain rate unknown (e.g. not bootstrapped) — position only.
        delete runtime.entryQueueEtaTimestamp;
      }
      runtime.lastUpdated = new Date();
      inQueue++;
    }

    markScraped("local", this.name);
    console.log(
      `[${this.name}] ${inQueue}/${state.local.keys.size} local attester(s) in the entry queue` +
        (timePerAttesterSeconds > 0
          ? ` (time/attester=${timePerAttesterSeconds.toFixed(1)}s)`
          : " (drain rate unknown — ETA skipped)"),
    );
  }
}
