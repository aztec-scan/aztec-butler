# Aztec Butler Scripts

Collection of bash scripts for common Aztec Butler operations.

## Prerequisites

- Node.js 22+
- Configured `.env` file (see main README)
- Keystores in `./keystores/` directory

## Available Scripts

### 1. Get Provider ID

```bash
./scripts/get-provider-id.sh <admin-address>
```

**What it does:**

- Queries the staking registry contract for provider info
- Returns provider ID, admin address, take rate, and rewards recipient
- Useful for getting your provider ID to use in other commands

**Output:** Provider details printed to console

**Use case:** Get your staking provider ID once and use it in subsequent commands to skip RPC calls

**Example:**

```bash
# Query provider ID for your admin address
./scripts/get-provider-id.sh 0x1234567890abcdef1234567890abcdef12345678

# Use the returned provider ID in other commands:
npm run cli -- scrape-coinbases --provider-id 123
npm run cli -- generate-scraper-config --provider-id 123
```

---

### 2. Generate Scraper Configuration

```bash
# Using admin address from config (queries chain)
./scripts/generate-scraper-config.sh

# Using provider ID directly (faster, skips query)
./scripts/generate-scraper-config.sh --provider-id 123
```

**What it does:**

- Finds all keystores in `./keystores/`
- Extracts attester and publisher addresses
- Queries staking provider from chain (or uses provided ID)
- Checks for cached coinbase mappings
- Generates scraper configuration

**Output:** `~/.local/share/aztec-butler/{network}-scrape-config.json`

**Use case:** Create initial scraper config or regenerate after adding new keystores

**Pro tip:** Use `--provider-id` to skip the RPC query for faster execution

---

### 3. Scrape Coinbase Addresses

```bash
# Incremental scrape (default - fast, uses cache)
./scripts/scrape-coinbases.sh

# Full rescrape from deployment block
./scripts/scrape-coinbases.sh --full

# Custom start block
./scripts/scrape-coinbases.sh --from-block 12345678

# Using provider ID directly (faster, skips query)
./scripts/scrape-coinbases.sh --provider-id 123

# Combine flags for full rescrape with provider ID
./scripts/scrape-coinbases.sh --full --provider-id 123
```

**Modes:**

- **Default (incremental)**: Scrapes only new blocks since last run (seconds, recommended)
- **`--full`**: Full rescrape from deployment block (minutes, useful for validation)
- **`--from-block N`**: Start from specific block number (useful for recovery)
- **`--provider-id N`**: Use provider ID directly instead of querying from admin address

**What it does:**

- Finds all keystores in `./keystores/`
- Extracts attester addresses
- Scrapes `StakedWithProvider` events from StakingRegistry contract
- Maps each attester to their coinbase split contract address
- Merges with existing cache if available
- Validates for coinbase conflicts

**Output:** `~/.local/share/aztec-butler/{network}-mapped-coinbases.json`

**Use case:** Discover coinbase addresses for attesters (required for accurate scraper config)

**Performance:**

- First run: Several minutes (scrapes all historical events)
- Subsequent runs: Seconds (only scrapes new blocks)
- Use `--full` to force complete rescrape if needed
- Use `--provider-id` to skip RPC query for faster execution

---

### 4. Scrape Attester Status

```bash
# Show all attesters from scraper config (default)
./scripts/scrape-attester-status.sh

# Show only active attesters from scraper config
./scripts/scrape-attester-status.sh --active

# Show only queued attesters from scraper config
./scripts/scrape-attester-status.sh --queued

# Show both active and queued from scraper config (same as default)
./scripts/scrape-attester-status.sh --active --queued

# Show ALL active attesters on-chain (not limited to config)
./scripts/scrape-attester-status.sh --all-active

# Show ALL queued attesters on-chain (not limited to config)
./scripts/scrape-attester-status.sh --all-queued

# Show ALL attesters on-chain
./scripts/scrape-attester-status.sh --all-active --all-queued

# Check specific attester(s)
./scripts/scrape-attester-status.sh --address 0x123...
./scripts/scrape-attester-status.sh --address 0x123... --address 0x456...
```

**Flags:**

- `--active` - Show only active attesters from scraper config
- `--queued` - Show only queued attesters from scraper config
- `--all-active` - Show ALL active attesters on-chain (ignores config)
- `--all-queued` - Show ALL queued attesters on-chain (ignores config)
- `--address` - Check specific attester address(es)

**What it does:**

- Queries the Rollup contract for attester on-chain status
- Shows attester state: NONE, VALIDATING, ZOMBIE, or EXITING
- Displays effective balance for each attester
- Shows exit information (if attester is exiting)
- Default behavior: shows attesters from scraper-config
- With `--all-*` flags: shows all on-chain attesters regardless of config

**Output:**

- Active attesters: address, status, balance, exit info
- Queued attesters: position in queue and address
- Config attesters: includes coinbase and publisher from config
- Specific attesters: full details including withdrawer and exit status

**Use cases:**

- Monitor your attesters' state transitions (default mode)
- Check if your attesters are active vs queued
- See all active/queued attesters on the network
- Debug attester issues
- Validate attester is in expected state before operations

**On-Chain States:**

- **NONE**: Not registered or funds withdrawn
- **VALIDATING**: Actively participating as validator
- **ZOMBIE**: Not validating but has funds (e.g., slashed below minimum)
- **EXITING**: In process of withdrawing funds

---

### 5. Add Keys to Staking Provider

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

### 6. Check Publisher ETH Balances

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

### 7. Start Server

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

### 8. Get Metrics

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

### Optimized Workflow (Using Provider ID)

```bash
# 1. Query your provider ID once and save it
./scripts/get-provider-id.sh 0x1234567890abcdef1234567890abcdef12345678
# Output: Provider ID: 123

# 2. Use provider ID in all subsequent commands (faster!)
./scripts/scrape-coinbases.sh --provider-id 123
./scripts/generate-scraper-config.sh --provider-id 123

# 3. For full rescrapes with provider ID
./scripts/scrape-coinbases.sh --full --provider-id 123
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

# Re-scrape coinbases if attesters changed (use provider ID for speed)
PROVIDER_ID=123  # Your provider ID
./scripts/scrape-coinbases.sh --provider-id $PROVIDER_ID
./scripts/generate-scraper-config.sh --provider-id $PROVIDER_ID
```

### Monitoring Attester Status

```bash
# Check your attesters from config (default)
./scripts/scrape-attester-status.sh

# Check only your active attesters
./scripts/scrape-attester-status.sh --active

# Check only your queued attesters
./scripts/scrape-attester-status.sh --queued

# Check all active attesters on the network
./scripts/scrape-attester-status.sh --all-active

# Check if attesters are stuck in queue
./scripts/scrape-attester-status.sh --all-queued

# Check specific attester after adding keys
./scripts/scrape-attester-status.sh --address 0x1234567890abcdef1234567890abcdef12345678

# Full overview of all on-chain attesters
./scripts/scrape-attester-status.sh --all-active --all-queued
```

---

## Direct CLI Usage

All scripts use `npm run cli` under the hood. You can also call commands directly:

```bash
# Show help
npm run cli -- help

# Get provider ID
npm run cli -- get-provider-id 0x1234567890abcdef1234567890abcdef12345678

# Generate scraper config
npm run cli -- generate-scraper-config
npm run cli -- generate-scraper-config --provider-id 123

# Add keys with update
npm run cli -- add-keys keystores/examples/key1.json --update-config

# Check balances
npm run cli -- check-publisher-eth

# Scrape coinbases (incremental)
npm run cli -- scrape-coinbases
npm run cli -- scrape-coinbases --provider-id 123

# Scrape coinbases (full rescrape)
npm run cli -- scrape-coinbases --full

# Scrape from specific block
npm run cli -- scrape-coinbases --from-block 12345678

# Scrape attester status (default - shows your config attesters)
npm run cli -- scrape-attester-status

# Scrape attester status (only active from config)
npm run cli -- scrape-attester-status --active

# Scrape attester status (only queued from config)
npm run cli -- scrape-attester-status --queued

# Scrape attester status (all active on-chain)
npm run cli -- scrape-attester-status --all-active

# Scrape attester status (all queued on-chain)
npm run cli -- scrape-attester-status --all-queued

# Scrape attester status (specific addresses)
npm run cli -- scrape-attester-status --address 0x123...
npm run cli -- scrape-attester-status --address 0x123... --address 0x456...
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
- `AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS` - Your staking provider admin address (optional if using --provider-id)

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

- Verify `AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS` is correct
- Ensure provider is registered on-chain
- Or use `--provider-id` flag if you know your provider ID

**"Attester already in queue"**

- The attester is already queued for addition
- Do not re-add (will fail on-chain)

**"Archive node required"**

- Set `ETHEREUM_ARCHIVE_NODE_URL` in your env file
- Archive nodes are needed for historical event queries
