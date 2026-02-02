# Aztec Butler

A tool for helping out with managing multiple aztec nodes with an opinionated workflow and set-up.

## Requirements

- **Node.js v22.0.0 or higher**

## Development

### Running CLI Commands

The shell scripts in `scripts/` use `tsx` for TypeScript execution (compatible with Node.js v22):

```bash
# Run any script directly
./scripts/scrape-coinbases.sh --network mainnet
./scripts/get-queue-stats.sh --network mainnet

# Or run CLI commands directly with tsx
npx tsx cli.ts scrape-coinbases --network mainnet
npx tsx cli.ts get-queue-stats --network mainnet --json
```

### Building for Production

```bash
npm run build
npm start -- serve --network mainnet
```

## Attester State Diagram

```mermaid
stateDiagram-v2
    [*] --> NEW: Attester keys created

    NEW --> IN_STAKING_PROVIDER_QUEUE: isInProviderQueue = true<br/>(attester added to provider queue)

    IN_STAKING_PROVIDER_QUEUE --> ROLLUP_ENTRY_QUEUE: !isInProviderQueue && onChainView.status = NONE<br/>(left provider queue, now in rollup entry queue)
    IN_STAKING_PROVIDER_QUEUE --> ACTIVE: !isInProviderQueue && onChainView.status = VALIDATING<br/>(left provider queue, went directly active)

    ROLLUP_ENTRY_QUEUE --> ACTIVE: onChainView.status = VALIDATING<br/>(began validating)

    ACTIVE --> NO_LONGER_ACTIVE: onChainView.status = EXITING or ZOMBIE<br/>(attester withdrawn/slashed)

    NO_LONGER_ACTIVE --> [*]
```

**State Descriptions:**

- **NEW**: Initial state for newly discovered attesters (not yet in any on-chain queue)
- **IN_STAKING_PROVIDER_QUEUE**: Attester address exists in the staking provider's queue on the staking contract
- **ROLLUP_ENTRY_QUEUE**: Attester has an on-chain view in the rollup contract with status = NONE (in global entry queue, waiting to become active)
- **ACTIVE**: Attester is actively validating on the rollup contract (status = VALIDATING)
- **NO_LONGER_ACTIVE**: Attester has been withdrawn or slashed (terminal state)

**State Transitions (purely on-chain):**

State transitions are determined exclusively by on-chain data:

- `isInProviderQueue`: Attester address exists in the staking provider's queue array (from staking contract)
- `onChainView`: Attester data from rollup contract (includes status and other attester info)
- `onChainView.status`: On-chain status from rollup contract (NONE, VALIDATING, ZOMBIE, EXITING)

**Coinbase Tracking (separate from state):**

Coinbase addresses are tracked separately for operational awareness but do not affect state transitions. The entry queue scraper reports which attesters are missing coinbase configuration via:

- `providerNextMissingCoinbaseArrivalTimestamp`: When the next attester without coinbase will reach the front of the queue
- `providerNextMissingCoinbaseAddress`: Address of that attester

See [src/server/state/index.ts](./src/server/state/index.ts) and [src/server/state/transitions.ts](./src/server/state/transitions.ts) for implementation details.

## Documentation

- **[Operator Guide](./docs/operator-guide/README.md)** - Complete guide for validator key management (generate, deploy, register)
- **[Daemon Setup](./daemon/README.md)** - Run aztec-butler as a systemd service with Prometheus metrics

## Configuration

### Unified Keys File Format

Aztec Butler uses a unified configuration format for both validator nodes and the monitoring server. Keys files follow the naming convention:

```
[network]-keys-[serverId]-v[version].json
```

Examples:

- `mainnet-keys-A-v1.json`
- `mainnet-keys-B-v2.json`
- `testnet-keys-validator1-v3.json`

**File structure:**

```json
{
  "schemaVersion": 1,
  "remoteSigner": "https://signer.example.com:8080",
  "validators": [
    {
      "attester": {
        "eth": "0x...",
        "bls": "0x..."
      },
      "coinbase": "0x...",
      "feeRecipient": "0x...",
      "publisher": "0x..."
    }
  ]
}
```

**Server Auto-Discovery:**

The monitoring server automatically discovers and merges all keys files matching the pattern `{network}-keys-*.json` in the data directory. For each server ID, only the highest version number is loaded to avoid conflicts.

**Workflow:**

1. **Generate keys files:**

   ```bash
   aztec-butler prepare-deployment \
     --production-keys existing-keys.json \
     --new-public-keys new-keys.json \
     --available-publishers publishers.json \
     --network mainnet
   ```

2. **Populate coinbase addresses:**

   ```bash
   # Scrape coinbase addresses from on-chain events
   aztec-butler scrape-coinbases --network mainnet

   # Fill coinbases into keys files
   aztec-butler fill-coinbases --network mainnet --keys-file mainnet-keys-A-v1.json
   ```

3. **Deploy:**

   ```bash
   # Copy keys files to monitoring server's data directory
   scp mainnet-keys-A-v1.json server:~/.local/share/aztec-butler/

   # Start monitoring server (auto-discovers keys files)
   aztec-butler start-server --network mainnet
   ```

**Note:** The `coinbase` field is optional in keys files. New validators created by `prepare-deployment` won't have coinbase addresses initially. Use the `fill-coinbases` command after running `scrape-coinbases` to populate them.

## Running as a Service

To run aztec-butler as a systemd service, see the [daemon setup guide](./daemon/README.md). The daemon runs the butler in server mode, providing Prometheus metrics and automated monitoring for your Aztec nodes.

### Roadmap

1. merge attester-scraper and entry-queue stats scraper. (they both scrape from the same resource and can be done in one go)
