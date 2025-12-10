# Phase 1: Foundation - Implementation Plan

## Overview

Phase 1 establishes the foundational architectural changes needed for the "Stars Align" project. This phase focuses on creating new configuration formats, removing Docker directory dependencies, and preparing both CLI and Scraper modes for complete separation.

**Goal**: Enable Butler to operate in two distinct modes:

1. **CLI Mode** - On operator's machine with private keys for sensitive operations
2. **Scraper Mode** - On monitoring server with only public keys for metrics collection

---

## Current State Analysis

### Key Dependencies to Remove

The current codebase has deep integration with Docker directory structure:

1. **`getDockerDirData()` usage**:
   - CLI: `src/cli/index.ts:12` - reads keystores for all operations
   - Server: `src/server/index.ts:79` - loads keystores to derive addresses
   - Scrapers: Both `StakingProviderScraper` and `PublisherScraper` call `getDockerDirData()`

2. **Configuration system**:
   - Current: Single `basic` config file at `~/.config/aztec-butler/basic`
   - Parses `.env` files from Docker directory for RPC URLs
   - Uses `AZTEC_DOCKER_DIR` as primary data source

3. **State Management**:
   - `AttesterState.WAITING_FOR_MULTISIG_SIGN` state exists but should be removed
   - Attesters derive addresses from keystores in Docker directory
   - Publishers derive addresses from private keys in keystores

---

## Phase 1 Implementation Tasks

### Task 1: Design and Implement New Configuration Formats

#### 1.1 Base Configuration Format (for both modes)

**File**: `{aztec-network}-base.env` (e.g., `testnet-base.env`, `mainnet-base.env`)  
**Location**: XDG config directory (`~/.config/aztec-butler/`)

**Network Naming**:

- Aztec networks: `testnet` or `mainnet`
- Ethereum networks referenced by chainId: `11155111` (Sepolia, for Aztec testnet) or `1` (Mainnet, for Aztec mainnet)

**Contents**:

```bash
# Network identification
NETWORK=testnet

# Ethereum Configuration (by chainId)
ETHEREUM_CHAIN_ID=11155111
ETHEREUM_NODE_URL=https://eth-sepolia.g.alchemy.com/v2/...
ETHEREUM_ARCHIVE_NODE_URL=https://eth-sepolia.g.alchemy.com/v2/...

# Aztec Configuration
AZTEC_NODE_URL=http://localhost:8080

# Staking Provider Configuration
PROVIDER_ADMIN_ADDRESS=0x...

# Safe Multisig Configuration (optional, for CLI proposals)
SAFE_ADDRESS=0x...
MULTISIG_PROPOSER_PRIVATE_KEY=0x...
SAFE_API_KEY=...

# Publisher Configuration
MIN_ETH_PER_ATTESTER=0.1

# Metrics Configuration (Scraper mode only)
METRICS_BEARER_TOKEN=default-api-key

# Staking Rewards Configuration (optional)
STAKING_REWARDS_SPLIT_FROM_BLOCK=23083526
STAKING_REWARDS_SCRAPE_INTERVAL_MS=3600000
GOOGLE_SHEETS_SPREADSHEET_ID=...
GOOGLE_SHEETS_RANGE=DailyTotal!A1
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=...
GOOGLE_SHEETS_COINBASES_RANGE=Coinbases!A1
GOOGLE_SHEETS_DAILY_PER_COINBASE_RANGE=DailyPerCoinbase!A1
GOOGLE_SHEETS_DAILY_EARNED_RANGE=DailyEarned!A1
```

**Implementation Files**:

- Update `src/core/config/index.ts`:
  - Change `DEFAULT_CONFIG_FILE_PATH` from `/basic` to detect network configs
  - Add network selection logic (default to first found, or require flag)
  - Add `NETWORK` field to config schema
  - Remove `AZTEC_DOCKER_DIR` requirement for Scraper mode

**Acceptance Criteria**:

- [ ] Config loader can find and load `{aztec-network}-base.env` files
- [ ] Multi-network support: if both `testnet-base.env` and `mainnet-base.env` exist
- [ ] CLI defaults to testnet (or requires `--network` flag if multiple exist)
- [ ] Scraper can load all available network configs simultaneously
- [ ] ETHEREUM_CHAIN_ID field added and validated

---

#### 1.2 Scraper Configuration Format

**File**: `{aztec-network}-scrape-config.json` (e.g., `testnet-scrape-config.json`)  
**Location**: XDG data directory (`~/.local/share/aztec-butler/`)

**Zod Schema** (create in `src/types/scraper-config.ts`):

```typescript
import { z } from "zod";

export const ScraperAttesterSchema = z.object({
  address: z.string().startsWith("0x").length(42),
  coinbase: z.string().startsWith("0x").length(42),
});

export const ScraperPublisherSchema = z.object({
  address: z.string().startsWith("0x").length(42),
});

export const ScraperConfigSchema = z.object({
  network: z.string(),
  stakingProviderId: z.bigint(),
  stakingProviderAdmin: z.string().startsWith("0x").length(42),
  attesters: z.array(ScraperAttesterSchema),
  publishers: z.array(ScraperPublisherSchema),
  lastUpdated: z.string().datetime(),
  version: z.literal("1.0"),
});

export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;
export type ScraperAttester = z.infer<typeof ScraperAttesterSchema>;
export type ScraperPublisher = z.infer<typeof ScraperPublisherSchema>;
```

**Example**:

```json
{
  "network": "testnet",
  "stakingProviderId": "1",
  "stakingProviderAdmin": "0x1234...",
  "attesters": [
    {
      "address": "0xabc...",
      "coinbase": "0x0000000000000000000000000000000000000000"
    }
  ],
  "publishers": [
    {
      "address": "0xdef..."
    }
  ],
  "lastUpdated": "2025-12-10T10:00:00Z",
  "version": "1.0"
}
```

**Implementation Files**:

- Create `src/types/scraper-config.ts` with Zod schemas
- Create `src/core/utils/scraperConfigOperations.ts`:
  - `loadScraperConfig(network: string): Promise<ScraperConfig>`
  - `saveScraperConfig(config: ScraperConfig): Promise<void>`
  - `validateScraperConfig(config: unknown): ScraperConfig`

**Acceptance Criteria**:

- [ ] Zod schema defined and exported
- [ ] Load/save functions work with XDG data directory
- [ ] Schema validation throws clear errors for invalid configs
- [ ] File operations handle missing files gracefully

---

#### 1.3 Coinbase Mapping Cache Format

**File**: `{aztec-network}-mapped-coinbases.json`  
**Location**: XDG data directory (`~/.local/share/aztec-butler/`)

**Zod Schema** (add to `src/types/scraper-config.ts`):

```typescript
export const MappedCoinbaseSchema = z.object({
  attesterAddress: z.string().startsWith("0x").length(42),
  coinbaseAddress: z.string().startsWith("0x").length(42),
  blockNumber: z.bigint(),
  blockHash: z.string().startsWith("0x"),
  timestamp: z.number(),
});

export const CoinbaseMappingCacheSchema = z.object({
  network: z.string(),
  stakingProviderId: z.bigint(),
  lastScrapedBlock: z.bigint(),
  mappings: z.array(MappedCoinbaseSchema),
  scrapedAt: z.string().datetime(),
  version: z.literal("1.0"),
});

export type CoinbaseMappingCache = z.infer<typeof CoinbaseMappingCacheSchema>;
export type MappedCoinbase = z.infer<typeof MappedCoinbaseSchema>;
```

**Acceptance Criteria**:

- [ ] Schema created and validated
- [ ] Can store/load coinbase mappings with block provenance
- [ ] Includes metadata for incremental scraping

---

### Task 2: Create CLI Command - Generate Scraper Config

**Command**: `aztec-butler generate-scraper-config [options]`

**Purpose**: Extract public keys from private key files and generate scraper config

**Implementation File**: `src/cli/commands/generate-scraper-config.ts`

**Input Sources**:

1. Attester keys from keystores (same format as currently used)
2. Publisher keys from keystores (derived from private keys)
3. Coinbase mappings from cache file (if exists)
4. Network from base config
5. Provider ID from on-chain query

**Flags**:

```
--network <aztec-network>    Aztec network: testnet or mainnet (default: from base config)
--keys-dir <path>            Path to directory containing keystore JSON files
--output <path>              Output path for scraper config (default: XDG data dir)
--include-zero-coinbases     Include attesters with 0x00..00 coinbase (default: true)
```

**Logic**:

```typescript
async function generateScraperConfig(options: {
  network: string;
  keysDir: string;
  outputPath?: string;
  includeZeroCoinbases: boolean;
}): Promise<void> {
  // 1. Load base config to get RPC URLs and provider admin
  const baseConfig = await loadBaseConfig(options.network);

  // 2. Initialize Ethereum client
  const ethClient = await initEthereumClient(baseConfig);

  // 3. Load keystores from directory (same logic as current getDockerDirData)
  const keystores = await loadKeystoresFromDirectory(options.keysDir);

  // 4. Extract attester addresses and derive from keystores
  const attesters: ScraperAttester[] = [];
  for (const keystore of keystores) {
    for (const validator of keystore.validators) {
      const attesterAddress = validator.address; // ETH address

      // Try to load coinbase from cache
      let coinbase = "0x0000000000000000000000000000000000000000";
      const cachedMapping = await getCachedCoinbase(
        options.network,
        attesterAddress,
      );
      if (cachedMapping) {
        coinbase = cachedMapping.coinbaseAddress;
      }

      attesters.push({ address: attesterAddress, coinbase });
    }
  }

  // 5. Extract publisher addresses from keystores
  const publishers: ScraperPublisher[] = [];
  const publisherSet = new Set<string>();
  for (const keystore of keystores) {
    for (const validator of keystore.validators) {
      if (typeof validator.publisher === "string") {
        const pubAddr = getAddressFromPrivateKey(validator.publisher);
        publisherSet.add(pubAddr);
      } else {
        for (const privKey of validator.publisher) {
          const pubAddr = getAddressFromPrivateKey(privKey);
          publisherSet.add(pubAddr);
        }
      }
    }
  }
  publishers.push(
    ...Array.from(publisherSet).map((addr) => ({ address: addr })),
  );

  // 6. Query staking provider ID from chain
  const providerData = await ethClient.getStakingProvider(
    baseConfig.PROVIDER_ADMIN_ADDRESS,
  );
  if (!providerData) {
    throw new Error("Staking provider not registered on-chain");
  }

  // 7. Generate config
  const scraperConfig: ScraperConfig = {
    network: options.network,
    stakingProviderId: providerData.providerId,
    stakingProviderAdmin: baseConfig.PROVIDER_ADMIN_ADDRESS,
    attesters,
    publishers,
    lastUpdated: new Date().toISOString(),
    version: "1.0",
  };

  // 8. Validate and save
  const validated = ScraperConfigSchema.parse(scraperConfig);
  await saveScraperConfig(validated, options.outputPath);

  console.log(`✅ Scraper config generated: ${outputPath}`);
  console.log(`   Attesters: ${attesters.length}`);
  console.log(`   Publishers: ${publishers.length}`);
  console.log(`   Provider ID: ${providerData.providerId}`);
}
```

**Acceptance Criteria**:

- [ ] Command can read keystore files (same format as current)
- [ ] Extracts all attester addresses correctly
- [ ] Extracts all publisher addresses (handles both string and array formats)
- [ ] Queries provider ID from chain
- [ ] Loads cached coinbase mappings if available
- [ ] Generates valid scraper config JSON
- [ ] Saves to XDG data directory by default
- [ ] Outputs summary of generated config

---

### Task 3: Create CLI Command - Scrape On-Chain Coinbases

**Command**: `aztec-butler scrape-coinbases [options]`

**Purpose**: Scrape blockchain to find coinbase addresses for attesters

**Implementation File**: `src/cli/commands/scrape-coinbases.ts`

**Input**:

1. Attester addresses (from keystores or scraper config)
2. Start block number
3. Provider ID
4. Network configuration

**Flags**:

```
--network <aztec-network>    Aztec network: testnet or mainnet (default: from base config)
--start-block <number>       Block number to start scraping from (required)
--keys-dir <path>            Path to keystores (alternative to --config)
--config <path>              Path to scraper config (alternative to --keys-dir)
--output <path>              Output path for coinbase cache (default: XDG data dir)
--provider-id <id>           Staking provider ID (default: query from chain)
```

**Logic**:

```typescript
async function scrapeCoinbases(options: {
  network: string;
  startBlock: bigint;
  keysDir?: string;
  configPath?: string;
  outputPath?: string;
  providerId?: bigint;
}): Promise<void> {
  // 1. Load base config
  const baseConfig = await loadBaseConfig(options.network);

  // 2. Get attester addresses
  let attesterAddresses: string[];
  if (options.keysDir) {
    const keystores = await loadKeystoresFromDirectory(options.keysDir);
    attesterAddresses = extractAttesterAddresses(keystores);
  } else if (options.configPath) {
    const scraperConfig = await loadScraperConfig(options.configPath);
    attesterAddresses = scraperConfig.attesters.map((a) => a.address);
  } else {
    throw new Error("Must provide either --keys-dir or --config");
  }

  // 3. Get provider ID
  let providerId = options.providerId;
  if (!providerId) {
    const ethClient = await initEthereumClient(baseConfig);
    const providerData = await ethClient.getStakingProvider(
      baseConfig.PROVIDER_ADMIN_ADDRESS,
    );
    if (!providerData) {
      throw new Error("Staking provider not found");
    }
    providerId = providerData.providerId;
  }

  // 4. Initialize archive node client (required for historical data)
  if (!baseConfig.ETHEREUM_ARCHIVE_NODE_URL) {
    throw new Error("ETHEREUM_ARCHIVE_NODE_URL required for coinbase scraping");
  }
  const archiveClient = await initArchiveEthereumClient(baseConfig);

  // 5. Scrape coinbases from chain
  console.log(`Scraping coinbases from block ${options.startBlock}...`);
  console.log(`Attesters to check: ${attesterAddresses.length}`);

  const mappings: MappedCoinbase[] = [];
  const currentBlock = await archiveClient.getBlockNumber();

  // Query AttesterAdded events or read from staking registry
  // This will depend on the specific contract implementation
  for (const attesterAddress of attesterAddresses) {
    const coinbase = await queryCoinbaseForAttester(
      archiveClient,
      providerId,
      attesterAddress,
      options.startBlock,
      currentBlock,
    );

    if (coinbase) {
      mappings.push({
        attesterAddress,
        coinbaseAddress: coinbase.address,
        blockNumber: coinbase.blockNumber,
        blockHash: coinbase.blockHash,
        timestamp: coinbase.timestamp,
      });
      console.log(`✅ ${attesterAddress} -> ${coinbase.address}`);
    } else {
      console.log(`⚠️  ${attesterAddress} -> No coinbase found`);
    }
  }

  // 6. Detect incorrect coinbases (if we have previous cache)
  const existingCache = await loadCoinbaseCache(options.network);
  if (existingCache) {
    for (const mapping of mappings) {
      const existing = existingCache.mappings.find(
        (m) => m.attesterAddress === mapping.attesterAddress,
      );
      if (existing && existing.coinbaseAddress !== mapping.coinbaseAddress) {
        throw new Error(
          `FATAL: Coinbase mismatch for ${mapping.attesterAddress}!\n` +
            `  Expected: ${existing.coinbaseAddress}\n` +
            `  Found: ${mapping.coinbaseAddress}`,
        );
      }
    }
  }

  // 7. Save cache
  const cache: CoinbaseMappingCache = {
    network: options.network,
    stakingProviderId: providerId,
    lastScrapedBlock: currentBlock,
    mappings,
    scrapedAt: new Date().toISOString(),
    version: "1.0",
  };

  await saveCoinbaseCache(cache, options.outputPath);

  console.log(
    `\n✅ Coinbase mappings saved: ${options.outputPath || "default location"}`,
  );
  console.log(`   Total mappings: ${mappings.length}`);
  console.log(`   Last scraped block: ${currentBlock}`);
}
```

**Acceptance Criteria**:

- [ ] Can read attester addresses from keystores or scraper config
- [ ] Queries blockchain for coinbase mappings
- [ ] Validates against existing cache (throws on mismatch)
- [ ] Saves cache with block provenance
- [ ] Provides clear progress output
- [ ] Throws error if archive node not configured

---

### Task 4: Update Existing CLI Commands

#### 4.1 Update `get-add-keys-to-staking-provider-calldata.ts`

**Changes Required**:

1. **Add duplicate key check**:

```typescript
// Query provider queue from chain
const providerData = await ethClient.getStakingProvider(
  stakingProviderAdminAddress,
);
const queueAttesterAddresses =
  await ethClient.getProviderQueueAttesterAddresses(providerData.providerId);

// Check for duplicates
for (const attesterReg of dirData.attesterRegistrations) {
  for (const attester of attesterReg.data) {
    if (queueAttesterAddresses.includes(attester.attester)) {
      throw new Error(
        `FATAL: Attester ${attester.attester} already in provider queue!\n` +
          `Cannot add keys that are already queued.`,
      );
    }
  }
}
```

2. **Add multisig proposal option**:

```typescript
// After generating callData...

// Always log calldata
console.log("\nADD KEYS TO STAKING PROVIDER CALL DATA:");
console.log(JSON.stringify(callData, null, 2));

// Propose to multisig if configured
if (config.SAFE_ADDRESS && config.MULTISIG_PROPOSER_PRIVATE_KEY) {
  // Check for --no-propose flag
  if (!process.argv.includes("--no-propose")) {
    console.log("\n🔐 Proposing transaction to Safe multisig...");
    const safeClient = new SafeGlobalClient({...});
    const txHash = await safeClient.proposeTransaction({
      to: callData.contractToCall,
      data: callData.callData,
      value: "0",
    });
    console.log(`✅ Multisig proposal created: ${txHash}`);
  } else {
    console.log("\n⏭️  Skipping multisig proposal (--no-propose flag)");
  }
}
```

**Acceptance Criteria**:

- [ ] Throws error if keys already in queue
- [ ] Always outputs calldata to console
- [ ] Proposes to multisig if configured
- [ ] Respects `--no-propose` flag to skip proposal

---

#### 4.2 Update `get-publisher-eth.ts`

**Changes Required**:

1. **Add better top-up flags**:

```typescript
// New flags:
--target-balance <eth>       Target balance per publisher (alternative to calculating from load)
--per-attester <eth>         ETH amount per attester for load calculation (default: MIN_ETH_PER_ATTESTER)
--threshold <eth>            Minimum top-up amount (default: 0.01 ETH)
```

2. **Add threshold filtering**:

```typescript
const MIN_TOPUP_THRESHOLD = parseEther(options.threshold || "0.01");

// After calculating requiredTopUp...
const needsTopUp = publishers[privKey]!.requiredTopUp > MIN_TOPUP_THRESHOLD;
```

3. **Generate actual calldata**:

```typescript
// After calculating all balances...
const topUpsNeeded = Object.entries(publishers).filter(
  ([_, info]) => info.requiredTopUp > MIN_TOPUP_THRESHOLD,
);

if (topUpsNeeded.length > 0) {
  console.log("\n💸 FUNDING CALL DATA:");

  // Generate batch call for Safe multisig
  const calls = topUpsNeeded.map(([privKey, info]) => ({
    to: getAddressFromPrivateKey(privKey as HexString),
    value: info.requiredTopUp.toString(),
    data: "0x", // Simple ETH transfer
  }));

  console.log(JSON.stringify(calls, null, 2));
}
```

4. **Add multisig proposal**:

```typescript
// Similar to addKeysToProvider command
if (config.SAFE_ADDRESS && !process.argv.includes("--no-propose")) {
  // Propose batch transaction
  console.log("\n🔐 Proposing funding transactions to Safe multisig...");
  // Implementation...
}
```

**Acceptance Criteria**:

- [ ] Supports `--target-balance` and `--per-attester` flags
- [ ] Filters out tiny top-ups below threshold
- [ ] Generates batch calldata for multiple publishers
- [ ] Proposes to multisig if configured
- [ ] Clear output showing which publishers need funding

---

### Task 5: Remove Docker Directory Parsing and Create Keystore Operations

**Files to Update/Create**:

- **DELETE**: `src/core/utils/fileOperations.ts` - Remove `getDockerDirData()` completely
- **CREATE**: `src/core/utils/keystoreOperations.ts` - New keystore loading functions

**Changes**:

1. **Complete removal of `getDockerDirData()`**:
   - Delete the entire function and all its helper functions
   - Remove `parseEnvFile()` function
   - Remove `getJsonFileData()` function
   - Remove `ATTESTER_REGISTRATIONS_DIR_NAME` constant (move to keystoreOperations if needed)

2. **Create new keystore operations file**:

**Create**: `src/core/utils/keystoreOperations.ts`

```typescript
/**
 * Load keystores from a directory
 * Used by CLI mode only
 */
export async function loadKeystoresFromDirectory(
  keysDir: string,
): Promise<Keystore[]> {
  // Load JSON files from directory
}

/**
 * Extract attester addresses from keystores
 */
export function extractAttesterAddresses(keystores: Keystore[]): string[] {
  // Parse keystores and return addresses
}

/**
 * Extract publisher addresses from keystores
 */
export function extractPublisherAddresses(keystores: Keystore[]): string[] {
  // Parse and derive from private keys
}
```

**Acceptance Criteria**:

- [ ] `getDockerDirData()` completely removed
- [ ] `parseEnvFile()` completely removed
- [ ] All Docker directory parsing logic removed
- [ ] New keystore operations file created with clean interfaces
- [ ] CLI commands updated to use new keystore operations
- [ ] No references to `AZTEC_DOCKER_DIR` in CLI code

---

### Task 6: Update Configuration System

**File**: `src/core/config/index.ts`

**Changes**:

1. **Multi-network config detection**:

```typescript
// Find all network configs
async function findNetworkConfigs(): Promise<string[]> {
  const configDir = envPath(PACKAGE_NAME, { suffix: "" }).config;
  const files = await fs.readdir(configDir);
  return files
    .filter((f) => f.endsWith("-base.env"))
    .map((f) => f.replace("-base.env", ""));
}

// Load specific network config
async function loadNetworkConfig(network: string): Promise<ButlerConfig> {
  const configPath = path.join(
    envPath(PACKAGE_NAME, { suffix: "" }).config,
    `${network}-base.env`,
  );
  // Load and parse
}
```

2. **Add network selection logic**:

```typescript
export async function initConfig(options?: {
  network?: string;
  suppressLog?: boolean;
}): Promise<ButlerConfig> {
  const availableNetworks = await findNetworkConfigs();

  let selectedNetwork: string;
  if (options?.network) {
    // User specified network
    selectedNetwork = options.network;
  } else if (availableNetworks.length === 1) {
    // Only one network available
    selectedNetwork = availableNetworks[0];
  } else if (availableNetworks.includes("testnet")) {
    // Default to testnet
    console.log("Multiple networks found, defaulting to testnet");
    selectedNetwork = "testnet";
  } else {
    throw new Error(
      "Multiple network configs found. Please specify --network flag.\n" +
        `Available: ${availableNetworks.join(", ")}`,
    );
  }

  return await loadNetworkConfig(selectedNetwork);
}
```

3. **Add NETWORK and ETHEREUM_CHAIN_ID fields, remove AZTEC_DOCKER_DIR**:

```typescript
const config = {
  NETWORK: z.string().parse(selectedNetwork),
  ETHEREUM_CHAIN_ID: z.coerce.number().parse(process.env.ETHEREUM_CHAIN_ID),
  // ... rest of existing fields

  // AZTEC_DOCKER_DIR completely removed
};
```

**Acceptance Criteria**:

- [ ] Can detect multiple network configs
- [ ] Defaults to testnet when multiple exist
- [ ] Respects `--network` flag
- [ ] NETWORK field included in config
- [ ] AZTEC_DOCKER_DIR is optional

---

### Task 7: Remove WAITING_FOR_MULTISIG_SIGN State

**Files to Update**:

- `src/server/state/index.ts:58` - Remove enum value
- `src/server/state/transitions.ts:103` - Remove case statement
- `src/server/handlers/attester-new-state-handler.ts` - Update to use NEW state

**Changes**:

1. **Remove from enum** (`src/server/state/index.ts`):

```typescript
export enum AttesterState {
  NEW = "NEW",
  // WAITING_FOR_MULTISIG_SIGN = "WAITING_FOR_MULTISIG_SIGN", // REMOVED
  IN_STAKING_PROVIDER_QUEUE = "IN_STAKING_PROVIDER_QUEUE",
  COINBASE_NEEDED = "COINBASE_NEEDED",
  IN_STAKING_QUEUE = "IN_STAKING_QUEUE",
  ACTIVE = "ACTIVE",
}
```

2. **Update handler** (`src/server/handlers/attester-new-state-handler.ts`):

```typescript
// Change from:
updateAttesterState(
  newAttester.attesterAddress,
  AttesterState.WAITING_FOR_MULTISIG_SIGN,
);

// To:
updateAttesterState(newAttester.attesterAddress, AttesterState.NEW);
```

3. **Update transitions** (`src/server/state/transitions.ts`):

```typescript
// Remove this case:
case AttesterState.WAITING_FOR_MULTISIG_SIGN:
  // ... logic removed
  break;

// Update NEW state to handle transition to IN_STAKING_PROVIDER_QUEUE directly
case AttesterState.NEW:
  if (hasCoinbase) {
    updateAttesterState(attesterAddress, AttesterState.IN_STAKING_QUEUE);
  } else {
    // Check if attester is in provider queue
    const isInProviderQueue = isAttesterInProviderQueue(attesterAddress);
    if (isInProviderQueue) {
      updateAttesterState(
        attesterAddress,
        AttesterState.IN_STAKING_PROVIDER_QUEUE,
      );
    }
  }
  break;
```

**Acceptance Criteria**:

- [ ] WAITING_FOR_MULTISIG_SIGN state removed from enum
- [ ] All references updated to use NEW state
- [ ] State transitions still work correctly
- [ ] No compilation errors

---

## Breaking Changes - No Migration Needed

**Important**: Phase 1 introduces breaking changes. There is **no backward compatibility** and **no migration path** for existing systems.

**After Phase 1**:

1. Create new network config:

   ```bash
   # Create ~/.config/aztec-butler/testnet-base.env
   # Populate with required fields including ETHEREUM_CHAIN_ID=11155111
   ```

2. Generate scraper config:

   ```bash
   aztec-butler generate-scraper-config --network testnet --keys-dir /path/to/keys
   ```

3. (Optional) Scrape coinbases:

   ```bash
   aztec-butler scrape-coinbases --network testnet --start-block 1000000 --keys-dir /path/to/keys
   ```

**Breaking Changes**:

- `AZTEC_DOCKER_DIR` completely removed from configuration
- Config file naming changed from `basic` to `{aztec-network}-base.env`
- `getDockerDirData()` function completely removed
- All Docker directory parsing removed
- CLI commands require explicit `--keys-dir` flag instead of reading from Docker directory

---

## Testing Checklist

### Manual Testing Checklist

- [ ] CLI can read new `{aztec-network}-base.env` format
- [ ] CLI properly rejects old `basic` config format with clear error
- [ ] Generate scraper config from real keystores
- [ ] Scrape coinbases from testnet (requires archive node)
- [ ] Multisig proposals work with Safe
- [ ] Error messages are clear and helpful
- [ ] ETHEREUM_CHAIN_ID validation works (rejects invalid chain IDs)

---

## Dependencies & Prerequisites

### External Dependencies

- Access to Ethereum archive node (for coinbase scraping)
- Safe multisig configuration (for proposal features)
- Keystore files in Aztec-compatible JSON format

### Internal Dependencies

- Phase 1 is independent - no dependencies on other phases
- Prepares foundation for Phase 2 (Scraper refactoring)

---

## File Structure After Phase 1

```
~/.config/aztec-butler/
  testnet-base.env          # Base config for Aztec testnet (Ethereum Sepolia chainId 11155111)
  mainnet-base.env          # Base config for Aztec mainnet (Ethereum mainnet chainId 1)

~/.local/share/aztec-butler/
  testnet-scrape-config.json      # Generated by CLI for scraper
  testnet-mapped-coinbases.json   # Coinbase cache
  mainnet-scrape-config.json      # (if mainnet exists)
  mainnet-mapped-coinbases.json

/path/to/operator/machine/
  keys/                     # Keystores with private keys (CLI reads these via --keys-dir flag)
    keys-0.json
    keys-1.json
```

---

## Success Criteria

Phase 1 is complete when:

- ✅ New configuration formats are designed, implemented, and validated
- ✅ CLI command `generate-scraper-config` works and generates valid configs
- ✅ CLI command `scrape-coinbases` works and caches mappings
- ✅ Existing CLI commands updated with new features (multisig, duplicate checks, thresholds)
- ✅ Docker directory dependency completely removed (breaking change)
- ✅ `getDockerDirData()` function completely removed
- ✅ WAITING_FOR_MULTISIG_SIGN state removed
- ✅ ETHEREUM_CHAIN_ID configuration added
- ✅ Multi-network configuration support implemented
- ✅ All tests pass
- ✅ Documentation updated

---

## Risks & Mitigations

| Risk                           | Impact | Mitigation                                                         |
| ------------------------------ | ------ | ------------------------------------------------------------------ |
| Breaking existing deployments  | HIGH   | **Accepted** - No backward compatibility or migration path         |
| Coinbase scraping is slow      | MEDIUM | Show progress output; allow caching and incremental scraping       |
| Archive node not available     | HIGH   | Clear error message; document requirement upfront                  |
| Keystore format changes        | MEDIUM | Validate against current Aztec format; document expected structure |
| Multi-network config confusion | LOW    | Clear defaults (testnet); helpful error messages                   |

---

## Questions for Clarification

1. **Coinbase Scraping Details**:
   - How are coinbases stored on-chain? In events or contract storage?
   - Which contract/event should we query?
   - What's the expected block range to scrape?

2. **Keystore Format**:
   - Is the current keystore format stable?
   - Will web3signer export format match?
   - Any special handling for BLS vs ETH keys?

3. **Publisher Private Keys**:
   - Should they remain in the same keystore format?
   - How should they be distributed across machines (XOR requirement)?

4. **Multisig Integration**:
   - Should we use Safe's batch transaction feature for multiple publishers?
   - Any specific proposal metadata to include?

5. **Network Support**:
   - Should we validate ETHEREUM_CHAIN_ID matches the expected value for the network?
   - Support for other Aztec networks (devnet, etc.) and their corresponding Ethereum networks?

---

## Next Steps

After Phase 1 completion:

- **Phase 2**: Update Scraper (Server) to use new config format and remove private key access
- **Phase 3**: Complete CLI commands and state management updates
- **Phase 4**: Deployment, documentation, and external repository changes
