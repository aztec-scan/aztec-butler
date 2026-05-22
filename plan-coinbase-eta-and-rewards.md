# Plan: Agent Run Modes + Missing-Coinbase ETA + Chain-Derived Rewards Scraper

This plan covers a prerequisite refactor and two follow-on features for the
agent (`PLAN.md`):

- **Part 0** — Agent run modes: replace the per-scraper boolean toggles with an
  explicit, required `--mode`.
- **Part 1** — Missing-coinbase ETA: tell operators *how long they have* to set a
  coinbase before a local attester activates without one.
- **Part 2** — Rewards scraper: per-coinbase staking-rewards telemetry, with the
  Google Sheets export split out as a separate, credentialed downstream consumer.

Part 0 lands first. Parts 1 and 2 are independent of each other.

---

# Part 0 — Agent run modes (prerequisite refactor)

Replace the agent's per-scraper boolean toggles with an explicit, **required**
`--mode`. This is a refactor of the already-built (but not-yet-deployed) agent —
cheap now, and it makes the deployment model unmisconfigurable.

## Modes — `aztec-butler agent --mode {node|global|all}`

| Mode | Scrapers | Requires | Emits | Where |
|---|---|---|---|---|
| `node` | local keys, local status, publisher balances, entry-queue ETA | `BUTLER_AGENT_HOST` | `host`-labelled local metrics only | every sequencer node |
| `global` | global stats (+ rewards, opt-in) | archive RPC when rewards on; no `HOST` | `network`-labelled global metrics only | exactly one per network (monitoring server) |
| `all` | everything | `HOST` + archive RPC | both | dev / test / single-box only |

- `--mode` is **required** — no default. `agent --network mainnet` with no
  `--mode` errors, so a process can never silently run `all` in production and
  emit duplicate global series.
- The mode selects the **scraper set and the metric-instrument set**. `global`
  mode never registers the local (`host`-labelled) instruments — so the
  phantom-node concern is structurally impossible, not merely avoided. (This
  subsumes the earlier "gate local instruments on local scrapers" refinement.)
- Per-mode validation: `node`/`all` require `BUTLER_AGENT_HOST`; `global`/`all`
  with rewards require archive RPC; `global` has no host identity at all.
- `--once` / `--dry-run` are unchanged — orthogonal run-modifiers.

## Config — toggles deleted

The per-scraper booleans (`BUTLER_AGENT_LOCAL_KEYS_ENABLED`,
`BUTLER_AGENT_L1_STATUS_ENABLED`, `BUTLER_AGENT_ROLLUP_STATUS_ENABLED`,
`BUTLER_AGENT_PUBLISHER_BALANCES_ENABLED`, `BUTLER_AGENT_GLOBAL_STATS_ENABLED`)
are **removed** — the mode determines the scraper set.

The one feature toggle that survives is `BUTLER_AGENT_REWARDS_ENABLED` — it gates
rewards (Part 2 Phase A) *within* `global`/`all` mode, because rewards ships
later and carries extra requirements (archive RPC, AZTEC token). One toggle, not
a soup. Interval config (`BUTLER_AGENT_*_INTERVAL_MS`) stays.

## Why `all` (not `combined`)

`all` is literally accurate (runs all scrapers), short, and unambiguous — and it
does not oversell itself as a production-recommended mode. The real multi-host
topology always uses the `node` + `global` split; `all` is the single-box /
testing option. (`combined` is bland; `standalone` risks reading as the "proper"
mode.)

## Implementation outline (Part 0)

1. `src/agent/config.ts` — replace the scraper booleans with a required `mode` enum; per-mode validation (HOST, archive RPC); keep `BUTLER_AGENT_REWARDS_ENABLED`.
2. `src/agent/index.ts` — add the required `--mode` CLI option; derive the scraper set from the mode.
3. `src/agent/metrics/agent-metrics.ts` — register local vs global instruments by mode.
4. `daemon/install-agent.sh` — pass `--mode`; `scripts/agent-local-test.sh` → `--mode all`.
5. `docs/agent-deployment.md` — rewrite the config section around modes.
6. `tests/unit/agent-config.test.ts` — per-mode validation tests.

> Supersedes the per-scraper-toggle configuration described in `PLAN.md`.

---

## Deployment topology

| Host | Process | Emits | Key files? |
|---|---|---|---|
| Sequencer nodes (beast-3, beast-4) | `aztec-butler agent --mode node` | `host`-labelled local metrics | Yes — each node's **own** files only |
| Monitoring server (`m.aztlanlabs.xyz`) | `aztec-butler agent --mode global` | `network`-labelled global metrics | **No** |
| Monitoring server | `aztec-butler sheets-exporter` | — (queries Prometheus) | **No** |

Rationale:

- The monitoring server already runs **Prometheus 2.45.0** (`:9090`, 30 d
  retention) and **Grafana**, already hosts the butler, and already has the GCP
  credential + archive RPC configured. Natural home for everything chain-global
  and for the credentialed Sheets job.
- Global stats and rewards are **chain-wide reads** — no reason to run them on a
  sequencer node. The monitoring server becomes the **single, unambiguous global
  exporter** per network (this supersedes the earlier "beast-3 vs beast-4"
  question).

**Key-file rule (hard requirement).** Registered-key files live **only on the
sequencer node that owns them**, read locally by that node's own `--mode node`
agent. They are never synced, aggregated, or copied to another server. The
monitoring server needs **zero** key files: global stats are chain reads, rewards
coinbases are derived from `StakedWithProvider` chain events, and the Sheets
exporter only queries Prometheus. The current aztlan-ops `monitoring_server` role
copies every host's `files/aztec/<network>/<host>/*.json` onto the monitoring
server for `serve` mode — **those copy tasks are removed** by this migration.

**The `global` agent is not a node.** `global` mode (Part 0) registers only
global (`network`-labelled) instruments — it is structurally incapable of
emitting a `host`-labelled series, so it never appears in host/node-enumerating
dashboards or per-host alerts. Global-exporter liveness is a separate,
non-conflated signal — `global_last_scraped_timestamp{network,scraper}` (no
`host`). The OTLP resource is `service.name` only (no host, no auto
host-detection), so nothing leaks via `target_info` either.

> Separate known migration item: the existing aztlan-ops aztec-butler
> **dashboards** query the old `serve` metric names and must be rebuilt for the
> new agent metrics. That is "dashboards show nothing until rebuilt" — the
> opposite of a phantom node.

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
global entry queue is only *exported* by the `global` agent. The ETA, however, is
host-specific (it's about *your* attesters).

### Resolution

**Reading the entry queue is not the same as exporting a global metric.** Every
`node`-mode agent may *read* `getEntryQueueAt(...)` to locate its own attesters —
the read is cheap and read-only. Only the **global aggregate**
(`global_entry_queue_length`) must stay single-source.

- Each `node`-mode agent computes ETAs for **its own** attesters and emits
  **host-labelled** series. Attester sets are disjoint across hosts, so there is
  no duplicate-series problem.
- An attester deliberately run on two hosts (HA) correctly yields two series
  distinguished by `host` — a feature, not a collision.

## Design

### New scraper: `LocalEntryQueueEtaScraper`

Part of the `node` mode scraper set (Part 0). On its own (slower) interval:

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
BUTLER_AGENT_ENTRY_QUEUE_ETA_INTERVAL_MS=120000      # default 120s
```

The scraper itself has no enable toggle — it is simply part of `node` mode.
Coinbase ETAs move slowly (the queue drains ~`flushSize` per epoch), so a 120 s
interval is ample and keeps RPC load low.

## RPC cost

`getAllQueuedAttesters()` is an index-by-index loop (`N+1` calls). Every
`node`-mode agent now reads the queue, so cost matters:

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
4. `src/agent/scrapers/entry-queue-eta-scraper.ts` — new `LocalEntryQueueEtaScraper`; add to the `node` scraper set.
5. `src/agent/metrics/agent-metrics.ts` — add the three metrics above (local section).
6. `src/agent/config.ts` — add the interval config field.
7. `src/agent/index.ts` — wire the scraper into `node` mode; refactor `global-stats-scraper.ts` onto `queue-timing.ts`.
8. `tests/unit/agent-entry-queue-eta.test.ts` — position→ETA math, missing-coinbase selection, edge cases.
9. `docs/agent-deployment.md` — document the metrics + an example alert.

---

# Part 2 — Staking-Rewards Telemetry & Accounting

Two separate concerns, two separate processes:

- **Phase A — rewards monitoring** *(implemented)* — a live operational view of
  *pending/unclaimed* rewards, exported by the agent in `global`/`all` mode.
- **Phase B — accounting ledger** — `aztec-butler sheets-exporter`: an
  event-sourced daily ledger of *realized* rewards for financial accounting,
  written to Google Sheets.

They answer different questions. Phase A: "is unclaimed reward piling up — should
we claim?" Phase B: "what did we earn, per day, and how did it split between our
Safe and the other delegate?"

## Why the two are different

Financial accounting must be **replayable, auditable, and not built on sampled
transient state**. The rollup exposes rewards only as `getSequencerRewards(coinbase)`
— a *pending balance* that climbs with accrual and drops to ~0 on claim — and
emits **no reward event**. Sampling that across historical blocks (the old
`StakingRewardsScraper`) is fragile and is what produced the unreliable
`staking-rewards-history.json`.

The ledger is instead built on:

> **`accrued(day) = Δ(Σ getSequencerRewards across all rollup versions) + claims(day)`**

— a daily balance snapshot combined with the immutable claim events. Exact,
self-reconciling, replayable.

## Confirmed on-chain facts (design assumptions)

Verified during planning; the design depends on them:

- Every coinbase reaches the rollup via the native StakingRegistry's
  `StakedWithProvider` event — one event scan discovers the **complete** coinbase
  set. No key files; no non-provider/genesis edge cases.
- Unclaimed sequencer rewards **stay on the old rollup** across an upgrade — no
  carry-over, so no spurious balance jump at migration.
- Old-rollup rewards **remain claimable at all times** — no "stranded" balance.
- The rollup emits **no reward-credit event**; `L2BlockProposed` carries neither
  proposer nor coinbase — so per-block reward reconstruction is impossible.
- Reward token = the rollup's staking asset (`getStakingAsset()`); `decimals()`
  resolved on-chain.

## Registry scope

Native only. Olla rewards are tracked separately, outside this tool. Metrics and
ledger rows are keyed by `coinbase`.

---

## Phase A — Rewards monitoring *(implemented)*

Built and verified against testnet. A `global`/`all`-mode agent scraper, opt-in
via `BUTLER_AGENT_REWARDS_ENABLED`.

- Discovers coinbases from `StakedWithProvider` (CoinbaseScraper discover-all mode).
- Per coinbase: current `getSequencerRewards` + latest split allocation →
  `pending` and `our_share`.
- Metrics (global, no `host`), whole AZTEC:
  - `aztec_butler_staking_rewards_pending_aztec{network, coinbase}`
  - `aztec_butler_staking_rewards_our_share_aztec{network, coinbase}`

This is **operational monitoring** — current pending/unclaimed state, for
dashboards and "time to claim" alerting. It is **not** the accounting record; the
reconstructed `earned` counter was removed — "earned" belongs to the Phase B
ledger.

Config (implemented): `BUTLER_AGENT_REWARDS_ENABLED`,
`BUTLER_AGENT_REWARDS_INTERVAL_MS`, `STAKING_REWARDS_SPLIT_FROM_BLOCK`,
`ETHEREUM_ARCHIVE_NODE_URL` (required when enabled), `REWARD_TOKEN_ADDRESS`
(optional).

---

## Phase B — Accounting ledger → Google Sheets

A separate runtime mode:

```bash
aztec-butler sheets-exporter --network mainnet              # recurring (systemd)
aztec-butler sheets-exporter --network mainnet --backfill   # one-time historical fill
```

Runs on the **monitoring server** — the only component holding the Google
credential. Self-contained: chain RPC + GCP credential + config. No Prometheus,
no key files.

### B1. The ledger

Daily, per coinbase:

| Column | Derivation |
|---|---|
| `accrued` | `Δ(Σ getSequencerRewards over all rollups) + claims that day` |
| `claimed` | sum of reward-token `Transfer`s into the coinbase that day |
| `our_share` / `other_delegate` | `accrued × split%` from `SplitUpdated` (or directly from distribute `Transfer`s) |

Inputs — all chain-derived or config:

| Input | Source |
|---|---|
| Coinbase set | `StakedWithProvider` event scan (provider-filtered) |
| Rollup set | `getRollupTimeline` (`CanonicalRollupUpdated`) — enumerates rollups to sum over |
| Balances | `getSequencerRewards(coinbase)` summed across the rollup set |
| Claims / distributes | reward-token `Transfer` events (`getLogs`) |
| Split % | `SplitUpdated` events per coinbase |
| Our recipient | config — Safe / provider `rewardsRecipient` |

Summing `getSequencerRewards` across **all** rollup versions makes the formula
migration-proof with no per-block dispatch: a not-yet-existing coinbase or an old
rollup contributes 0; a late claim on an old rollup yields `Δ = −X, claims = +X
→ accrued 0`.

### B2. Reliability

- Claims, distributes and the split → **fully event-sourced**, replayable from
  genesis on any RPC.
- Daily `accrued` → uses **current-block** balance reads (reliable — unlike the
  old scraper's historical-state reads) plus events. The day-boundary balances
  must be captured as time passes (persisted cursor); but it **self-reconciles to
  exact totals**, and an outage only coarsens granularity (one lump for the gap),
  never corrupts.

### B3. The Google Sheet is the store

Append-only, durable, the deliverable. There is **no** rewards history file and
**no** rewards data in the Ansible repo — only config. The recurring service
persists a small **cursor** (per-coinbase last balances + last-scanned block) in
the data dir; it is rebuildable by re-running `--backfill`.

### B4. `--backfill` — one-time historical fill

Same code and formula, iterated over historical day-boundaries.

- **Archive RPC required** — historical `getSequencerRewards` reads need archive
  state; public non-archive RPCs cannot serve it.
- **Archive endpoint is configurable** — `SHEETS_EXPORTER_ARCHIVE_RPC_URL`
  (falls back to `ETHEREUM_ARCHIVE_NODE_URL`). dRPC's free tier serves archive
  (verified: its keyless endpoint answers historical `eth_call`) and is the
  expected default, but any archive provider works.
- **Throttling resilience** — the first backfill is thousands of archive calls
  and a free endpoint *will* rate-limit. The backfill must:
  - **self-rate-limit** — a configurable cap (`SHEETS_EXPORTER_MAX_RPS`, low
    default) to stay under the free tier proactively rather than hammering it;
  - **retry with exponential backoff** on 429 / throttle / transient errors —
    never fail the whole run on a throttle;
  - **checkpoint & resume** — persist progress (last completed day) so an
    interrupted or throttled run continues instead of restarting;
  - keep request **concurrency low** (sequential or a small bounded pool).
- Sums `getSequencerRewards` across the rollup *set* — no per-block routing.
- **Idempotent** — writes the historical range by overwriting from the top, so
  re-running (e.g. after a fix) just rewrites the same rows.
- Run as a one-off command **on the monitoring server**; it fills the Sheet and
  leaves the cursor for the recurring service. Long-running — run under `tmux`.

### B5. Config (Phase B)

```text
SHEETS_EXPORTER_INTERVAL_MS=86400000              # recurring cadence (default daily)
SHEETS_EXPORTER_ARCHIVE_RPC_URL=...               # backfill archive endpoint; default = ETHEREUM_ARCHIVE_NODE_URL
SHEETS_EXPORTER_MAX_RPS=...                       # backfill self-rate-limit (low default)
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=...               # existing — already on the monitoring server
GOOGLE_SHEETS_SPREADSHEET_ID=... / *_RANGE=...    # existing
ETHEREUM_NODE_URL / AZTEC_NODE_URL                # recurring: current-block reads, no archive
STAKING_REWARDS_SPLIT_FROM_BLOCK=...              # event-scan / backfill start block
```

The **recurring** service needs no archive RPC (current-block reads only); only
`--backfill` does.

### B6. Deployment

- Own systemd unit `aztec-butler-sheets-exporter`, one per network, on the
  monitoring server, co-located with the GCP credential.
- Ansible (`monitoring_server` role) deploys the binary, the service unit, and
  config/credential — **not** data, and it does **not** run the backfill.
- The backfill is a **documented one-off operator step**: deploy via Ansible →
  run `sheets-exporter --backfill` once on the server (in `tmux`) → start the
  recurring service.

### Implementation outline (Phase B)

1. `src/core/components/rewards-ledger.ts` — the `accrued = Δsum + claims` computation, claim/distribute `Transfer` scan, cross-rollup balance sum, split resolution; shared by recurring + backfill. Reuses `rewards-compute.ts`.
2. `src/sheets-exporter/rpc.ts` — archive RPC client: self-rate-limit, exponential backoff/retry, low concurrency.
3. `src/sheets-exporter/cursor.ts` — persist/load per-coinbase boundary balances + last-scanned block + backfill checkpoint.
4. `src/sheets-exporter/index.ts` — entrypoint: recurring loop and the `--backfill` driver.
5. Reuse `src/server/exporters/sheets-staking-rewards.ts` + `src/core/utils/googleAuth.ts` for Sheet writes.
6. `src/index.ts` — `sheets-exporter` CLI command (`--network`, `--backfill`, `--dry-run`).
7. `daemon/install-sheets-exporter.sh` — systemd installer.
8. `tests/unit/` — ledger formula (`accrued = Δsum + claims`; migration day; late old-rollup claim), cursor round-trip, rate-limiter + backoff.
9. `docs/` — deployment guide including the one-off backfill step.

---

## Migration

- The Google Sheet is append-only — any **existing rows stay**.
- The old `staking-rewards-history.json` is unreliable and is **not** used;
  `--backfill` reconstructs the full history correctly from chain instead.
- `serve` keeps running rewards until Phase A + Phase B are live, then disable it
  there. Never run two rewards processes writing the same outputs.
- aztlan-ops `monitoring_server` role: add the `sheets-exporter` unit + config;
  the rewards path needs **no** key files there.

---

## Resolved decisions

**Q1 — Olla out of scope.** Rewards are registry-agnostic and native-only; Olla
is tracked separately. No `registry` label; rows keyed by `coinbase`.

**Q2 — Accounting is event-sourced, not Prometheus-sourced.** An earlier draft
had Phase B query Prometheus — wrong for accounting (30 d retention, not
replayable, not auditable). Phase B is a self-contained event-sourced ledger
(`getSequencerRewards` snapshots + `Transfer` events → Sheet). Phase A still
feeds Prometheus, for *monitoring* only.

**Q3 — Reward token.** The rollup's staking asset (`getStakingAsset()`), mainnet
AZTEC `0xa27ec0006e59f245217ff08cd52a7e8b169e62d2`; `decimals()` resolved
on-chain; optional `REWARD_TOKEN_ADDRESS` override. Amounts in whole AZTEC.

**Q4 — Coinbase discovery.** Purely from `StakedWithProvider` events
(provider-filtered) — confirmed complete (everything is provider-staked). No key
files; no `REWARD_EXTRA_COINBASES` hook needed.

**Q5 — Deployment topology.** Sequencer nodes run `--mode node`; the monitoring
server runs `--mode global` + `sheets-exporter`. Registered-key files stay only
on the node that owns them.

**Q6 — Agent run modes.** Explicit required `--mode` (`node`/`global`/`all`)
instead of per-scraper toggles. (Part 0 — implemented.)

**Q7 — Cash vs accrual.** Daily **accrued** (smooth, `Δbalance + claims`) is the
primary "what we earned" figure; **claimed** is recorded alongside as the cash
movement. Accrual is reliable *going forward* (current-block sampling); the
pre-agent past is reconstructed by `--backfill` with an archive node.

**Q8 — Rollup upgrades.** Sum `getSequencerRewards` across all rollup versions;
rewards stay on (and stay claimable on) the old rollup, so the sum + formula
handle migrations with no per-block dispatch.

**Q9 — Archive RPC + throttling.** Free dRPC serves archive (verified). The
endpoint is configurable (`SHEETS_EXPORTER_ARCHIVE_RPC_URL`); the backfill
self-rate-limits, retries with backoff, and checkpoints/resumes to survive
free-tier throttling on the large initial run. The recurring service needs no
archive at all.
