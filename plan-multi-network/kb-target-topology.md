# Knowledge Base: Target Node Topology & Config Mapping

## Target State

One aztec-butler process on gremlin-3 monitoring three Aztec networks across three servers.

```
gremlin-3 (aztec-butler, single process)
  ├── mainnet config
  │   ├── L1: beast-4 Ethereum mainnet RPC
  │   ├── L2: beast-4 Aztec RPC :8085
  │   ├── hosts: beast-3 (:8085, p2p:40404), beast-4 (:8085, p2p:40404)
  │   └── keys: mainnet-keys-beast-3-v1.json, mainnet-keys-beast-4-v1.json
  │
  ├── testnet config
  │   ├── L1: beast-5 Sepolia RPC
  │   ├── L2: beast-5 Aztec RPC :8087
  │   ├── hosts: beast-5 (:8087, p2p:40403)
  │   └── keys: none yet (empty attester/publisher lists -- this is fine)
  │
  └── devnet config
      ├── L1: beast-5 Sepolia RPC
      ├── L2: beast-5 Aztec RPC :8086
      ├── hosts: beast-5 (:8086, p2p:40402)
      └── keys: none yet
```

## Per-Network Config Values

### mainnet (existing, no changes)

| Key                                    | Value                                            |
| -------------------------------------- | ------------------------------------------------ |
| `NETWORK`                              | `mainnet`                                        |
| `ETHEREUM_CHAIN_ID`                    | `1`                                              |
| `ETHEREUM_NODE_URL`                    | `https://rpc.mainnet.eth.beast-4.aztlanlabs.xyz` |
| `ETHEREUM_ARCHIVE_NODE_URL`            | `https://ethereum-rpc.publicnode.com`            |
| `AZTEC_NODE_URL`                       | `http://135.125.170.191:8085`                    |
| `AZTEC_STAKING_PROVIDER_ID`            | `4`                                              |
| `AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS` | treasury address                                 |
| `SAFE_ADDRESS`                         | treasury address                                 |
| `SAFE_API_KEY`                         | from vault                                       |
| `MULTISIG_PROPOSER_PRIVATE_KEY`        | from vault                                       |
| `MIN_ETH_PER_ATTESTER`                 | `0.05`                                           |
| `METRICS_BEARER_TOKEN`                 | shared token                                     |
| Google Sheets config                   | configured                                       |

### testnet (new)

| Key                                    | Value                                            |
| -------------------------------------- | ------------------------------------------------ |
| `NETWORK`                              | `testnet`                                        |
| `ETHEREUM_CHAIN_ID`                    | `11155111`                                       |
| `ETHEREUM_NODE_URL`                    | `https://rpc.sepolia.eth.beast-5.aztlanlabs.xyz` |
| `ETHEREUM_ARCHIVE_NODE_URL`            | `https://ethereum-sepolia-rpc.publicnode.com`    |
| `AZTEC_NODE_URL`                       | `http://51.89.11.124:8087`                       |
| `AZTEC_STAKING_PROVIDER_ID`            | _(not set)_                                      |
| `AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS` | _(not set)_                                      |
| `SAFE_ADDRESS`                         | _(not set)_                                      |
| `METRICS_BEARER_TOKEN`                 | shared token                                     |
| Google Sheets config                   | _(not set)_                                      |

### devnet (new)

| Key                                    | Value                                            |
| -------------------------------------- | ------------------------------------------------ |
| `NETWORK`                              | `devnet`                                         |
| `ETHEREUM_CHAIN_ID`                    | `11155111`                                       |
| `ETHEREUM_NODE_URL`                    | `https://rpc.sepolia.eth.beast-5.aztlanlabs.xyz` |
| `ETHEREUM_ARCHIVE_NODE_URL`            | `https://ethereum-sepolia-rpc.publicnode.com`    |
| `AZTEC_NODE_URL`                       | `http://51.89.11.124:8086`                       |
| `AZTEC_STAKING_PROVIDER_ID`            | _(not set)_                                      |
| `AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS` | _(not set)_                                      |
| `SAFE_ADDRESS`                         | _(not set)_                                      |
| `METRICS_BEARER_TOKEN`                 | shared token                                     |
| Google Sheets config                   | _(not set)_                                      |

## Hosts Config Output (what the template produces)

### mainnet-hosts.json (unchanged)

```json
{
  "beast-3": {
    "ip": "146.59.108.112",
    "base_domain": "beast-3.aztlanlabs.xyz",
    "services": {
      "p2p": { "port": 40404 },
      "aztec_rpc": { "port": 8085 }
    }
  },
  "beast-4": {
    "ip": "135.125.170.191",
    "base_domain": "beast-4.aztlanlabs.xyz",
    "services": {
      "p2p": { "port": 40404 },
      "aztec_rpc": { "port": 8085 }
    }
  }
}
```

### testnet-hosts.json (already templated but unused)

```json
{
  "beast-5": {
    "ip": "51.89.11.124",
    "base_domain": "beast-5.aztlanlabs.xyz",
    "services": {
      "p2p": { "port": 40403 },
      "aztec_rpc": { "port": 8087 }
    }
  }
}
```

### devnet-hosts.json (new)

```json
{
  "beast-5": {
    "ip": "51.89.11.124",
    "base_domain": "beast-5.aztlanlabs.xyz",
    "services": {
      "p2p": { "port": 40402 },
      "aztec_rpc": { "port": 8086 }
    }
  }
}
```

## What Works Without Keys Files

When butler starts a network with no keys files, it:

1. Logs a warning: "No keys files found. Server will start with empty attester/publisher lists."
2. Initializes empty state
3. Still runs all scrapers -- most will simply report zero/empty metrics
4. Host scraper works independently (checks DNS/P2P/RPC of hosts from hosts.json)
5. Entry queue scraper works independently (reads on-chain queue data)
6. Staking rewards scraper is skipped if `SAFE_ADDRESS` is not set

So testnet/devnet will immediately provide host connectivity monitoring and entry queue data, even without any validators registered.

## Devnet Contract Address Consideration

Devnet uses a custom `registry_contract_address: 0x52945c29d2788ccb076e910509c0449bfcbe29e6` in the inventory. The butler does NOT use this directly -- it gets all L1 contract addresses from `AztecClient.getNodeInfo()`, which queries the Aztec node. The devnet Aztec node at `:8086` should report its own contracts.

However, if the devnet node is a newer/different version (v4.0.0-devnet.2-patch.1) with a different NodeInfo schema or different contract structure, there could be incompatibilities with the butler's `@aztec/aztec.js` client version. This should be validated during implementation.

## Prometheus Metric Labels After Multi-Network

All metrics already include `network` as a label. After enabling all three networks:

```promql
# See all networks
aztec_butler_config_info

# Filter by network
aztec_butler_host_p2p_status{network="testnet"}
aztec_butler_entry_queue_length{network="devnet"}
aztec_butler_nbrof_attesters_in_state{network="mainnet"}
```

No Prometheus config changes needed -- same single scrape target.
