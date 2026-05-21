/**
 * In-memory agent state.
 *
 * The agent runs for a single network. State is split explicitly into:
 *   - local state:  facts about THIS host's attesters/publishers
 *   - global state: chain-wide facts (only populated when the global scraper
 *                   is enabled on this host)
 *
 * Scrapers write here; metric observable callbacks read from here.
 */

import type { AttesterView } from "../types/index.js";
import type { AttesterLifecycleState } from "./lifecycle.js";
import type { Registry } from "./keys/local-key-loader.js";

// ── local state ────────────────────────────────────────────────────────────

export interface LocalAttesterRuntimeState {
  attesterAddress: string;
  registry: Registry;
  coinbase?: string;
  publishers: string[];
  lifecycleState: AttesterLifecycleState;
  onChainView?: AttesterView;
  inProviderQueue: boolean;
  providerQueuePosition?: number;
  lastUpdated: Date;
}

export interface LocalPublisherRuntimeState {
  publisherAddress: string;
  balanceWei: bigint;
  requiredTopUpWei: bigint;
  /** Number of local attesters that reference this publisher. */
  attesterCount: number;
  lastUpdated: Date;
}

export interface LocalSequencerState {
  network: string;
  host: string;
  /** keyed by lowercase attester address */
  keys: Map<string, LocalAttesterRuntimeState>;
  /** keyed by lowercase publisher address */
  publishers: Map<string, LocalPublisherRuntimeState>;
  /** per-scraper last successful scrape time (unix seconds) */
  lastScraped: Map<string, number>;
}

// ── global state ───────────────────────────────────────────────────────────

export interface ProviderQueueState {
  registry: Registry;
  providerId: bigint | null;
  adminAddress: string;
  rewardsRecipient: string;
  queueLength: bigint;
  queue: string[];
  /** Estimated unix timestamp (seconds) the next queued attester arrives on-chain. */
  nextArrivalTimestamp: number | null;
  lastUpdated: Date;
}

export interface EntryQueueStatsState {
  queueLength: bigint;
  timePerAttesterSeconds: number;
  lastAttesterArrivalTimestamp: number | null;
  lastUpdated: Date;
}

export interface GlobalSequencerState {
  network: string;
  registries: Partial<Record<Registry, ProviderQueueState>>;
  entryQueue: EntryQueueStatsState | null;
  /** per-scraper last successful scrape time (unix seconds) */
  lastScraped: Map<string, number>;
}

// ── store ──────────────────────────────────────────────────────────────────

export interface AgentState {
  local: LocalSequencerState;
  global: GlobalSequencerState;
}

let store: AgentState | null = null;

/** Initialise (or reset) the agent state for a network/host. */
export const initAgentState = (network: string, host: string): AgentState => {
  store = {
    local: {
      network,
      host,
      keys: new Map(),
      publishers: new Map(),
      lastScraped: new Map(),
    },
    global: {
      network,
      registries: {},
      entryQueue: null,
      lastScraped: new Map(),
    },
  };
  return store;
};

/** Get the agent state. Throws if {@link initAgentState} has not been called. */
export const getAgentState = (): AgentState => {
  if (!store) {
    throw new Error("Agent state not initialised. Call initAgentState() first.");
  }
  return store;
};

/** Record a successful scrape for staleness metrics. */
export const markScraped = (scope: "local" | "global", scraper: string): void => {
  const state = getAgentState();
  const nowSec = Math.floor(Date.now() / 1000);
  state[scope].lastScraped.set(scraper, nowSec);
};
