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
| `SHEETS_EXPORTER_ARCHIVE_RPC_URL` | falls back to `ETHEREUM_ARCHIVE_NODE_URL` | Archive RPC for historical `getSequencerRewards` reads. Required for `--backfill`. A free dRPC endpoint works. |
| `SHEETS_EXPORTER_MAX_RPS` | `8` | Backfill self-rate-limit (requests/sec) to stay under a free archive tier. Retries throttling with exponential backoff. |
| `SHEETS_EXPORTER_INTERVAL_MS` | `86400000` (daily) | Recurring-mode cycle interval. |
| `SHEETS_EXPORTER_LEDGER_RANGE` | `RewardsLedger!A1` | Target range for the per-coinbase rows. |
| `SHEETS_EXPORTER_DAILY_TOTAL_RANGE` | `RewardsDailyTotal!A1` | Target range for the daily-total rows. |
| `SAFE_ADDRESS` | *(optional)* | Split recipient counted as "ours"; default = the provider's rewards recipient. |
| `REWARD_TOKEN_ADDRESS` | *(optional)* | Reward-token override; default = the rollup staking asset. |

Shared network fields (`ETHEREUM_CHAIN_ID`, `ETHEREUM_NODE_URL`,
`AZTEC_NODE_URL`) come from the `<network>-base.env`.

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
  --once                  run a single recurring cycle, then exit
  --dry-run               compute and print; do not write the Sheet or cursor
  --config <path>         override the per-network base env file path
```

- **Recurring** (no `--backfill`): on the first run it records a *baseline*
  (current balances, no rows). Each subsequent run appends one ledger period.
- **Backfill** (`--backfill`): walks day-by-day, writes daily rows, then leaves
  a cursor the recurring service picks up from.
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

### Step 1 — one-time historical backfill

The backfill is long-running and archive-RPC heavy. Run it manually in `tmux`,
**before** installing the service:

```bash
tmux new -s butler-backfill
node dist/index.js sheets-exporter --network mainnet --backfill
```

Dry-run it first to sanity-check the computation without touching the Sheet:

```bash
node dist/index.js sheets-exporter --network mainnet --backfill --dry-run
```

The backfill self-rate-limits to `SHEETS_EXPORTER_MAX_RPS` and retries
throttling responses, so a free archive endpoint is fine — it just takes
longer. It overwrites both tabs and writes the resume cursor on completion.

### Step 2 — install the recurring service

```bash
sudo ./daemon/install-sheets-exporter.sh mainnet
```

This builds the project and installs the `aztec-butler-sheets-exporter`
systemd service running `sheets-exporter --network <network>` (recurring mode)
with read-only hardening (`ProtectSystem=strict`, `ProtectHome=read-only`,
`NoNewPrivileges`). The env-paths data dir is the only writable path — it holds
the resume cursor and the coinbase-mapping cache.

```bash
sudo systemctl status aztec-butler-sheets-exporter
sudo journalctl -u aztec-butler-sheets-exporter -f
```

The service resumes from the cursor the backfill left, so no day is double-
counted or skipped between the two steps.

---

## 6. Recovering from downtime

The recurring service computes **one period per run** and dates every row with
the run day. If it misses runs (reboot, crash, maintenance), the next run still
computes the correct *totals* — `Δbalance + claims` is exact over any gap — but
it lumps the whole gap into a single fat row dated today, and the skipped dates
get no row. No value is lost; only the per-day breakdown.

To restore clean per-day rows for the affected window, run a **ranged backfill**:

```bash
sudo systemctl stop aztec-butler-sheets-exporter

# recompute the last two weeks (dry-run first to inspect):
node dist/index.js sheets-exporter --network mainnet --backfill --days 14 --dry-run
node dist/index.js sheets-exporter --network mainnet --backfill --days 14

# ...or from a specific date:
node dist/index.js sheets-exporter --network mainnet --backfill --from-date 2026-05-07

sudo systemctl start aztec-butler-sheets-exporter
```

A ranged backfill:

- recomputes only the requested window (always ending yesterday);
- **splices** the result into the Sheet — rows outside the window are read back
  and rewritten unchanged, so no other ledger data is lost;
- anchors its opening balances with one historical read at the window start, so
  the spliced rows are numerically identical to a full backfill's;
- refreshes the cursor, so the recurring service resumes cleanly.

Stop the recurring service first so the two processes don't write concurrently.

> A splice still rewrites the whole tab (preserved rows included), so manual
> edits in *extra columns* of `RewardsLedger` / `RewardsDailyTotal` are not
> retained — keep any analysis in a separate tab.

---

## 7. Local testing

```bash
# Recurring dry-run — full chain plumbing, one period, nothing persisted:
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
