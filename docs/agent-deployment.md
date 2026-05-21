# Aztec Butler — Agent Mode

The **agent** is the local, read-only sequencer telemetry process. It runs on
each sequencer host, reads that host's registered-key files, performs
read-only L1/L2 checks for those keys, and pushes metrics to a **local
OpenTelemetry collector** over OTLP.

```
sequencer host
  aztec-butler agent              (this process)
    - reads local registered-key files
    - computes local attester/publisher/registry state
    - read-only L1/L2 checks for local keys
    - optionally scrapes global rollup/provider queue stats
    - exports OTLP metrics ──▶ local otel-collector-contrib:0.107.0 ──▶ central backend
```

The agent runs **no HTTP server** and **loads no private keys**. It is
read-only by construction and fails closed if given mutating config.

```bash
aztec-butler agent --network mainnet
```

---

## 1. Configuration

The agent reads the standard per-network base env file
(`<configDir>/<network>-base.env`) for chain/RPC settings, plus the
`BUTLER_AGENT_*` fields below.

### Agent-specific fields

| Variable | Default | Purpose |
|---|---|---|
| `BUTLER_AGENT_HOST` | *(required)* | This sequencer's host name — the `host` metric label (e.g. `beast-3`). |
| `BUTLER_AGENT_OTLP_ENABLED` | `true` | Push metrics over OTLP. When `false`, metrics print to stdout. |
| `BUTLER_AGENT_OTLP_ENDPOINT` | `http://127.0.0.1:4318/v1/metrics` | Local collector endpoint. |
| `BUTLER_AGENT_OTLP_PROTOCOL` | `http/protobuf` | Transport. `grpc` is reserved but not bundled in this build. |
| `BUTLER_AGENT_OTLP_EXPORT_INTERVAL_MS` | `30000` | OTLP export interval. |
| `BUTLER_AGENT_SCRAPE_INTERVAL_MS` | `30000` | Local scraper interval. |
| `BUTLER_AGENT_GLOBAL_SCRAPE_INTERVAL_MS` | `60000` | Global stats scraper interval. |
| `BUTLER_AGENT_LOCAL_KEYS_ENABLED` | `true` | Read local registered-key files. |
| `BUTLER_AGENT_L1_STATUS_ENABLED` | `true` | Read staking-registry provider-queue membership. |
| `BUTLER_AGENT_ROLLUP_STATUS_ENABLED` | `true` | Read rollup `getAttesterView` (lifecycle state). |
| `BUTLER_AGENT_PUBLISHER_BALANCES_ENABLED` | `true` | Read L1 ETH balances for local publishers. |
| `BUTLER_AGENT_GLOBAL_STATS_ENABLED` | `false` | Export global chain state. **Opt-in — see §4.** |

### Network fields (shared with other Butler modes)

```
NETWORK=mainnet
ETHEREUM_CHAIN_ID=1
ETHEREUM_NODE_URL=...
ETHEREUM_ARCHIVE_NODE_URL=...                     # optional, useful for Olla queue reads
AZTEC_NODE_URL=...
MIN_ETH_PER_ATTESTER=0.1                          # used for publisher top-up calc

AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS=...          # native registry admin
OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS=...     # Olla registry admin
OLLA_AZTEC_STAKING_REGISTRY_ADDRESS=...           # Olla registry contract
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

## 2. Local key files

The agent reads only **its own host's** registered-key files:

```
~/.local/share/aztec-butler/<network>/<host>/native-registered-keys.json   -> registry "native"
~/.local/share/aztec-butler/<network>/<host>/olla-registered-keys.json     -> registry "olla"
```

The registry is parsed from the filename prefix. Unknown prefixes are skipped
with a warning.

---

## 3. Testing locally before deploying

Three ways to exercise the agent on your workstation — all read-only, none
touch production.

### a) Dry run — no collector needed

Prints every metric (with labels) to stdout:

```bash
scripts/agent-local-test.sh dry-run mainnet
# or directly:
npm run dev:agent -- --network mainnet --once --dry-run
```

Use this to confirm key discovery, lifecycle derivation and label values.

### b) One-shot against a real local collector

Spins up `otel-collector-contrib:0.107.0` locally (the same version as
production), runs one scrape+export, and lets you inspect exactly what
arrived:

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

Covers registry parsing, local key placement preservation, lifecycle
derivation, global metrics omitting `host`, and fail-closed config validation.

---

## 4. The single-global-exporter rule

Global metrics describe chain-wide state and are exported **without a `host`
label**. If two agents both exported them, the backend would see duplicate
time series with identical labels.

So exactly **one agent per network** sets `BUTLER_AGENT_GLOBAL_STATS_ENABLED=true`.

In this deployment that host is **beast-4**:

```
# beast-4 (global exporter)
BUTLER_AGENT_GLOBAL_STATS_ENABLED=true

# beast-3 (local-only)
BUTLER_AGENT_GLOBAL_STATS_ENABLED=false
```

If global scrapes start failing on beast-4, flip the flag to beast-3 (via
Ansible/systemd config) and restart both agents.

---

## 5. Metrics

### Local (per-host) — include `host`

| Metric | Labels |
|---|---|
| `aztec_butler_attester_present` | `network, host, registry, attester_address` |
| `aztec_butler_attester_coinbase_configured` | `network, host, registry, attester_address` |
| `aztec_butler_attester_lifecycle_state` | `network, host, registry, attester_address, state` |
| `aztec_butler_attester_provider_queue_membership` | `network, host, registry, attester_address` |
| `aztec_butler_publisher_balance_wei` | `network, host, publisher_address` |
| `aztec_butler_publisher_required_topup_wei` | `network, host, publisher_address` |
| `aztec_butler_local_last_scraped_timestamp` | `network, host, scraper` |

### Global (chain-wide) — no `host`

| Metric | Labels |
|---|---|
| `aztec_butler_global_entry_queue_length` | `network` |
| `aztec_butler_global_entry_queue_last_attester_timestamp` | `network` |
| `aztec_butler_global_provider_queue_length` | `network, registry` |
| `aztec_butler_global_provider_next_arrival_timestamp` | `network, registry` |
| `aztec_butler_global_last_scraped_timestamp` | `network, scraper` |

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

Local lifecycle breakdown:

```promql
sum by (network, host, registry, state) (
  aztec_butler_attester_lifecycle_state{network="mainnet"}
)
```

---

## 6. systemd deployment

On each sequencer host, ensure the `<network>-base.env` config exists with the
correct `BUTLER_AGENT_HOST` and global-stats flag, then:

```bash
sudo ./daemon/install-agent.sh mainnet
```

This builds the project and installs an `aztec-butler-agent` systemd service
running `aztec-butler agent --network mainnet` with read-only hardening
(`ProtectSystem=strict`, `ProtectHome=read-only`, `NoNewPrivileges`).

```bash
sudo systemctl status aztec-butler-agent
sudo journalctl -u aztec-butler-agent -f
```

The local OpenTelemetry collector (`otel-collector-contrib:0.107.0`) is
deployed separately and must be listening on the configured OTLP endpoint
before the agent starts.
