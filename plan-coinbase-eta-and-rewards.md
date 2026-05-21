# Plan: Missing-Coinbase ETA + Chain-Derived Rewards Scraper

Two follow-on features for the agent (`PLAN.md`):

- **Part 1** — Missing-coinbase ETA: tell operators *how long they have* to set a
  coinbase before a local attester activates without one.
- **Part 2** — Rewards scraper: per-coinbase staking-rewards telemetry, with the
  Google Sheets export split out as a separate, credentialed downstream consumer.

The two parts are independent and can be implemented/shipped separately.

---

## Deployment topology

Confirmed placement. This is a **deployment choice** — the agent's per-scraper
toggles already support it, so it needs no code change beyond one minor
refinement noted below.

| Host | Process | Scrapers | Key files present? |
|---|---|---|---|
| Sequencer nodes (beast-3, beast-4) | `aztec-butler agent` | **local only** — local keys, local status, publisher balances, entry-queue ETA | Yes — each node's **own** files only |
| Monitoring server (`m.aztlanlabs.xyz`) | `aztec-butler agent` (global-only) | **global only** — global stats + rewards (Part 2 Phase A); local scrapers off | **No** |
| Monitoring server | `aztec-butler sheets-exporter` | — (queries Prometheus) | **No** |

Rationale:

- The monitoring server already runs **Prometheus 2.45.0** (`:9090`, 30 d
  retention) and **Grafana**, already hosts the butler, and already has the GCP
  credential + archive RPC configured. It is the natural home for everything
  chain-global and for the credentialed Sheets job.
- Global stats and rewards are **chain-wide reads** — no reason to run them on a
  sequencer node. Running them on the monitoring server makes it the **single,
  unambiguous global exporter** per network (this supersedes the earlier
  "beast-3 vs beast-4 for global stats" question).
- The monitoring-server agent runs with `BUTLER_AGENT_LOCAL_KEYS_ENABLED=false`
  and the other local toggles off; only `BUTLER_AGENT_GLOBAL_STATS_ENABLED` and
  `BUTLER_AGENT_REWARDS_STATS_ENABLED` are on.

**Key-file rule (hard requirement).** Registered-key files live **only on the
sequencer node that owns them**, read locally by that node's own agent. They are
never synced, aggregated, or copied to another server. The monitoring server
needs **zero** key files: global stats are chain reads, rewards coinbases are
derived from `StakedWithProvider` chain events, and the Sheets exporter only
queries Prometheus. The current aztlan-ops `monitoring_server` role copies every
host's `files/aztec/<network>/<host>/*.json` onto the monitoring server for
`serve` mode — **those copy tasks are removed** by this migration.

**Minor code refinement:** make `BUTLER_AGENT_HOST` optional when all local
scrapers are disabled — a global-only agent has no host identity (and global
metrics carry no `host` label anyway).

---

# Part 1 — Missing-Coinbase ETA

## Goal

Restore the server's `entry_queue_provider_next_missing_coinbase_timestamp` — the
metric the old README called *"the most critical metric for operations"* — in the
agent model, computed **per host** so each agent reports its own attesters.

## The local↔global problem

The ETA needs two facts joined:

- **local**: which of this host's attesters lack a coinbase (already known —
  `local-key-scraper`)
- **global**: each attester's *position* in the global rollup entry queue, and
  the queue's drain rate

In the old single-process server these lived together. In the agent model the
global entry queue is only *exported* by one host (the monitoring server). The
ETA, however, is host-specific (it's about *your* attesters).

### Resolution

**Reading the entry queue is not the same as exporting a global metric.** Every
sequencer-node agent may *read* `getEntryQueueAt(...)` to locate its own
attesters — the read is cheap and read-only. Only the **global aggregate**
(`global_entry_queue_length`) must stay single-source.

- Each sequencer-node agent computes ETAs for **its own** attesters and emits
  **host-labelled** series. Attester sets are disjoint across hosts, so there is
  no duplicate-series problem.
- An attester deliberately run on two hosts (HA) correctly yields two series
  distinguished by `host` — a feature, not a collision.

## Design

### New scraper: `LocalEntryQueueEtaScraper` (local scope)

A **local** scraper — it runs on each sequencer-node agent (off on the
monitoring-server agent, which has local scrapers disabled). On its own (slower)
interval:

1. Fetch the ordered global entry queue, **stopping early** once every local
   attester has been located (you only need the queue up to your last attester's
   position — see RPC-cost note).
2. Fetch epoch duration, entry-queue flush size, and L2 block time →
   `timePerAttester = epochDurationSeconds / flushSize`.
3. For each local attester found in the queue: record `position` and
   `etaTimestamp = now + position * timePerAttester`.
4. Write `entryQueuePosition` / `entryQueueEtaTimestamp` into the existing
   `LocalAttesterRuntimeState`.

`timePerAttester` math and the Aztecscan L2-block-time fetch currently live
inside `global-stats-scraper.ts` — extract them to a shared `src/agent/queue-timing.ts`
so both scrapers share one implementation.

### Metrics (local, host-labelled)

```text
aztec_butler_attester_entry_queue_position{
  network, host, registry, attester_address
}                                                    # 0 = next to activate

aztec_butler_attester_entry_queue_eta_timestamp{
  network, host, registry, attester_address
}                                                    # unix ts of estimated activation

aztec_butler_next_missing_coinbase_eta_timestamp{
  network, host, attester_address
}                                                    # convenience: the SOONEST local
                                                     # attester that is in the entry
                                                     # queue AND has no coinbase
```

The first two are the source of truth (raw per-attester facts). The third is a
pre-joined convenience series — the headline ops metric — so alerting needs no
PromQL join (a single-series alert target is more robust). The agent already has
both inputs locally (coinbase presence + ETA); the join is trivial and cheap.

### Config

```text
BUTLER_AGENT_ENTRY_QUEUE_ETA_ENABLED=true            # default true (a local scraper)
BUTLER_AGENT_ENTRY_QUEUE_ETA_INTERVAL_MS=120000      # default 120s
```

Coinbase ETAs move slowly (the queue drains ~`flushSize` per epoch), so a 120 s
interval is ample and keeps RPC load low.

## RPC cost

`getAllQueuedAttesters()` is an index-by-index loop (`N+1` calls). Every
sequencer-node agent now reads the queue, so cost matters:

- **Primary mitigation — early stop:** scan from index 0 and stop once all local
  attesters are located. Cost is bounded by *your last attester's position*, not
  the full queue length. Add `getQueuedAttestersUntilAllFound(targets)` to
  `EthereumClient`, or a `maxIndex` parameter.
- **Optional — multicall batching:** `getEntryQueueAt` calls can be batched via
  viem multicall to cut round-trips. Worth doing if queues grow into the thousands.

## Edge cases

| Case | Behaviour |
|---|---|
| Local attester not in the entry queue | No position/ETA emitted for it |
| `timePerAttester == 0` (flushSize 0 / not bootstrapped) | Emit `position` only, skip ETA |
| Attester in queue *with* a coinbase | ETA still emitted; just not eligible for the convenience metric |
| No local coinbase-less attester in the queue | Convenience metric absent (absent = healthy) |

## Implementation outline (Part 1)

1. `src/agent/queue-timing.ts` — extract `fetchL2BlockTimeMs` + `computeTimePerAttester` (shared).
2. `src/core/components/EthereumClient.ts` — add early-stop queue read.
3. `src/agent/state.ts` — add `entryQueuePosition?` / `entryQueueEtaTimestamp?` to `LocalAttesterRuntimeState`.
4. `src/agent/scrapers/entry-queue-eta-scraper.ts` — new `LocalEntryQueueEtaScraper`.
5. `src/agent/metrics/agent-metrics.ts` — add the three metrics above.
6. `src/agent/config.ts` — add the two config fields.
7. `src/agent/index.ts` — register the scraper; refactor `global-stats-scraper.ts` onto `queue-timing.ts`.
8. `tests/unit/agent-entry-queue-eta.test.ts` — position→ETA math, missing-coinbase selection, edge cases.
9. `docs/agent-deployment.md` — document the metrics + an example alert.

---

# Part 2 — Chain-Derived Rewards Scraper

## Goal

Per-coinbase staking-rewards telemetry, split into two **separate processes**:

- **Phase A** — *rewards scraper*: the single rewards scrape. Read-only,
  credential-free; emits rewards metrics over OTLP.
- **Phase B** — *Sheets exporter*: a separate, credentialed **consumer** that
  reads Phase A's metrics from Prometheus and writes the daily reward accounting
  to Google Sheets.

Phase A never touches Sheets. Phase B never scrapes chain and never emits metrics.
There is exactly **one** rewards scrape (Phase A); Phase B is a pure downstream
consumer. Both run on the monitoring server (see Deployment topology).

## Non-goals

- Running rewards on every host — it is global/provider-level; **one instance per
  network**, on the monitoring server.
- Credentials or external writes anywhere near the sequencer-node agents.
- A second rewards scrape — Phase A is the sole producer; Phase B only consumes.
- Any key files on the monitoring server.

## Registry scope

The rewards path is **registry-agnostic**, exactly as today's `StakingRewardsScraper`
is — it computes rewards for whatever coinbases exist. Olla is **out of scope**:
Olla rewards are tracked separately, outside this tool. Metrics are keyed by
`coinbase` only — no `registry` label (see Resolved Decisions Q1).

---

## Phase A — Rewards scraper → OTLP metrics

A new global scraper inside the agent, opt-in, running on the **monitoring-server
agent** (global-only mode — see Deployment topology), alongside the global-stats
scraper.

### A1. Coinbase discovery from chain (no key-file sync)

Coinbases are discovered **purely from chain events** — no key files on the
monitoring server. The native StakingRegistry emits:

```solidity
event StakedWithProvider(
  uint256 indexed providerIdentifier,
  address indexed rollupAddress,
  address indexed attester,
  address coinbaseSplitContractAddress,
  address stakerImplementation
)
```

It is **indexed by `providerIdentifier`**, so a `getLogs` filtered to *our*
provider ID returns exactly our `attester → coinbase` mappings — globally
complete, from chain alone.

- Reuse the event-scanning machinery in `src/core/components/CoinbaseScraper.ts`,
  adapted to a **discover-all mode**: drop its `attesterAddresses` pre-filter —
  the `providerIdentifier`-indexed `getLogs` already scopes results to our
  provider, and there is no attester list to filter against.
- The unique set of `coinbaseSplitContractAddress` is our coinbase set.
- Requires **archive RPC** for the historical event scan →
  `ETHEREUM_ARCHIVE_NODE_URL` becomes **required** when rewards stats are enabled
  (validate this in `buildAgentConfig`). The monitoring server already has an
  archive RPC URL configured.
- Incremental scan from `STAKING_REWARDS_SPLIT_FROM_BLOCK`, with a **rebuildable
  on-disk cursor cache** (`{lastScrapedBlock, mappings}`) to avoid a full re-scan
  on restart (Resolved Decisions Q4). It is a pure performance cache —
  reconstructable from chain, never a source of truth, never copied between
  servers. `CoinbaseScraper` already has `loadCoinbaseCache`/`saveCoinbaseCache`.

`StakedWithProvider` is a native-registry event. **Olla is out of scope** — Olla
rewards are tracked separately, outside this tool, so there is no Olla coinbase
handling here (Resolved Decisions Q1).

### A2. Reward token & per-coinbase computation

**Reward token:** resolved on-chain at init — the rollup's staking asset,
confirmed on mainnet to be **AZTEC `0xa27ec0006e59f245217ff08cd52a7e8b169e62d2`**.
Read `decimals()` from the token contract once at init and scale by it; do **not**
hardcode (testnet uses a different token). An optional `REWARD_TOKEN_ADDRESS`
override is allowed.

Per coinbase, compute **current** values only (no backfill in Phase A):

- pending rewards for the coinbase (current rollup)
- latest split allocation (`SplitUpdated` event) → recipients + allocations
- our share = `pending * ourAllocation / totalAllocation`, where "ours" is the
  provider's `rewardsRecipient` (already resolved in `initAgentChain`) or a
  configured `SAFE_ADDRESS`

Extract the live per-coinbase computation from the server's `StakingRewardsScraper`
into a reusable `src/core/components/rewards-compute.ts`. The server's backfill,
rollup-version timeline, and history persistence are **not** part of Phase A.

### A3. Metrics (global — no `host`, no `registry`)

```text
aztec_butler_staking_rewards_pending_aztec{network, coinbase}
aztec_butler_staking_rewards_our_share_aztec{network, coinbase}
aztec_butler_staking_rewards_earned_aztec{network, coinbase}      # cumulative counter
```

- Values are in **whole AZTEC** (float — the raw amount divided by `10^decimals`).
  This is dashboard-friendly and avoids the `2^53` precision ceiling that raw
  base-units would hit.
- `earned` is a monotonic **ObservableCounter**, computed from an **in-memory**
  last-`our_share` map (sum of positive deltas — accrual, ignoring drops from
  claims). On restart the map empties and the counter resets to 0; Prometheus
  `rate()`/`increase()` are reset-aware, so this needs no disk persistence.

### A4. Config (Phase A)

```text
BUTLER_AGENT_REWARDS_STATS_ENABLED=false             # opt-in; on for the monitoring-server agent
BUTLER_AGENT_REWARDS_INTERVAL_MS=3600000             # default 1h
STAKING_REWARDS_SPLIT_FROM_BLOCK=...                 # existing — event-scan start block
ETHEREUM_ARCHIVE_NODE_URL=...                        # REQUIRED when rewards enabled
REWARD_TOKEN_ADDRESS=...                             # optional override; default = rollup staking asset
```

Enabled on the **monitoring-server agent** only — the single global exporter per
network (see Deployment topology).

### Implementation outline (Phase A)

1. `src/core/components/rewards-compute.ts` — extract live pending+split→share computation; resolve reward token + decimals.
2. Adapt `CoinbaseScraper` for discover-all mode (drop attester pre-filter).
3. `src/agent/scrapers/rewards-scraper.ts` — `RewardsStatsScraper`.
4. `src/agent/state.ts` — per-coinbase rewards state + in-memory `earned` deltas.
5. `src/agent/metrics/agent-metrics.ts` — add the three rewards metrics (global section).
6. `src/agent/config.ts` — add Phase A config; require archive RPC when enabled; make `BUTLER_AGENT_HOST` optional when local scrapers are off.
7. `src/agent/index.ts` — register the scraper when enabled.
8. `tests/unit/agent-rewards.test.ts` — share math, decimals scaling, earned-counter deltas (claim drop + restart reset).
9. `docs/agent-deployment.md` — document metrics + the single-exporter rule.

---

## Phase B — Google Sheets exporter (separate downstream consumer)

A separate runtime mode — **not** part of the agent:

```bash
aztec-butler sheets-exporter --network mainnet
```

Phase B is a **pure downstream consumer**. It does **not** scrape chain — Phase A
is the single rewards scrape. Phase B reads the rewards metrics Phase A already
produced and writes the daily accounting to Google Sheets. One scrape, Sheets as
a separate consumer.

### B1. Source: the monitoring server's Prometheus

Phase A pushes `staking_rewards_*_aztec` via OTLP → collector → the monitoring
server's **Prometheus 2.45.0** (`:9090`, the same store Grafana queries). Phase B
runs on the **same host** as that Prometheus, so it queries it over **localhost**:
`http://localhost:9090/api/v1/query_range`. No new infrastructure, no network
exposure, no auth — it reads a store that must already exist for Grafana to work.
30 d Prometheus retention is ample for a daily export.

### B2. Daily aggregates via range queries

The four existing Sheets outputs map to range queries over the
`staking_rewards_*_aztec` series:

| Sheets output | Source query (sketch) |
|---|---|
| Daily total | daily aggregate of `staking_rewards_pending_aztec` / `our_share_aztec` |
| Coinbases | label values of `coinbase` |
| Daily per coinbase | daily aggregate grouped by `coinbase` |
| Daily earned | `increase(staking_rewards_earned_aztec[1d])` per coinbase |

Phase A samples hourly, so Prometheus holds hourly resolution — daily aggregates
are accurate, including earnings that accrue and are claimed within a day (Phase
A's `earned` counter already captures that).

### B3. Config (Phase B)

```text
SHEETS_EXPORTER_METRICS_QUERY_URL=http://localhost:9090   # co-located Prometheus
SHEETS_EXPORTER_METRICS_QUERY_AUTH=                       # unused for localhost
SHEETS_EXPORTER_INTERVAL_MS=86400000                      # default daily
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=...                       # existing — already on the monitoring server
GOOGLE_SHEETS_SPREADSHEET_ID=...                          # existing
GOOGLE_SHEETS_RANGE / *_COINBASES_RANGE / ...             # existing
```

No chain RPC, no archive RPC, no persistence, no key files — Google Sheets is
append-only and is its own historical record.

### B4. Deployment

- Its own systemd unit (`aztec-butler-sheets-exporter`), one instance per network.
- Runs on the **monitoring server**, co-located with Prometheus (localhost query)
  and with the GCP credential + Sheets config that already exist there. No
  credentials touch the sequencer nodes.

### Implementation outline (Phase B)

1. `src/sheets-exporter/metrics-query.ts` — minimal Prometheus query-API client.
2. `src/sheets-exporter/aggregates.ts` — query results → the four daily aggregate shapes.
3. `src/sheets-exporter/index.ts` — entrypoint: query → aggregate → write Sheets, on a schedule.
4. `src/index.ts` — add the `sheets-exporter` CLI command.
5. `daemon/install-sheets-exporter.sh` — systemd installer.
6. `docs/` — deployment + config docs.

---

## Migration

- Google Sheets is append-only — **existing historical rows stay**.
- `serve` keeps running rewards until Phase A is live, then disable it there
  (never run two rewards metric emitters — one instance per network). Phase B
  consumes Prometheus and may run once Phase A has populated it.
- The old `staking-rewards-history.json` + chain backfill exist only for data
  predating the tool. In the new model Prometheus is the history. If pre-existing
  history is needed, that is a **one-time** backfill — not part of either
  recurring service.
- **aztlan-ops `monitoring_server` role** gets *simpler*: the "Discover butler
  registered key files" and "Copy butler registered key files to data directory"
  tasks are **removed** (no key files on the monitoring server), and the
  `files/aztec/<network>/<host>/*.json` files are dropped from the Ansible repo.
  New units: a global-only `aztec-butler agent` and an `aztec-butler-sheets-exporter`
  per network.

---

## Resolved decisions

**Q1 — Olla is out of scope.** "Olla rewards" was a speculative addition in the
first draft. `OLLA_REWARDS_COINBASE_ADDRESS` is used only by the
`prepare-deployment` CLI command (`fc24c43`); `StakingRewardsScraper` is entirely
registry-agnostic. Olla rewards are **tracked separately, outside this tool**. →
No `registry` label, no Olla coinbase handling. Native coinbases come from
`StakedWithProvider`; rewards are keyed by `coinbase`.

**Q2 — The metrics backend is the monitoring server's Prometheus.** The repo did
not name it because it is external by design (`PLAN.md`: "central metrics backend
/ Grafana"). It is **Prometheus 2.45.0** on the monitoring server (`:9090`, 30 d
retention) — the same store Grafana queries. → Phase B is co-located with it and
queries it over localhost; it is not new infrastructure. An earlier draft
overcorrected and rewrote Phase B to scrape chain itself — reverted: Phase A is
the sole rewards scrape, Phase B is a pure consumer.

**Q3 — Reward token.** AZTEC, mainnet `0xa27ec0006e59f245217ff08cd52a7e8b169e62d2`.
→ Resolve the reward token + its `decimals()` on-chain at init (from the rollup
staking asset; optional `REWARD_TOKEN_ADDRESS` override). Metrics exported in
whole AZTEC, named `staking_rewards_*_aztec`.

**Q4 — Coinbase cursor cache.** → Keep the rebuildable on-disk cache; do not
full-rescan on restart. It lives on the monitoring server, rebuilt from chain —
never copied between servers.

**Q5 — Deployment topology.** Sequencer-node agents run local scrapers only; the
monitoring server runs a global-only agent (global stats + rewards Phase A) plus
the `sheets-exporter`. Registered-key files stay only on the sequencer node that
owns them — never synced to the monitoring server. The monitoring server is the
single global exporter per network (this supersedes the earlier beast-3-vs-beast-4
question). See Deployment topology.
