# Aztec Butler — Agent Mode

The **agent** is the local, read-only telemetry process. It runs in one of three
explicit **run modes** and pushes metrics to an OpenTelemetry collector over
OTLP. It runs **no HTTP server** and **loads no private keys** — it is read-only
by construction and fails closed if given mutating config.

```bash
aztec-butler agent --mode node   --network mainnet    # on each sequencer host
aztec-butler agent --mode global --network mainnet    # on the monitoring server
aztec-butler agent --mode all    --network mainnet    # dev / test / single-box
```

---

## 1. Run modes

`--mode` is **required** — there is no default.

| Mode | Scrapers | Requires | Emits | Runs on |
|---|---|---|---|---|
| `node` | local keys, local status, publisher balances, entry-queue ETA | `BUTLER_AGENT_HOST` | `host`-labelled local metrics only | every sequencer host |
| `global` | global chain stats, rewards (opt-in) | archive RPC when rewards on; no `HOST` | `network`-labelled global metrics only | exactly one host per network |
| `all` | everything | `HOST` + archive RPC | both | dev / test / single-box only |

The mode selects the scraper set **and** the metric-instrument set. A `global`
agent never registers local instruments, so it can never emit a `host`-labelled
series — it cannot appear as a phantom node in host-scoped dashboards or alerts.

## 2. Configuration

The agent reads the standard per-network base env file
(`<configDir>/<network>-base.env`) for chain/RPC settings, plus the
`BUTLER_AGENT_*` fields below.

### Agent-specific fields

| Variable | Default | Purpose |
|---|---|---|
| `BUTLER_AGENT_HOST` | *(required for `node`/`all`)* | This sequencer's host name — the `host` metric label (e.g. `beast-3`). Unused in `global` mode. |
| `BUTLER_AGENT_OTLP_ENABLED` | `true` | Push metrics over OTLP. When `false`, metrics print to stdout. |
| `BUTLER_AGENT_OTLP_ENDPOINT` | `http://127.0.0.1:4318/v1/metrics` | Local collector endpoint. |
| `BUTLER_AGENT_OTLP_PROTOCOL` | `http/protobuf` | Transport. `grpc` is reserved but not bundled in this build. |
| `BUTLER_AGENT_OTLP_EXPORT_INTERVAL_MS` | `30000` | OTLP export interval. |
| `BUTLER_AGENT_SCRAPE_INTERVAL_MS` | `30000` | Local scraper interval (`node`/`all`). |
| `BUTLER_AGENT_GLOBAL_SCRAPE_INTERVAL_MS` | `60000` | Global scraper interval (`global`/`all`). |
| `BUTLER_AGENT_ENTRY_QUEUE_ETA_INTERVAL_MS` | `120000` | Entry-queue ETA scraper interval (`node`/`all`). |
| `BUTLER_AGENT_REWARDS_ENABLED` | `false` | Enable the staking-rewards scraper (`global`/`all` mode). |
| `BUTLER_AGENT_REWARDS_INTERVAL_MS` | `3600000` | Rewards scraper interval. |

The per-scraper boolean toggles were removed — the run mode determines the
scraper set.

### Network fields (shared with other Butler modes)

```
NETWORK=mainnet
ETHEREUM_CHAIN_ID=1
ETHEREUM_NODE_URL=...
ETHEREUM_ARCHIVE_NODE_URL=...                     # required when rewards enabled; also Olla queue reads
AZTEC_NODE_URL=...
MIN_ETH_PER_ATTESTER=0.1                          # used for publisher top-up calc

AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS=...          # native registry admin
OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS=...     # Olla registry admin
OLLA_AZTEC_STAKING_REGISTRY_ADDRESS=...           # Olla registry contract

STAKING_REWARDS_SPLIT_FROM_BLOCK=...              # rewards: StakedWithProvider event-scan start block
REWARD_TOKEN_ADDRESS=...                          # rewards: optional; default = rollup staking asset
SAFE_ADDRESS=...                                  # rewards: optional; recipient counted as "ours"
```

### Fail-closed safety

The agent **refuses to start** if its env contains mutating or key-bearing
config. Use a dedicated, minimal agent env file — do not reuse a server env
that contains:

- `SAFE_PROPOSALS_ENABLED=true`
- `MULTISIG_PROPOSER_PRIVATE_KEY`
- `SAFE_API_KEY`

The chain ID is also verified against the Aztec node and the L1 RPC before any
read is trusted.

---

## 3. Local key files

A `node`/`all` agent reads only **its own host's** registered-key files:

```
~/.local/share/aztec-butler/<network>/<host>/native-registered-keys.json   -> registry "native"
~/.local/share/aztec-butler/<network>/<host>/olla-registered-keys.json     -> registry "olla"
```

The registry is parsed from the filename prefix. Unknown prefixes are skipped
with a warning. A `global` agent reads **no** key files.

---

## 4. Testing locally before deploying

Use `--mode all` for testing — it exercises both local and global scrapers in
one process. All of the below are read-only and never touch production.

### a) Dry run — no collector needed

Prints every metric (with labels) to stdout:

```bash
scripts/agent-local-test.sh dry-run mainnet
# or directly:
npm run dev:agent -- --network mainnet --mode all --once --dry-run
```

Use this to confirm key discovery, lifecycle derivation and label values.

### b) One-shot against a real local collector

Spins up `otel-collector-contrib:0.107.0` locally (the same version as
production), runs one scrape+export, and lets you inspect exactly what arrived:

```bash
scripts/agent-local-test.sh once mainnet     # bring up collector + one cycle
scripts/agent-local-test.sh logs             # see the exported metrics
scripts/agent-local-test.sh down             # tear the collector down
```

This is the highest-fidelity test: it exercises the real OTLP transport and
serialization path agent → collector.

### c) Continuous run

```bash
scripts/agent-local-test.sh run mainnet      # collector + agent loop (Ctrl+C to stop)
```

### Unit tests

```bash
npm test
```

Covers per-mode config validation, registry parsing, local key placement
preservation, lifecycle derivation, and global metrics omitting `host`.

---

## 5. The single-global-exporter rule

Global metrics describe chain-wide state and are exported **without a `host`
label**. If two agents both exported them, the backend would see duplicate time
series with identical labels.

So exactly **one agent per network** runs `--mode global` (or `all`). In this
deployment that is the **monitoring server**; the sequencer hosts run
`--mode node` and emit only their own local metrics.

---

## 6. Metrics

### Local (per-host) — include `host` — emitted by `node`/`all`

| Metric | Labels |
|---|---|
| `aztec_butler_attester_present` | `network, host, registry, attester_address` |
| `aztec_butler_attester_coinbase_configured` | `network, host, registry, attester_address` |
| `aztec_butler_attester_lifecycle_state` | `network, host, registry, attester_address, state` |
| `aztec_butler_attester_provider_queue_membership` | `network, host, registry, attester_address` |
| `aztec_butler_attester_entry_queue_position` | `network, host, registry, attester_address` |
| `aztec_butler_attester_entry_queue_eta_timestamp` | `network, host, registry, attester_address` |
| `aztec_butler_next_missing_coinbase_eta_timestamp` | `network, host, attester_address` |
| `aztec_butler_publisher_balance_wei` | `network, host, publisher_address` |
| `aztec_butler_publisher_required_topup_wei` | `network, host, publisher_address` |
| `aztec_butler_local_last_scraped_timestamp` | `network, host, scraper` |

### Global (chain-wide) — no `host` — emitted by `global`/`all`

| Metric | Labels |
|---|---|
| `aztec_butler_global_entry_queue_length` | `network` |
| `aztec_butler_global_entry_queue_last_attester_timestamp` | `network` |
| `aztec_butler_global_provider_queue_length` | `network, registry` |
| `aztec_butler_global_provider_next_arrival_timestamp` | `network, registry` |
| `aztec_butler_global_last_scraped_timestamp` | `network, scraper` |
| `aztec_butler_staking_rewards_pending_aztec` | `network, coinbase` |
| `aztec_butler_staking_rewards_our_share_aztec` | `network, coinbase` |
| `aztec_butler_staking_rewards_earned_aztec` | `network, coinbase` |

### Example Grafana queries

HA coverage for Olla keys (expect `2`, alert when `< 2`):

```promql
count by (network, registry, attester_address) (
  aztec_butler_attester_present{network="mainnet", registry="olla"}
)
```

Missing coinbases:

```promql
aztec_butler_attester_coinbase_configured{network="mainnet", registry="olla"} == 0
```

Missing-coinbase ETA — alert when an attester will activate *without* a coinbase
within the next 6 hours (the headline operational signal):

```promql
aztec_butler_next_missing_coinbase_eta_timestamp{network="mainnet"} - time() < 21600
```

Local lifecycle breakdown:

```promql
sum by (network, host, registry, state) (
  aztec_butler_attester_lifecycle_state{network="mainnet"}
)
```

---

## 7. systemd deployment

Ensure the `<network>-base.env` config exists, then install the service with the
mode for that host — `node` on a sequencer, `global` on the monitoring server:

```bash
sudo ./daemon/install-agent.sh node mainnet      # on a sequencer host
sudo ./daemon/install-agent.sh global mainnet    # on the monitoring server
```

This builds the project and installs an `aztec-butler-agent` systemd service
running `aztec-butler agent --mode <mode> --network <network>` with read-only
hardening (`ProtectSystem=strict`, `ProtectHome=read-only`, `NoNewPrivileges`).

```bash
sudo systemctl status aztec-butler-agent
sudo journalctl -u aztec-butler-agent -f
```

The OpenTelemetry collector (`otel-collector-contrib:0.107.0`) is deployed
separately and must be listening on the configured OTLP endpoint before the
agent starts.
