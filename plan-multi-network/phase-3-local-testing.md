# Phase 3: Local Testing Against Testnet and Devnet

## Prerequisites

- Phase 1 (remove `@aztec/aztec.js`) is merged
- Phase 2 (configurable port) is merged
- `npm run build` succeeds

## Steps

### 1. Create testnet config

Create `~/.config/aztec-butler/testnet-base.env`:

```env
NETWORK=testnet
ETHEREUM_CHAIN_ID=11155111
ETHEREUM_NODE_URL=https://rpc.sepolia.eth.beast-5.aztlanlabs.xyz
ETHEREUM_ARCHIVE_NODE_URL=https://ethereum-sepolia-rpc.publicnode.com
AZTEC_NODE_URL=http://51.89.11.124:8087
MIN_ETH_PER_ATTESTER=0.1
METRICS_BEARER_TOKEN=local-test-token
METRICS_PORT=9465
```

### 2. Create devnet config

Create `~/.config/aztec-butler/devnet-base.env`:

```env
NETWORK=devnet
ETHEREUM_CHAIN_ID=11155111
ETHEREUM_NODE_URL=https://rpc.sepolia.eth.beast-5.aztlanlabs.xyz
ETHEREUM_ARCHIVE_NODE_URL=https://ethereum-sepolia-rpc.publicnode.com
AZTEC_NODE_URL=http://51.89.11.124:8086
MIN_ETH_PER_ATTESTER=0.1
METRICS_BEARER_TOKEN=local-test-token
METRICS_PORT=9466
```

### 3. Create testnet hosts config

Create `~/.config/aztec-butler/testnet-hosts.json`:

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

### 4. Create devnet hosts config

Create `~/.config/aztec-butler/devnet-hosts.json`:

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

### 5. Test each network individually

```bash
# Testnet
node dist/index.js serve --network testnet

# In another terminal, verify metrics:
curl -H "Authorization: Bearer local-test-token" http://localhost:9465/metrics

# Devnet
node dist/index.js serve --network devnet

# Verify:
curl -H "Authorization: Bearer local-test-token" http://localhost:9466/metrics
```

### 6. Verify mainnet still works (regression test)

```bash
node dist/index.js serve --network mainnet
curl -H "Authorization: Bearer <your-mainnet-token>" http://localhost:9464/metrics
```

## What to Check

- Process starts without errors for each network
- `AztecClient.getNodeInfo()` succeeds (appears in init logs as "Rollup scraper initialized for chain ID: ...")
- Host scraper reports P2P/RPC status for beast-5
- Metrics endpoint responds on the configured port
- `network="testnet"` / `network="devnet"` labels appear in metrics output
- No keys files warning appears (expected -- no validators on testnet/devnet yet)
- Entry queue scraper runs (may report 0 length, that's fine)

## Expected Behavior Without Keys

For testnet/devnet (no keys files):

- Attester metrics: all zeros
- Publisher metrics: empty
- Staking rewards scraper: skipped (no SAFE_ADDRESS)
- Host metrics: active (P2P, RPC checks for beast-5)
- Entry queue metrics: active (reads on-chain data)
- Config info metric: reports network name and config
