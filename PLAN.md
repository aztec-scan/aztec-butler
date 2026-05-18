# Plan: Local Butler Agent With OTLP Export and Registry-Aware Sequencer State

## Goal

Replace the current central Prometheus-server-shaped monitoring model with a clean local-agent model:

```text
sequencer host
  aztec-butler agent
    - reads local registered-key files actually present on the host
    - computes local attester/publisher/registry state
    - performs read-only L1/L2 checks for those local keys
    - optionally scrapes global rollup/provider queue stats
    - exports OTLP metrics to local OpenTelemetry collector
        ↓
  local otel/opentelemetry-collector-contrib:0.107.0
        ↓
  central metrics backend / Grafana
```

No Butler HTTP telemetry server should be required in agent mode. The local OTel collector is the only telemetry relay surface.

## Non-goals

- Backwards compatibility with the old in-memory server state shape.
- Keeping old metric names if they make the new model unclear.
- Adding transaction execution, Safe proposals, key mutation, or any write-path automation to the agent.
- Exposing Butler's own public `/metrics` endpoint from sequencer hosts.

## Core design decisions

### 1. One runtime mode: `agent`

Add a single local runtime mode:

```bash
aztec-butler agent --network mainnet
```

The agent always handles local host/key telemetry. Global scrapers are opt-in configuration within the same mode, not a separate process type.

### 2. Use `registry`, not `source`

Registered-key files are registry-scoped today:

```text
native-registered-keys.json
olla-registered-keys.json
```

So the clean labels are:

```text
network="mainnet"
host="beast-3"
registry="olla"
attester_address="0x..."
publisher_address="0x..."
```

Do not add a duplicate `source="olla"` label unless future files need a distinction beyond registry.

### 3. Keep lifecycle independent from registry

The lifecycle remains common across native and Olla:

```text
NEW
IN_STAKING_PROVIDER_QUEUE
ROLLUP_ENTRY_QUEUE
ACTIVE
NO_LONGER_ACTIVE
```

Registry is a dimension of the key/provider path, not a separate lifecycle enum. Avoid states like:

```text
NATIVE_IN_STAKING_PROVIDER_QUEUE
OLLA_IN_STAKING_PROVIDER_QUEUE
```

### 4. Global metrics should not include `host`

If a metric describes global chain state, it should be exported without a `host` label:

```text
aztec_butler_entry_queue_length{network="mainnet"}
aztec_butler_provider_queue_length{network="mainnet",registry="olla"}
```

This is the cleanest dashboard model because global state is not host-specific.

However, only one agent per network should export global metrics, otherwise two agents will emit identical time series with the same labels. That creates duplicate samples in Prometheus-style backends and can cause noisy or undefined results.

Recommended config:

```text
# beast-3
BUTLER_AGENT_GLOBAL_STATS_ENABLED=true

# beast-4
BUTLER_AGENT_GLOBAL_STATS_ENABLED=false
```

If we later need automatic failover, add an explicit leader-election/lease mechanism or a stable `global_scraper_id` label. Do not add `host` to global metrics just to paper over duplicate exporters.

## Configuration

Add agent-specific config fields:

```text
BUTLER_AGENT_HOST=beast-3
BUTLER_AGENT_OTLP_ENABLED=true
BUTLER_AGENT_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/metrics

BUTLER_AGENT_LOCAL_KEYS_ENABLED=true
BUTLER_AGENT_L1_STATUS_ENABLED=true
BUTLER_AGENT_PUBLISHER_BALANCES_ENABLED=true
BUTLER_AGENT_ROLLUP_STATUS_ENABLED=true

BUTLER_AGENT_GLOBAL_STATS_ENABLED=false
```

Use existing network config for:

```text
NETWORK=mainnet
ETHEREUM_CHAIN_ID=1
ETHEREUM_NODE_URL=...
ETHEREUM_ARCHIVE_NODE_URL=... # optional, useful for event-derived Olla queue reads
AZTEC_NODE_URL=...

AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS=...          # native
OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS=...     # Olla
OLLA_AZTEC_STAKING_REGISTRY_ADDRESS=...           # Olla
```

Agent mode must fail closed for unsafe/mutating config. It should not require or load private keys.

## Local file model

The agent reads local registered-key files under the host-local data dir. For a sequencer host this should be enough:

```text
~/.local/share/aztec-butler/mainnet/<host>/native-registered-keys.json
~/.local/share/aztec-butler/mainnet/<host>/olla-registered-keys.json
```

The loader should preserve placement data instead of flattening it away:

```ts
type LocalAttesterKey = {
  network: string;
  host: string;
  registry: "native" | "olla";
  attesterAddress: string;
  coinbase?: string;
  publishers: string[];
  filePath: string;
};
```

For this plan, `registry` is parsed from the filename prefix:

```text
native-registered-keys.json -> registry="native"
olla-registered-keys.json   -> registry="olla"
```

Reject unknown prefixes unless we intentionally add support for custom registries later.

## State model

Replace the old single-map state with explicit local and global state.

### Local state

```ts
type LocalSequencerState = {
  network: string;
  host: string;
  keys: Map<string, LocalAttesterRuntimeState>;
  publishers: Map<string, LocalPublisherRuntimeState>;
  lastUpdated: Date;
};

type LocalAttesterRuntimeState = {
  attesterAddress: string;
  registry: "native" | "olla";
  coinbase?: string;
  publishers: string[];
  lifecycleState: AttesterLifecycleState;
  onChainView?: AttesterView;
  inProviderQueue: boolean;
  providerQueuePosition?: number;
  lastUpdated: Date;
};

type AttesterLifecycleState =
  | "NEW"
  | "IN_STAKING_PROVIDER_QUEUE"
  | "ROLLUP_ENTRY_QUEUE"
  | "ACTIVE"
  | "NO_LONGER_ACTIVE";
```

### Global state

```ts
type GlobalSequencerState = {
  network: string;
  registries: Record<"native" | "olla", ProviderQueueState>;
  entryQueue: EntryQueueStats;
  lastUpdated: Date;
};

type ProviderQueueState = {
  registry: "native" | "olla";
  providerId: bigint | null;
  adminAddress: string;
  rewardsRecipient: string;
  queueLength: bigint;
  queue: string[];
  lastUpdated: Date;
};
```

## Scrapers

### Local key scraper

Reads local registered-key files and emits key presence, registry, coinbase, and publisher assignment facts.

This is the source of truth for what is actually deployed on the sequencer host.

### Local L1/L2 status scraper

For locally present attesters:

- fetch rollup `getAttesterView`
- determine lifecycle state
- check registry-specific provider queue membership
- record current on-chain status

Use `EthereumClient` registry-target support for both native and Olla. Olla queue reconstruction may require archive RPC or configured scan start block.

### Publisher balance scraper

For local publisher addresses:

- query L1 ETH balance
- export current balance in wei
- export required top-up if config already supports it

### Optional global stats scraper

Enabled only when:

```text
BUTLER_AGENT_GLOBAL_STATS_ENABLED=true
```

Responsibilities:

- native provider queue length and queue membership
- Olla provider queue length and queue membership
- global rollup entry queue length
- queue ETA estimates
- global scrape freshness

Export these without `host` labels.

## Metrics

Metric names below are intentionally explicit and can replace old names.

### Local host/key metrics

```text
aztec_butler_attester_present{
  network="mainnet",
  host="beast-3",
  registry="olla",
  attester_address="0x..."
} 1
```

```text
aztec_butler_attester_coinbase_configured{
  network="mainnet",
  host="beast-3",
  registry="olla",
  attester_address="0x..."
} 1
```

```text
aztec_butler_attester_lifecycle_state{
  network="mainnet",
  host="beast-3",
  registry="olla",
  attester_address="0x...",
  state="ACTIVE"
} 1
```

```text
aztec_butler_attester_provider_queue_membership{
  network="mainnet",
  host="beast-3",
  registry="olla",
  attester_address="0x..."
} 1
```

```text
aztec_butler_publisher_balance_wei{
  network="mainnet",
  host="beast-3",
  publisher_address="0x..."
} 123456789
```

### Global metrics

No `host` label:

```text
aztec_butler_global_entry_queue_length{
  network="mainnet"
} 1234
```

```text
aztec_butler_global_provider_queue_length{
  network="mainnet",
  registry="olla"
} 200
```

```text
aztec_butler_global_provider_next_arrival_timestamp{
  network="mainnet",
  registry="native"
} 1760000000
```

```text
aztec_butler_global_last_scraped_timestamp{
  network="mainnet",
  scraper="entry_queue"
} 1760000000
```

## Grafana queries this should support

### HA coverage for Olla keys

Expected value is 2 for keys that should be on both sequencer hosts:

```promql
count by (network, registry, attester_address) (
  aztec_butler_attester_present{network="mainnet", registry="olla"}
)
```

Alert when `< 2`.

### Missing coinbases

```promql
aztec_butler_attester_coinbase_configured{network="mainnet", registry="olla"} == 0
```

### Local lifecycle breakdown

```promql
sum by (network, host, registry, state) (
  aztec_butler_attester_lifecycle_state{network="mainnet"}
)
```

### Global provider queue length

```promql
aztec_butler_global_provider_queue_length{network="mainnet", registry="olla"}
```

## OTLP export

Add an OTLP metrics exporter alongside or instead of the existing Prometheus exporter.

Agent mode should initialize only OTLP export when:

```text
BUTLER_AGENT_OTLP_ENABLED=true
```

Default endpoint:

```text
http://127.0.0.1:4318/v1/metrics
```

If the deployed collector uses gRPC instead of HTTP/protobuf, add a config switch rather than hardcoding transport assumptions.

## Safety requirements

- Agent mode is read-only.
- Agent mode must not load private key env vars.
- Agent mode must not initialize Safe proposal clients.
- Agent mode must not broadcast transactions.
- Agent mode must not expose a public HTTP server by default.
- OTLP endpoint should default to localhost.
- Chain ID must be verified against the configured network before L1 reads are trusted.
- If Olla registry config is missing, Olla-specific scrapes should fail clearly or be disabled explicitly.

## Implementation outline

1. Add CLI command `agent`.
2. Add agent config schema and env parsing.
3. Add registry-aware local key loader that preserves `host` and `registry` per attester.
4. Replace or bypass old server state with new local/global agent state modules.
5. Add local key scraper.
6. Add local L1/L2 status scraper for lifecycle and provider queue membership.
7. Add publisher balance scraper.
8. Add optional global stats scraper controlled by `BUTLER_AGENT_GLOBAL_STATS_ENABLED`.
9. Add OTLP metrics exporter setup.
10. Define new metric instruments and remove old Prometheus-server assumptions from agent mode.
11. Add docs for systemd deployment on `beast-3` and `beast-4`.
12. Add tests for:
    - registry parsing from filenames
    - local key placement preservation
    - lifecycle derivation
    - global metrics omitting `host`
    - duplicate global exporter guard/config validation

## Deployment shape

On both sequencer hosts:

```bash
aztec-butler agent --network mainnet
```

Example `beast-3` config:

```text
BUTLER_AGENT_HOST=beast-3
BUTLER_AGENT_OTLP_ENABLED=true
BUTLER_AGENT_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/metrics
BUTLER_AGENT_GLOBAL_STATS_ENABLED=true
```

Example `beast-4` config:

```text
BUTLER_AGENT_HOST=beast-4
BUTLER_AGENT_OTLP_ENABLED=true
BUTLER_AGENT_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/metrics
BUTLER_AGENT_GLOBAL_STATS_ENABLED=false
```

If global stats fail on the enabled host, switch the flag to the other host via Ansible/systemd config and restart the agent.

## Open questions

- Which host should be the default global stats exporter: `beast-3` or `beast-4`?
- Does the existing OTel collector listen on HTTP/protobuf `4318`, gRPC `4317`, or both?
- Are registered-key files on each sequencer already stored under `mainnet/<host>/<registry>-registered-keys.json`, or should the agent support a host-local shorthand path?
- Do we want signer inventory verification in this first clean implementation, or only actual local registered-key-file presence plus L1/L2 reads?
