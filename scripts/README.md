# Aztec Butler Scripts

Collection of bash scripts for common Aztec Butler operations.

## Prerequisites

- Node.js 22+
- Configured `.env` file (see main README)
- Keystores in `./keystores/` directory

## Available Scripts

### 1. Generate Scraper Configuration

```bash
./scripts/generate-scraper-config.sh
```

**What it does:**

- Finds all keystores in `./keystores/`
- Extracts attester and publisher addresses
- Queries staking provider from chain
- Checks for cached coinbase mappings
- Generates scraper configuration

**Output:** `~/.local/share/aztec-butler/{network}-scrape-config.json`

**Use case:** Create initial scraper config or regenerate after adding new keystores

---

### 2. Scrape Coinbase Addresses

```bash
./scripts/scrape-coinbases.sh
```

**What it does:**

- Finds all keystores in `./keystores/`
- Extracts attester addresses
- Scrapes `StakedWithProvider` events from StakingRegistry contract
- Maps each attester to their coinbase split contract address

**Output:** `~/.local/share/aztec-butler/{network}-mapped-coinbases.json`

**Use case:** Discover coinbase addresses for attesters (required for accurate scraper config)

**Note:** This can take several minutes as it scrapes historical blockchain events.

---

### 3. Add Keys to Staking Provider

```bash
# Without updating scraper config
./scripts/add-keys.sh keystores/examples/key1.json

# With automatic scraper config update
./scripts/add-keys.sh keystores/production/testnet/key1.json --update-config
```

**Arguments:**

- `<keystore-file>` - Path to keystore JSON file (required)
- `--update-config` - Also update scraper config with new keys (optional)

**What it does:**

- Loads the specified keystore file
- Checks for duplicate attesters in provider queue (prevents failures)
- Generates BLS registration data using GSE contract
- Creates `addKeysToProvider` calldata
- Optionally updates scraper config with new attesters/publishers

**Output:** Calldata JSON printed to console + attester addresses

**Use case:** Generate calldata to add new validators to your staking provider

**Important:** Copy the generated calldata and propose it to your Safe multisig manually.

---

### 4. Check Publisher ETH Balances

```bash
./scripts/check-publisher-eth.sh
```

**What it does:**

- Finds all keystores in `./keystores/`
- Extracts publisher addresses and calculates load per publisher
- Checks on-chain ETH balances
- Calculates required top-ups (0.1 ETH per attester load)
- Generates funding calldata for publishers needing ETH

**Output:**

- Balance report for each publisher
- Funding calldata JSON (if top-ups needed)

**Use case:** Ensure publishers have sufficient ETH before proposing blocks

---

### 5. Start Server

```bash
./scripts/start-server.sh
```

**What it does:**

- Starts Aztec Butler in server (scraper) mode
- Loads scraper configuration from `~/.local/share/aztec-butler/{network}-scrape-config.json`
- Starts Prometheus metrics exporter on port 9464
- Runs periodic scrapers for on-chain data

**Prerequisites:**

- Scraper config must be generated first (use `generate-scraper-config.sh`)
- Environment config at `~/.config/aztec-butler/{network}-base.env`

**Use case:** Run monitoring server with public-keys-only configuration

**Note:** Server uses scraper config only (no access to private keys). Press Ctrl+C to stop.

---

### 6. Get Metrics

```bash
# Using default token and URL
./scripts/get-metrics.sh

# Custom token and URL
./scripts/get-metrics.sh my-bearer-token http://localhost:9464/metrics
```

**What it does:**

- Fetches Prometheus metrics from running Aztec Butler server

**Use case:** Monitor scraper metrics, check server health

---

## Workflow Examples

### Initial Setup (New Staking Provider)

```bash
# 1. Add your keystores to ./keystores/
# 2. Configure your .env file
# 3. Generate scraper config
./scripts/generate-scraper-config.sh

# 4. Check publisher balances
./scripts/check-publisher-eth.sh

# 5. If balances are low, use the funding calldata to top up

# 6. Start monitoring server (optional - for metrics/monitoring)
./scripts/start-server.sh
```

### Adding New Validators

```bash
# 1. Add new keystore file to ./keystores/
# 2. Generate calldata and update scraper config
./scripts/add-keys.sh keystores/production/testnet/key2.json --update-config

# 3. Copy calldata and propose to Safe multisig
# 4. After transaction succeeds, verify with:
./scripts/check-publisher-eth.sh
```

### Periodic Maintenance

```bash
# Check publisher balances weekly
./scripts/check-publisher-eth.sh

# Re-scrape coinbases if attesters changed
./scripts/scrape-coinbases.sh
./scripts/generate-scraper-config.sh
```

---

## Direct CLI Usage

All scripts use `npm run cli` under the hood. You can also call commands directly:

```bash
# Show help
npm run cli -- help

# Generate scraper config
npm run cli -- generate-scraper-config

# Add keys with update
npm run cli -- add-keys keystores/examples/key1.json --update-config

# Check balances
npm run cli -- check-publisher-eth

# Scrape coinbases
npm run cli -- scrape-coinbases
```

---

## Configuration

Scripts read configuration from:

- **Testnet:** `~/.config/aztec-butler/testnet-base.env`
- **Mainnet:** `~/.config/aztec-butler/mainnet-base.env`

Set `NETWORK=testnet` or `NETWORK=mainnet` in your env file.

Required env variables:

- `NETWORK` - Network name (testnet/mainnet)
- `ETHEREUM_CHAIN_ID` - Chain ID (11155111 for Sepolia, 1 for mainnet)
- `ETHEREUM_NODE_URL` - Ethereum RPC URL
- `ETHEREUM_ARCHIVE_NODE_URL` - Archive node (required for scraping)
- `AZTEC_NODE_URL` - Aztec node URL
- `PROVIDER_ADMIN_ADDRESS` - Your staking provider admin address

---

## Output Locations

All generated files are saved to `~/.local/share/aztec-butler/`:

- `{network}-scrape-config.json` - Scraper configuration
- `{network}-mapped-coinbases.json` - Coinbase cache

---

## Troubleshooting

**"No keystore files found"**

- Ensure keystores are in `./keystores/**/*.json`
- Check file permissions

**"Staking provider not found"**

- Verify `PROVIDER_ADMIN_ADDRESS` is correct
- Ensure provider is registered on-chain

**"Attester already in queue"**

- The attester is already queued for addition
- Do not re-add (will fail on-chain)

**"Archive node required"**

- Set `ETHEREUM_ARCHIVE_NODE_URL` in your env file
- Archive nodes are needed for historical event queries
