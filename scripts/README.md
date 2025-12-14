# Aztec Butler Scripts

Collection of bash scripts for common Aztec Butler operations.

## Prerequisites

- Node.js 22+
- Configured `.env` file (see main README)
- Keystores in `./keystores/` directory

## Available Scripts

### 1. Process Private Keys

```bash
# Basic usage (default output name)
./scripts/process-private-keys.sh new-private-keys.json

# Custom output file
./scripts/process-private-keys.sh new-private-keys.json --output public-keys.json
```

**What it does:**

- Loads private keys from the specified JSON file
- Derives public keys:
  - **ETH Address:** Using `viem/accounts` - `privateKeyToAccount()` + `getAddress()`
  - **BLS Public Key:** Using `@aztec/foundation/crypto` - `computeBn254G1PublicKeyCompressed()`
- Validates all private keys (fails on malformed keys)
- Logs keys for future GCP storage (placeholder with TODO)
- Checks provider queue for duplicate attesters
- Generates output file with public keys only (excludes publisher and coinbase)

**Output:** `public-[input-filename].json` (or custom path with `--output`)

**Output contains:**

- ✅ `attester.eth` (derived address)
- ✅ `attester.bls` (derived public key)
- ✅ `feeRecipient` (preserved from input)
- ❌ NO `publisher` (assigned later in prepare-deployment)
- ❌ NO `coinbase` (not yet known)

**Use case:** Phase 2 of key flow - process newly generated private keys before deployment

**Security Note:** This command handles private keys. Input file should be protected and deleted after successful GCP storage.

---

### 2. Prepare Deployment

```bash
# Basic usage - automatically detects servers from available_publishers
./scripts/prepare-deployment.sh \
  prod-testnet-keyfile.json \
  new-public-keys.json \
  testnet_available_publisher_addresses.json

# Output files are automatically created, one per server in the publishers file
# Example output: prod-testnet-keyfile_server1_v1.json, prod-testnet-keyfile_server2_v1.json

# Custom output path base
./scripts/prepare-deployment.sh \
  prod-testnet-keyfile.json \
  new-public-keys.json \
  testnet_available_publisher_addresses.json \
  --output /path/to/output
```

**Arguments:**

- `production-keys` - Path to existing production keyfile with remoteSigner (required)
- `new-public-keys` - Path to new public keys from process-private-keys (required)
- `available-publishers` - Path to JSON object with server IDs as keys and publisher arrays as values (required)

**Available Publishers File Format:**

```json
{
  "server1": ["0x111...", "0x222..."],
  "server2": ["0x333...", "0x444..."],
  "server3": ["0x555...", "0x666..."]
}
```

The number of output files is automatically determined by the number of keys in this file.

**Options:**

- `--output <path>` - Custom output file path base (default: `<production-keys>`)

**What it does:**

1. **Loads and validates** all input files
2. **Checks for duplicates** - Fails if any attester address appears in both files
3. **Validates coinbases** - Fails if any validator has explicit zero-address coinbase (0x0000...0000)
4. **Checks publisher funding** - Queries ETH balance for each publisher:
   - Fails if any publisher has 0 ETH
   - Warns if any publisher has < MIN_ETH_PER_ATTESTER (0.1 ETH default)
5. **Generates output files:**
   - Automatically generates one file per server in available_publishers
   - Naming: `<production-keys>_<serverId>_v<N>.json`
   - Version number auto-increments from highest existing version
   - Merges all validators (existing + new)
   - Round-robin assigns publishers to ALL validators

**Multiple Servers:**

When available_publishers contains multiple server keys:

- Creates one file per server with ALL validators but different publisher sets
- Each server uses only its own publisher addresses
- Example with 3 servers:
  - `prod_server1_v1.json`: uses publishers from "server1"
  - `prod_server2_v1.json`: uses publishers from "server2"
  - `prod_server3_v1.json`: uses publishers from "server3"

**Output:**

- One or more `*_<serverId>_v<N>.json` files with merged validators and assigned publishers

**Use case:** Phase 3 of key flow - prepare final deployment files with publisher assignments

**Important:** After this step, manually deploy the generated file(s) to your node(s).

---

### 3. Get Provider ID

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

### 4. Scrape Coinbase Addresses

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

**Output:** `~/.local/share/aztec-butler/{network}-cached-coinbases.json`

**Use case:** Discover coinbase addresses for attesters (for monitoring and analysis)

**Performance:**

- First run: Several minutes (scrapes all historical events)
- Subsequent runs: Seconds (only scrapes new blocks)
- Use `--full` to force complete rescrape if needed
- Use `--provider-id` to skip RPC query for faster execution

---

### 6. Scrape Attester Status

```bash
# Check specific attester(s)
./scripts/scrape-attester-status.sh --address 0x123...
./scripts/scrape-attester-status.sh --address 0x123... --address 0x456...

# Output to file (creates/updates cache)
./scripts/scrape-attester-status.sh --output-file testnet-cached-attesters.json
```

**Flags:**

- `--address` - Check specific attester address(es)
- `--output-file` - Save results to file (auto-updates cache)
- `--network` - Specify network (testnet/mainnet)

**What it does:**

- Queries the Rollup contract for attester on-chain status
- Shows attester state: NONE, VALIDATING, ZOMBIE, or EXITING
- Displays effective balance for each attester
- Shows exit information (if attester is exiting)
- Can output to file for server monitoring

**Output:**

- Console: Attester details including address, status, balance, exit info
- File (if --output-file): Cached attesters JSON for server monitoring

**Use cases:**

- Check specific attester status
- Update attester cache for monitoring
- Debug attester issues
- Validate attester is in expected state before operations

**On-Chain States:**

- **NONE**: Not registered or funds withdrawn
- **VALIDATING**: Actively participating as validator
- **ZOMBIE**: Not validating but has funds (e.g., slashed below minimum)
- **EXITING**: In process of withdrawing funds

---

### 7. Check Publisher ETH Balances

```bash
./scripts/check-publisher-eth.sh
```

**What it does:**

- Finds all keystores in `./keystores/`
- Derives unique publisher addresses from attesters
- Checks on-chain ETH balances
- Calculates required top-ups (0.1 ETH per attester load)
- Generates funding calldata for publishers needing ETH

**Output:**

- Balance report for each publisher
- Funding calldata JSON (if top-ups needed)

**Use case:** Ensure publishers have sufficient ETH before proposing blocks

---

### 8. Start Server

```bash
./scripts/start-server.sh
```

**What it does:**

- Starts Aztec Butler in server (scraper) mode
- Loads cached attesters and publishers if available
- Starts Prometheus metrics exporter on port 9464
- Runs periodic scrapers for on-chain data

**Prerequisites:**

- Environment config at `~/.config/aztec-butler/{network}-base.env`
- Optional: Cached attesters at `~/.local/share/aztec-butler/{network}-cached-attesters.json`
- Optional: Available publishers at `~/.local/share/aztec-butler/{network}-available-publishers.json`

**Use case:** Run monitoring server

**Note:** Server uses cached data and config only (no access to private keys). Press Ctrl+C to stop.

---

### 9. Get Metrics

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

### Full Key Deployment Flow (New Validators)

```bash
# Phase 1: Generate private keys using aztec CLI (outside butler)
# aztec validator-keys generate --num 2 --output new-private-keys.json

# Phase 2: Process private keys
./scripts/process-private-keys.sh new-private-keys.json
# Output: public-new-private-keys.json

# Phase 3: Prepare deployment files
./scripts/prepare-deployment.sh \
  prod-testnet-keyfile.json \
  public-new-private-keys.json \
  testnet_available_publisher_addresses.json
# Output: prod-testnet-keyfile.json.new (ready to deploy)

# Phase 4: Deploy to servers (manual - outside butler)
# - Copy prod-testnet-keyfile.json.new to servers
# - Rename to prod-testnet-keyfile.json
# - Restart nodes

# Phase 5: Register keys to provider
./scripts/add-keys.sh prod-testnet-keyfile.json
# Copy calldata and propose to Safe multisig

# Cleanup: Delete private keys file after successful GCP storage
# rm new-private-keys.json
```

**With High Availability:**

```bash
# Phase 3 with HA mode (3-way split for redundancy)
./scripts/prepare-deployment.sh \
  prod-testnet-keyfile.json \
  public-new-private-keys.json \
  testnet_available_publisher_addresses.json \
  --high-availability-count 3
# Output: A_prod-testnet-keyfile.json.new, B_prod-testnet-keyfile.json.new, C_prod-testnet-keyfile.json.new

# Phase 4: Deploy different files to different servers
# Server 1: A_prod-testnet-keyfile.json.new
# Server 2: B_prod-testnet-keyfile.json.new
# Server 3: C_prod-testnet-keyfile.json.new
```

---

### Initial Setup (New Staking Provider)

```bash
# 1. Add your keystores to ./keystores/
# 2. Configure your .env file

# 3. Check publisher balances
./scripts/check-publisher-eth.sh

# 4. If balances are low, use the funding calldata to top up

# 5. Start monitoring server (optional - for metrics/monitoring)
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
# 2. Generate calldata
./scripts/add-keys.sh keystores/production/testnet/key2.json

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
```

### Monitoring Attester Status

```bash
# Check specific attester
./scripts/scrape-attester-status.sh --address 0x1234567890abcdef1234567890abcdef12345678

# Update attester cache for server monitoring
./scripts/scrape-attester-status.sh --output-file testnet-cached-attesters.json
```

---

## Direct CLI Usage

All scripts use `npm run cli` under the hood. You can also call commands directly:

```bash
# Show help
npm run cli -- help

# Process private keys
npm run cli -- process-private-keys <private-key-file>
npm run cli -- process-private-keys new-private-keys.json --output public-keys.json

# Prepare deployment
npm run cli -- prepare-deployment \
  --production-keys prod-testnet-keyfile.json \
  --new-public-keys public-new-private-keys.json \
  --available-publishers testnet_available_publisher_addresses.json

# Prepare deployment with high availability
npm run cli -- prepare-deployment \
  --production-keys prod-testnet-keyfile.json \
  --new-public-keys public-new-private-keys.json \
  --available-publishers testnet_available_publisher_addresses.json \
  --high-availability-count 3

# Get provider ID
npm run cli -- get-provider-id 0x1234567890abcdef1234567890abcdef12345678

# Add keys
npm run cli -- get-add-keys-to-staking-provider-calldata --keystore-paths keystores/examples/key1.json

# Check balances
npm run cli -- get-publisher-eth

# Scrape coinbases (incremental)
npm run cli -- scrape-coinbases
npm run cli -- scrape-coinbases --provider-id 123

# Scrape coinbases (full rescrape)
npm run cli -- scrape-coinbases --full

# Scrape from specific block
npm run cli -- scrape-coinbases --from-block 12345678

# Scrape attester status (specific addresses)
npm run cli -- scrape-attester-status --address 0x123...
npm run cli -- scrape-attester-status --address 0x123... --address 0x456...

# Scrape attester status and save to file
npm run cli -- scrape-attester-status --output-file testnet-cached-attesters.json
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

Optional env variables for Safe integration:

- `SAFE_ADDRESS` - Safe multisig wallet address (for monitoring/proposals)
- `SAFE_PROPOSALS_ENABLED` - Set to `true` to enable automatic Safe transaction proposals (default: `false`)
- `MULTISIG_PROPOSER_PRIVATE_KEY` - Private key of a Safe signer (required if SAFE_PROPOSALS_ENABLED=true)
- `SAFE_API_KEY` - Safe API key for transaction service (required if SAFE_PROPOSALS_ENABLED=true)

**Note:** Setting `SAFE_ADDRESS` without `SAFE_PROPOSALS_ENABLED=true` will enable Safe monitoring (tracking pending transactions) but will NOT automatically create transaction proposals. To enable automatic proposals for publisher top-ups, set `SAFE_PROPOSALS_ENABLED=true`.

---

## Output Locations

All generated files are saved to `~/.local/share/aztec-butler/`:

- `{network}-cached-attesters.json` - Cached attester data
- `{network}-cached-coinbases.json` - Coinbase cache
- `{network}-available-publishers.json` - Available publisher addresses (for server mode)

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
