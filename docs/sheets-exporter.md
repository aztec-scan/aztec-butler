# Aztec Butler — Sheets Exporter (staking-rewards ledger)

The `sheets-exporter` is the staking-rewards **accounting ledger** (Part 2
Phase B). It runs on the monitoring server, reads L1 chain state **read-only**,
and writes a daily reward ledger to a Google Sheet.

The Sheet is the durable store. No application data files are kept in the
Ansible repo or copied between servers — the only local state is a small
resume cursor in the env-paths data dir.

It is a **separate service** from the `agent`:

| | Exports | Purpose |
|---|---|---|
| `agent --mode global` | live gauges → OTLP/Prometheus | *current* pending balance & our share (Phase A) |
| `sheets-exporter` | daily rows → Google Sheets | *historical accounting ledger* (Phase B) |

---

## 1. The ledger model

Event-sourced and self-reconciling. For each coinbase, for each day:

```
accrued = endBalance − prevBalance + claimed
```

- `endBalance` / `prevBalance` — Σ `getSequencerRewards(coinbase)` across **all**
  rollup versions. Old-rollup rewards stay claimable forever, so they keep
  counting — the ledger is migration-proof.
- `claimed` — reward-token ERC-20 `Transfer` out of the coinbase split contract
  during the day. A claim is the only on-chain reward-token movement, so it is
  the only thing that can make a balance *fall*.
- The 0xSplits allocation (`SplitUpdated`) divides `accrued` into **our share**
  vs. **other delegates'** share.

Because every row is `Δbalance + claims`, the ledger never drifts: a skipped
day is absorbed by the next day's delta. There is no separate "earned" counter
to keep in sync.

---

## 2. Sheet layout

Two tabs, both configurable. Coinbases are discovered from `StakedWithProvider`
events — no key files are needed.

**`RewardsLedger`** — one row per coinbase per day:

| date | coinbase | accrued_aztec | claimed_aztec | our_share_aztec | other_delegate_aztec |
|---|---|---|---|---|---|

**`RewardsDailyTotal`** — one row per day, summed across coinbases:

| date | accrued_aztec | claimed_aztec | our_share_aztec | other_delegate_aztec |
|---|---|---|---|---|

Amounts are whole AZTEC tokens (the reward token's decimals are read on-chain).

---

## 3. Configuration

Loads the per-network `<network>-base.env` (env-paths config dir), plus the
fields below.

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | *(required)* | Path to the GCP service-account JSON key. The Sheet must be shared with this service account (Editor). |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | *(required)* | Target spreadsheet ID (from its URL). |
| `STAKING_REWARDS_SPLIT_FROM_BLOCK` | *(required)* | Start block for the `StakedWithProvider` scan **and** the `--backfill` day range. |
| `AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS` | *(required)* | Native provider admin — resolves the provider id for coinbase discovery. |
| `SHEETS_EXPORTER_ARCHIVE_RPC_URL` | falls back to `ETHEREUM_ARCHIVE_NODE_URL` | **Required — must be a real archive node.** Every run reads `getSequencerRewards` at past block heights (historical `eth_call`); a non-archive node prunes that state and cannot serve it. A free dRPC endpoint works for steady state; a paid archive is much faster for a large one-time backfill. |
| `SHEETS_EXPORTER_MAX_RPS` | `8` | Self-rate-limit (requests/sec) to stay under the archive tier's limit. Retries throttling with exponential backoff. |
| `SHEETS_EXPORTER_INTERVAL_MS` | `86400000` (daily) | Recurring-mode cycle interval. |
| `SHEETS_EXPORTER_LEDGER_RANGE` | `RewardsLedger!A1` | Target range for the per-coinbase rows. |
| `SHEETS_EXPORTER_DAILY_TOTAL_RANGE` | `RewardsDailyTotal!A1` | Target range for the daily-total rows. |
| `SAFE_ADDRESS` | *(optional)* | Split recipient counted as "ours"; default = the provider's rewards recipient. |
| `REWARD_TOKEN_ADDRESS` | *(optional)* | Reward-token override; default = the rollup staking asset. |

Shared network fields (`ETHEREUM_CHAIN_ID`, `ETHEREUM_NODE_URL`,
`AZTEC_NODE_URL`) come from the `<network>-base.env`.

> **Archive node is mandatory.** The ledger is balance-diff based — it reads
> `getSequencerRewards(coinbase)` *at historical blocks*. That is state, not
> logs, so a normal full node (which keeps only ~the last 128 blocks of state)
> cannot answer it. Point `SHEETS_EXPORTER_ARCHIVE_RPC_URL` at a dedicated
> archive endpoint — not at a sequencer/full node. `ETHEREUM_NODE_URL` may stay
> on your own node (it is used only for current-head reads and `getLogs`).

### Fail-closed safety

Like agent mode, the sheets-exporter **refuses to start** if its env contains
mutating or key-bearing config (`SAFE_PROPOSALS_ENABLED=true`,
`MULTISIG_PROPOSER_PRIVATE_KEY`, `SAFE_API_KEY`). Its only write surface is the
Google Sheet. The chain ID is verified against the Aztec node and L1 RPC before
any read is trusted.

---

## 4. CLI

```
aztec-butler sheets-exporter --network <network> [options]

  --network <network>     required
  --backfill              reconstruct historical ledger rows, then exit
  --from-date <DATE>      with --backfill: recompute from DATE (YYYY-MM-DD) onward
  --days <n>              with --backfill: recompute only the last <n> complete days
  --once                  run a single catch-up cycle, then exit
  --dry-run               compute and print; do not write the Sheet or cursor
  --config <path>         override the per-network base env file path
```

- **Recurring** (no `--backfill`) — the self-healing default. Every run advances
  the ledger from the cursor to yesterday, day by day:
  - first run / no cursor → cold start: reconstructs the full history from
    `STAKING_REWARDS_SPLIT_FROM_BLOCK`;
  - after downtime → fills the gap day by day (no lumping);
  - already current → nothing to do.

  Each day is appended and committed individually, so a crash resumes from the
  last completed day. Append cost is independent of tab size — it scales to
  hundreds of coinbases.
- **Backfill** (`--backfill`) — an explicit one-shot reconstruction, then exit.
  Optional now that recurring self-heals; still useful as a fast first fill or
  to correct a window.
  - *Full* (no range): from `STAKING_REWARDS_SPLIT_FROM_BLOCK` to yesterday;
    overwrites both tabs.
  - *Ranged* (`--from-date` or `--days`): recomputes only that window and
    **splices** it in, preserving every row outside it. See §6.

`--from-date` and `--days` are mutually exclusive and apply only with
`--backfill`. `--dry-run` prints the computed rows (`console.table`) and
persists nothing — safe to run anywhere, including without the GCP key.

---

## 5. Deployment

The sheets-exporter runs on the **monitoring server** only (one instance,
chain-wide). Sequencer hosts do not run it.

The service is **self-healing** — on first start it reconstructs the full
history, and after any downtime it catches up the gap automatically. So
deployment is a single step:

```bash
sudo ./daemon/install-sheets-exporter.sh mainnet
```

This builds the project and installs the `aztec-butler-sheets-exporter` systemd
service running `sheets-exporter --network <network>` with read-only hardening
(`ProtectSystem=strict`, `ProtectHome=read-only`, `NoNewPrivileges`). The
env-paths data dir is the only writable path — it holds the resume cursor and
the coinbase-mapping cache.

```bash
sudo systemctl status aztec-butler-sheets-exporter
sudo journalctl -u aztec-butler-sheets-exporter -f
```

On its **first start** the service does a cold-start catch-up: it reconstructs
the ledger from `STAKING_REWARDS_SPLIT_FROM_BLOCK` to yesterday, one day at a
time. This is archive-RPC heavy and can take a while on a free endpoint —
follow the journal for `catch-up progress` lines. Each day is committed
individually, so a restart resumes from the last completed day rather than
starting over.

### Optional — a faster initial fill

With a **fast, reliable archive** you can pre-fill the whole history in one
foreground pass instead of letting the service cold-start:

```bash
tmux new -s butler-backfill
node dist/index.js sheets-exporter --network mainnet --backfill --dry-run   # inspect first
node dist/index.js sheets-exporter --network mainnet --backfill
```

`--backfill` computes the whole history and writes it in one pass, and lets you
`--dry-run` inspect it first. It leaves a cursor; the service then starts up
already current.

> `--backfill` checkpoints only at the **end** — a crash loses the run. On a
> **free / heavily-throttled** archive, do *not* use `--backfill`. Just deploy
> the service and let it cold-start: the catch-up checkpoints after every day,
> and the rate-limiter waits throttling out (capped exponential backoff, ~1h
> budget per call) rather than failing. It grinds to completion across restarts
> without losing progress — slow, but it always finishes.

---

## 6. Recovering from downtime

Nothing to do — the service is self-healing. On restart it reads its cursor,
detects the gap, and catches up day by day automatically (see §5). A multi-day
outage produces correct per-day rows, not a lumped row.

The ranged `--backfill` (`--from-date` / `--days`) is for **correcting** an
existing window — e.g. re-deriving days after a fix — not for filling gaps:

```bash
sudo systemctl stop aztec-butler-sheets-exporter

# recompute the last two weeks (dry-run first to inspect):
node dist/index.js sheets-exporter --network mainnet --backfill --days 14 --dry-run
node dist/index.js sheets-exporter --network mainnet --backfill --days 14

# ...or from a specific date:
node dist/index.js sheets-exporter --network mainnet --backfill --from-date 2026-05-07

sudo systemctl start aztec-butler-sheets-exporter
```

A ranged backfill recomputes only the requested window (always ending
yesterday), **splices** it into the Sheet — rows outside the window are
preserved — anchors its opening balances with one historical read at the window
start, and refreshes the cursor so the service resumes cleanly. Stop the service
first so the two processes don't write concurrently.

> The exporter owns the `RewardsLedger` / `RewardsDailyTotal` tabs and rewrites
> them — keep any manual analysis in a separate tab.

---

## 7. Local testing

```bash
# Catch-up dry-run — cold-start path, computed but not persisted:
npm run build
node dist/index.js sheets-exporter --network testnet --once --dry-run

# Backfill dry-run — exercises the historical day loop and the ledger formula:
node dist/index.js sheets-exporter --network testnet --backfill --dry-run
```

The ledger arithmetic (`buildLedgerRows`, `sumLedgerRows`), the RPC
rate-limiter, the cursor, and config validation are covered by unit tests:

```bash
npm test
```
