/**
 * Local key scraper.
 *
 * Reads the host-local registered-key files and is the source of truth for
 * what is actually deployed on this sequencer. It populates key presence,
 * registry, coinbase and publisher assignment; the status scraper later
 * enriches each entry with on-chain data.
 */

import { AbstractScraper } from "../../server/scrapers/base-scraper.js";
import type { AgentConfig } from "../config.js";
import {
  collectLocalPublishers,
  loadLocalRegisteredKeys,
} from "../keys/local-key-loader.js";
import {
  getAgentState,
  markScraped,
  type LocalAttesterRuntimeState,
  type LocalPublisherRuntimeState,
} from "../state.js";

export class LocalKeyScraper extends AbstractScraper {
  readonly name = "local_keys";
  readonly network: string;
  private readonly host: string;

  constructor(config: AgentConfig) {
    super();
    this.network = config.network;
    if (!config.host) {
      // node/all mode always has a host (enforced by buildAgentConfig); this
      // guard makes the invariant explicit for the type system.
      throw new Error("LocalKeyScraper requires BUTLER_AGENT_HOST (node/all mode).");
    }
    this.host = config.host;
  }

  async scrape(): Promise<void> {
    const { keys, filesLoaded, filesSkipped } = await loadLocalRegisteredKeys(
      this.network,
      this.host,
    );

    const state = getAgentState();
    const now = new Date();
    const seenAttesters = new Set<string>();

    for (const key of keys) {
      const addrKey = key.attesterAddress.toLowerCase();
      seenAttesters.add(addrKey);
      const existing = state.local.keys.get(addrKey);

      // Preserve on-chain enrichment from the status scraper; refresh
      // placement facts (registry / coinbase / publishers) from the file.
      const next: LocalAttesterRuntimeState = {
        attesterAddress: key.attesterAddress,
        registry: key.registry,
        publishers: key.publishers,
        lifecycleState: existing?.lifecycleState ?? "NEW",
        inProviderQueue: existing?.inProviderQueue ?? false,
        lastUpdated: now,
      };
      if (key.coinbase) next.coinbase = key.coinbase;
      if (existing?.onChainView) next.onChainView = existing.onChainView;
      if (existing?.providerQueuePosition !== undefined) {
        next.providerQueuePosition = existing.providerQueuePosition;
      }
      state.local.keys.set(addrKey, next);
    }

    // Drop attesters whose key files were removed.
    for (const addrKey of [...state.local.keys.keys()]) {
      if (!seenAttesters.has(addrKey)) {
        state.local.keys.delete(addrKey);
      }
    }

    // Rebuild publisher membership / attester counts.
    const publisherAddrs = collectLocalPublishers(keys);
    const seenPublishers = new Set<string>();
    for (const publisherAddress of publisherAddrs) {
      const pubKey = publisherAddress.toLowerCase();
      seenPublishers.add(pubKey);
      const attesterCount = keys.filter((k) =>
        k.publishers.some((p) => p.toLowerCase() === pubKey),
      ).length;
      const existing = state.local.publishers.get(pubKey);
      const next: LocalPublisherRuntimeState = {
        publisherAddress,
        balanceWei: existing?.balanceWei ?? 0n,
        requiredTopUpWei: existing?.requiredTopUpWei ?? 0n,
        attesterCount,
        lastUpdated: now,
      };
      state.local.publishers.set(pubKey, next);
    }
    for (const pubKey of [...state.local.publishers.keys()]) {
      if (!seenPublishers.has(pubKey)) {
        state.local.publishers.delete(pubKey);
      }
    }

    markScraped("local", this.name);

    const byRegistry = keys.reduce<Record<string, number>>((acc, k) => {
      acc[k.registry] = (acc[k.registry] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `[${this.name}] ${keys.length} local attester(s) across ${filesLoaded.length} file(s) ` +
        `(${JSON.stringify(byRegistry)}), ${publisherAddrs.length} publisher(s)` +
        (filesSkipped.length ? `, skipped ${filesSkipped.length} file(s)` : ""),
    );
  }
}
