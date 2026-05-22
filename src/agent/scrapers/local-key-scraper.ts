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

      if (existing) {
        // Mutate in place: refresh the placement facts (registry / coinbase /
        // publishers) from the file and leave the on-chain enrichment alone.
        // Replacing the object would orphan writes the status / eta scrapers
        // make to a reference they captured before their own `await`.
        existing.attesterAddress = key.attesterAddress;
        existing.registry = key.registry;
        existing.publishers = key.publishers;
        if (key.coinbase) existing.coinbase = key.coinbase;
        else delete existing.coinbase;
        existing.lastUpdated = now;
      } else {
        const created: LocalAttesterRuntimeState = {
          attesterAddress: key.attesterAddress,
          registry: key.registry,
          publishers: key.publishers,
          lifecycleState: "NEW",
          inProviderQueue: false,
          lastUpdated: now,
        };
        if (key.coinbase) created.coinbase = key.coinbase;
        state.local.keys.set(addrKey, created);
      }
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
      if (existing) {
        // Mutate in place: refresh membership facts and leave balanceWei /
        // requiredTopUpWei alone — the balance scraper writes those to a
        // reference it captured before its own `await`.
        existing.publisherAddress = publisherAddress;
        existing.attesterCount = attesterCount;
        existing.lastUpdated = now;
      } else {
        const created: LocalPublisherRuntimeState = {
          publisherAddress,
          balanceWei: 0n,
          requiredTopUpWei: 0n,
          attesterCount,
          lastUpdated: now,
        };
        state.local.publishers.set(pubKey, created);
      }
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
