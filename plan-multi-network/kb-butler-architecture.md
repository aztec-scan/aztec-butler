# Knowledge Base: aztec-butler Architecture

## Overview

aztec-butler is a TypeScript/Node.js (v22+) tool for monitoring and managing multiple Aztec validator nodes. It runs as a long-lived systemd service on gremlin-3 (the monitoring server), periodically scraping on-chain and off-chain data and exposing it as Prometheus metrics.

## Two Modes

1. **CLI mode** (`cli.ts`) -- One-off commands for key management, coinbase scraping, deployment prep.
2. **Server mode** (`src/index.ts` -> `src/server/index.ts`) -- Long-running Prometheus metrics server with periodic scrapers.

## Project Structure

```
aztec-butler/
├── cli.ts                         # CLI entry point (commander)
├── src/
│   ├── index.ts                   # Main entry point (serve command)
│   ├── core/
│   │   ├── config/index.ts        # Config system (env-based, multi-network)
│   │   ├── components/
│   │   │   ├── AztecClient.ts     # @aztec/aztec.js node client wrapper
│   │   │   ├── EthereumClient.ts  # viem L1 client (rollup, staking registry)
│   │   │   ├── HostChecker.ts     # DNS/P2P/RPC health checks
│   │   │   ├── SafeGlobalClient.ts# Safe multisig integration
│   │   │   └── CoinbaseScraper.ts # Coinbase address scraping
│   │   └── utils/
│   │       ├── keysFileOperations.ts   # Keys file discovery/merge
│   │       ├── keystoreOperations.ts
│   │       ├── fileOperations.ts
│   │       ├── scraperConfigOperations.ts
│   │       └── googleAuth.ts
│   ├── server/
│   │   ├── index.ts               # startServer() orchestrator
│   │   ├── file-watcher.ts        # chokidar keys file watcher
│   │   ├── config-reloader.ts     # Hot-reload on file changes
│   │   ├── scrapers/
│   │   │   ├── base-scraper.ts
│   │   │   ├── scraper-manager.ts
│   │   │   ├── rollup-scraper.ts           # Attester on-chain status (60s)
│   │   │   ├── staking-provider-scraper.ts # Provider queue data (30s)
│   │   │   ├── publisher-scraper.ts        # Publisher ETH balances (30s)
│   │   │   ├── staking-rewards-scraper.ts  # Rewards tracking (hourly)
│   │   │   ├── entry-queue-scraper.ts      # Entry queue stats (10min)
│   │   │   └── host-scraper.ts             # Host health checks (30s)
│   │   ├── metrics/
│   │   │   ├── registry.ts                 # PrometheusExporter + bearer auth HTTP
│   │   │   ├── config-metrics.ts
│   │   │   ├── attester-metrics.ts
│   │   │   ├── publisher-metrics.ts
│   │   │   ├── staking-provider-metrics.ts
│   │   │   ├── staking-rewards-metrics.ts
│   │   │   ├── entry-queue-metrics.ts
│   │   │   └── host-metrics.ts
│   │   ├── state/
│   │   │   ├── index.ts           # Multi-network in-memory state + file persistence
│   │   │   └── transitions.ts    # Attester state machine
│   │   ├── handlers/
│   │   │   ├── index.ts
│   │   │   └── publisher-top-up-handler.ts
│   │   ├── actions/index.ts
│   │   └── exporters/
│   │       └── sheets-staking-rewards.ts   # Google Sheets export
│   ├── cli/commands/              # CLI commands
│   └── types/                     # Zod schemas + TS types
├── daemon/                        # systemd service setup scripts
│   ├── install.sh                 # All-networks install
│   └── install-mainnet.sh         # Mainnet-only install
├── scripts/                       # Shell script wrappers
└── dist/                          # Compiled output
```

## Configuration System

**Config directory**: `~/.config/aztec-butler/` (via `env-paths` package)
**Data directory**: `~/.local/share/aztec-butler/`

### Network auto-discovery

The config loader scans the config dir for `*-base.env` files. Each file name determines the network name (e.g. `mainnet-base.env` -> network "mainnet").

- `loadAllAvailableNetworkConfigs()` loads all found configs (or a specific one via `--network` flag)
- `initConfig()` is used by CLI commands (single network)

### Key config fields (from `buildConfig()`)

| Field                                  | Source                  | Notes                             |
| -------------------------------------- | ----------------------- | --------------------------------- |
| `NETWORK`                              | derived from filename   |                                   |
| `SERVER_ID`                            | `process.env.SERVER_ID` | default: "server-01"              |
| `ETHEREUM_CHAIN_ID`                    | env                     | 1 (mainnet) or 11155111 (sepolia) |
| `ETHEREUM_NODE_URL`                    | env                     | L1 RPC endpoint                   |
| `ETHEREUM_ARCHIVE_NODE_URL`            | env                     | Optional, for coinbase scraping   |
| `AZTEC_NODE_URL`                       | env                     | Aztec node RPC                    |
| `AZTEC_STAKING_PROVIDER_ID`            | env                     | Optional bigint                   |
| `AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS` | env                     | Optional 0x address               |
| `SAFE_ADDRESS`                         | env                     | Optional, enables rewards scraper |
| `SAFE_PROPOSALS_ENABLED`               | env                     | default: false                    |
| `MULTISIG_PROPOSER_PRIVATE_KEY`        | env                     | For Safe proposals                |
| `MIN_ETH_PER_ATTESTER`                 | env                     | default: "0.1"                    |
| `METRICS_BEARER_TOKEN`                 | env                     | Shared across all networks        |
| `STAKING_REWARDS_SPLIT_FROM_BLOCK`     | env                     | default: 23083526                 |
| `STAKING_REWARDS_SCRAPE_INTERVAL_MS`   | env                     | default: 3600000 (1hr)            |
| `GOOGLE_SHEETS_*`                      | env                     | Sheets export config              |
| `WEB3SIGNER_URLS`                      | env                     | Comma-separated URLs              |

### Known bug: dotenv pollution

`loadNetworkConfig()` calls `dotenv.config({ path })` which writes parsed values into `process.env`. When loading multiple networks sequentially:

1. Mainnet env file is loaded -> all values written to `process.env`
2. Testnet env file is loaded -> only testnet-specific values overwrite
3. Any key NOT in testnet's env file retains mainnet's value

This means testnet would inherit mainnet's `ETHEREUM_NODE_URL`, `AZTEC_NODE_URL`, etc. if those keys are missing from the testnet env file.

**Location**: `src/core/config/index.ts:62`

## Server Bootstrap Flow (`src/server/index.ts`)

1. Load all network configs (or specific one)
2. Init single Prometheus metrics registry on port 9464 (bearer auth from first config)
3. Init shared metric instruments (attester, publisher, rewards, entry queue, host)
4. Init config metrics per network
5. Create single `ScraperManager`
6. For each network, call `initializeNetwork()`:
   - Init network state (in-memory + file cache)
   - Auto-discover and merge keys files (`{network}-keys-*.json`)
   - Init attester states from cache
   - Update publisher/scraper config state
   - Start `ConfigReloader` and `KeysFileWatcher`
   - Register scrapers: rollup (60s), staking-provider (30s), publisher (30s), staking-rewards (hourly), entry-queue (10min), host (30s)
   - Init SafeGlobal client if configured
   - Init handlers
7. Start all scrapers
8. Set up graceful shutdown handlers

## Prometheus Metrics

All metrics prefixed with `aztec_butler_` and include a `network` label.

Single HTTP endpoint on port 9464, bearer-token authenticated.

### Metric names

- `config_info`, `nbrof_attesters_in_state`, `attester_on_chain_status_count`, `attesters_missing_coinbase`
- `attester_states_last_updated_timestamp`
- `publisher_load`, `publisher_eth_balance`
- `staking_provider_queue_length`, `staking_provider_config_info`, `staking_provider_last_scraped_timestamp`
- `staking_rewards_pending_units`, `staking_rewards_our_share_units`, `staking_rewards_earned_units`
- `entry_queue_length`, `entry_queue_time_per_attester_seconds`, `entry_queue_last_attester_timestamp`
- `entry_queue_provider_count`, `entry_queue_provider_next_arrival_timestamp`, `entry_queue_provider_next_missing_coinbase_timestamp`, `entry_queue_provider_last_arrival_timestamp`
- `entry_queue_last_scraped_timestamp`
- `host_dns_status`, `host_p2p_status`, `host_rpc_https_status`, `host_rpc_ip_status`
- `host_p2p_latency_ms`, `host_rpc_https_latency_ms`, `host_rpc_ip_latency_ms`, `host_info`

## Keys File System

**Pattern**: `{network}-keys-{serverId}-v{N}.json`
**Location**: data directory (`~/.local/share/aztec-butler/`)

Auto-discovery merges all files for a network, picks highest version per server ID. Hot-reloaded via chokidar (polling every 5s).

Schema:

```json
{
  "schemaVersion": 1,
  "remoteSigner": "...",
  "validators": [
    {
      "attester": { "eth": "0x...", "bls": "0x..." },
      "coinbase": "0x...",
      "publisher": "0x...",
      "feeRecipient": "0x..."
    }
  ]
}
```

## State Persistence

Per-network files in data directory:

- `{network}-attester-state.json`
- `{network}-staking-rewards-history.json`
- `{network}-entry-queue-stats.json`

Debounced writes (5s).

## L1 Contract Resolution

`EthereumClient` gets contract addresses (rollup, staking registry, GSE, governance) from `AztecClient.getNodeInfo()` which queries the Aztec node's `/node-info` endpoint. The node reports its own L1 contract addresses based on its deployment. This means each network's Aztec node provides its own addresses -- no hardcoded mapping needed per chain ID.

**Important for devnet**: Both testnet and devnet use Sepolia (chain ID 11155111) but have different contract deployments. Since addresses come from the Aztec node, not from chain ID, this should work correctly as long as each node reports its own contracts.

## Supported L1 Chains

`EthereumClient.ts` uses `viem/chains` with only `[sepolia, mainnet]`. Chain is selected by matching `chainId` from node info.
