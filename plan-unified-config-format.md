# Plan: Unified Configuration Format for Server Deployment

## Overview

Simplify server deployment by using the deployment keys file format (`[network]-keys-[serverId]-[versionId].json`) as the single source of truth for monitoring server configuration. The server will auto-discover and merge multiple key files on startup.

**Important:** This is a breaking change. No backwards compatibility or migrations will be implemented since the system is not in production anywhere.

---

## Current State

### Files Currently Used

1. **Deployment Keys Files** (produced by `prepare-deployment`)
   - Format: `prod-mainnet-keys.json.new` (manual naming)
   - Contains: `attester.eth`, `attester.bls`, `publisher`, `feeRecipient`, optional `coinbase`
   - Schema: `schemaVersion`, `remoteSigner`, `validators[]`
   - Used by: Validator nodes

2. **Server Config Files** (manually created)
   - `{network}-cached-attesters.json` - Attester addresses + optional coinbase + lastSeenState
   - `{network}-available-publishers.json` - Publisher addresses grouped by server
   - Used by: Monitoring server

3. **Legacy CLI Files** (deprecated)
   - `{network}-scrape-config.json` - Full config with network metadata
   - Used by: Some CLI commands only (not server)

### Problems

- Operators must manually transform deployment keys into server config format
- Two separate files needed for server (`cached-attesters.json` + `available-publishers.json`)
- No standard naming convention for deployment files
- Server grouping info not in deployment files

---

## Target State

### Single File Format: Deployment Keys

**Standardized naming:** `[network]-keys-[serverId]-[versionId].json`

Examples:

- `mainnet-keys-A-v1.json`
- `mainnet-keys-B-v2.json`
- `testnet-keys-validator1-v3.json`

**File contents:**

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

**Note on coinbase field:**

- New validators from `prepare-deployment` won't have `coinbase` set initially
- Operators will run `fill-coinbases` command to populate coinbase addresses
- Coinbase is discovered from on-chain `StakedWithProvider` events
- Server can operate without coinbases, but will emit warnings for attesters missing them

### Server Behavior

**On startup:**

1. Scan data directory for all `[network]-keys-*.json` files matching the configured network
2. Load and parse each file
3. Extract data:
   - Attester addresses from `validators[].attester.eth`
   - Optional coinbase from `validators[].coinbase`
   - Publisher addresses from `validators[].publisher`
   - Server ID from filename pattern
4. Merge all validators across files (deduplicating by attester address)
5. Track which publishers belong to which server (from filename)
6. Initialize state with merged attester + publisher lists

**Auto-merge logic:**

- Attesters: Merge by `attester.eth` address (case-insensitive)
- If same attester appears in multiple files, last file wins (undefined order)
- Publishers: Collect all unique publisher addresses
- Server grouping: Preserved from filename for operational tracking

---

## Implementation Plan

### Phase 1: Add Coinbase Support to Deployment Keys

#### 1.1 Update `prepare-deployment` Command

**File:** `src/cli/commands/prepare-deployment.ts`

**Changes:**

- Read coinbase cache file (`{network}-cached-coinbases.json`)
- When merging validators, lookup and include coinbase for each attester
- If coinbase not found in cache, omit field (don't include `coinbase: undefined`)
- Update output file naming to use new convention: `[network]-keys-[serverId]-[versionId].json`

**Logic:**

```typescript
// After loading coinbase cache
const coinbaseMap = new Map<string, string>();
if (coinbaseCache) {
  for (const mapping of coinbaseCache.mappings) {
    coinbaseMap.set(
      mapping.attesterAddress.toLowerCase(),
      mapping.coinbaseAddress,
    );
  }
}

// When building validator object
const validator: KeystoreValidator = {
  attester: v.attester,
  feeRecipient: v.feeRecipient,
  publisher: publishers[i % publishers.length]!,
};

// Add coinbase if found
const coinbase = coinbaseMap.get(v.attester.eth.toLowerCase());
if (coinbase) {
  validator.coinbase = coinbase;
}
```

**Output filename change:**

```typescript
// Old: prod-mainnet-keys_A_v1.json
// New: mainnet-keys-A-v1.json

const generateVersionedFilename = async (
  network: string,
  serverId: string,
  dir: string,
): Promise<string> => {
  // Pattern: [network]-keys-[serverId]-v[N].json
  const baseWithoutExt = `${network}-keys-${serverId}`;

  // Find highest existing version
  const files = await fs.readdir(dir).catch(() => []);
  let highestVersion = 0;

  const regex = new RegExp(`^${escapeRegex(baseWithoutExt)}-v(\\d+)\\.json$`);

  for (const file of files) {
    const match = file.match(regex);
    if (match?.[1]) {
      const version = parseInt(match[1], 10);
      if (version > highestVersion) {
        highestVersion = version;
      }
    }
  }

  const nextVersion = highestVersion + 1;
  return path.join(dir, `${baseWithoutExt}-v${nextVersion}.json`);
};
```

#### 1.2 Create New `fill-coinbases` Command

**File:** `src/cli/commands/fill-coinbases.ts` (new file)

**Purpose:** Update deployment keys files with coinbase addresses from cache

**Usage:**

```bash
aztec-butler fill-coinbases --network mainnet --keys-file mainnet-keys-A-v1.json
```

**Logic:**

1. Load deployment keys file
2. Load coinbase cache (`{network}-cached-coinbases.json`)
3. For each validator in keys file:
   - Lookup coinbase for `attester.eth` in cache
   - If found and not already set, add/update `coinbase` field
   - If found and already set to different value, warn and skip
4. Write updated file back (or to new version if `--increment-version` flag)
5. Report summary: X coinbases added, Y already set, Z missing

**Validation:**

- Warn if coinbase cache is empty or missing
- Error if coinbase found but is zero address
- Warn for attesters with no coinbase mapping in cache

#### 1.3 Update Type Definitions

**File:** `src/types/keystore.ts`

**Changes:**

```typescript
export const ValidatorSchema = z.object({
  attester: z.object({
    bls: z.string().startsWith("0x"),
    eth: z.string().startsWith("0x").length(42),
  }),
  coinbase: z
    .string()
    .startsWith("0x")
    .length(42)
    .refine((val) => val !== "0x0000000000000000000000000000000000000000", {
      message: "Coinbase cannot be zero address",
    })
    .optional(), // <-- Add this field
  feeRecipient: z.string().startsWith("0x").length(42),
  publisher: z.union([
    z.string().startsWith("0x").length(42),
    z.array(z.string().startsWith("0x").length(42)),
  ]),
});

export const KeystoreSchema = z.object({
  schemaVersion: z.number().optional(),
  remoteSigner: z.string().optional(),
  validators: z.array(ValidatorSchema),
});

export type Validator = z.infer<typeof ValidatorSchema>;
export type Keystore = z.infer<typeof KeystoreSchema>;
```

### Phase 2: Server Auto-Discovery and Merging

#### 2.1 Create Keys File Loader

**File:** `src/core/utils/keysFileOperations.ts` (new file)

**Functions:**

```typescript
/**
 * Load and parse a single deployment keys file
 */
export async function loadKeysFile(filePath: string): Promise<Keystore>;

/**
 * Auto-discover all keys files for a network
 * Pattern: {dataDir}/{network}-keys-*.json
 */
export async function discoverKeysFiles(network: string): Promise<string[]>;

/**
 * Load all keys files for a network and merge validators
 * Returns: merged attester list with coinbases, merged publisher list with server assignments
 */
export async function loadAndMergeKeysFiles(network: string): Promise<{
  attesters: Array<{
    address: string;
    coinbase?: string;
    serverId?: string; // which server this attester came from (optional tracking)
  }>;
  publishers: Array<{
    address: string;
    serverId: string; // which server owns this publisher
  }>;
  filesLoaded: string[];
}>;
```

**Auto-discovery logic:**

```typescript
export async function discoverKeysFiles(network: string): Promise<string[]> {
  const dataDir = getDataDir();
  const pattern = `${network}-keys-*.json`;

  try {
    const files = await fs.readdir(dataDir);
    const matchingFiles = files
      .filter((file) => {
        // Match: mainnet-keys-A-v1.json, mainnet-keys-validator1-v2.json
        const regex = new RegExp(`^${escapeRegex(network)}-keys-.+\\.json$`);
        return regex.test(file);
      })
      .map((file) => path.join(dataDir, file));

    return matchingFiles.sort(); // Consistent ordering
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []; // Directory doesn't exist yet
    }
    throw error;
  }
}
```

**Merge logic:**

```typescript
export async function loadAndMergeKeysFiles(network: string) {
  const keyFiles = await discoverKeysFiles(network);

  if (keyFiles.length === 0) {
    console.warn(`No keys files found for network ${network}`);
    return { attesters: [], publishers: [], filesLoaded: [] };
  }

  console.log(`Found ${keyFiles.length} keys file(s) for ${network}:`);
  keyFiles.forEach(f => console.log(`  - ${path.basename(f)}`));

  const attesterMap = new Map<string, { address: string; coinbase?: string }>();
  const publisherMap = new Map<string, { address: string; serverId: string }>();

  for (const filePath of keyFiles) {
    const keystore = await loadKeysFile(filePath);
    const serverId = extractServerIdFromFilename(path.basename(filePath));

    for (const validator of keystore.validators) {
      const attesterAddr = validator.attester.eth.toLowerCase();

      // Merge attester (last file wins for duplicates - this is normal and expected)
      attesterMap.set(attesterAddr, {
        address: validator.attester.eth, // Keep original casing
        coinbase: validator.coinbase,
      });

      // Collect publishers
      const publisherAddrs = Array.isArray(validator.publisher)
        ? validator.publisher
        : [validator.publisher];

      for (const pubAddr of publisherAddrs) {
        const normalizedPub = pubAddr.toLowerCase();
        if (!publisherMap.has(normalizedPub)) {
          publisherMap.set(normalizedPub, {
            address: pubAddr,
            serverId,
          });
        }
      }
    }
  }

  return {
    attesters: Array.from(attesterMap.values()),
    publishers: Array.from(publisherMap.values()),
    filesLoaded: keyFiles.map(f => path.basename(f)),
  };
}

  console.log(`Found ${keyFiles.length} keys file(s) for ${network}:`);
  keyFiles.forEach((f) => console.log(`  - ${path.basename(f)}`));

  const attesterMap = new Map<string, { address: string; coinbase?: string }>();
  const publisherMap = new Map<string, { address: string; serverId: string }>();

  for (const filePath of keyFiles) {
    const keystore = await loadKeysFile(filePath);
    const serverId = extractServerIdFromFilename(path.basename(filePath));

    for (const validator of keystore.validators) {
      const attesterAddr = validator.attester.eth.toLowerCase();

      // Merge attester (last file wins for duplicates)
      if (!attesterMap.has(attesterAddr)) {
        attesterMap.set(attesterAddr, {
          address: validator.attester.eth, // Keep original casing
          coinbase: validator.coinbase,
        });
      } else {
        console.warn(
          `Duplicate attester ${attesterAddr} found in ${path.basename(filePath)}, skipping`,
        );
      }

      // Collect publishers
      const publisherAddrs = Array.isArray(validator.publisher)
        ? validator.publisher
        : [validator.publisher];

      for (const pubAddr of publisherAddrs) {
        const normalizedPub = pubAddr.toLowerCase();
        if (!publisherMap.has(normalizedPub)) {
          publisherMap.set(normalizedPub, {
            address: pubAddr,
            serverId,
          });
        }
      }
    }
  }

  return {
    attesters: Array.from(attesterMap.values()),
    publishers: Array.from(publisherMap.values()),
    filesLoaded: keyFiles.map((f) => path.basename(f)),
  };
}

/**
 * Extract server ID from filename
 * mainnet-keys-A-v1.json -> "A"
 * mainnet-keys-validator1-v2.json -> "validator1"
 */
function extractServerIdFromFilename(filename: string): string {
  // Pattern: [network]-keys-[serverId]-v[N].json
  const match = filename.match(/^[^-]+-keys-([^-]+)-v\d+\.json$/);
  if (!match?.[1]) {
    throw new Error(`Invalid keys filename format: ${filename}`);
  }
  return match[1];
}
```

#### 2.2 Update Server Initialization

**File:** `src/server/index.ts`

**Changes in `initializeNetwork()` function:**

```typescript
async function initializeNetwork(
  network: string,
  config: ButlerConfig,
  scraperManager: ScraperManager,
) {
  console.log(`\n--- Initializing network: ${network} ---`);

  // Initialize state for this network
  await initNetworkState(network);

  // Load keys files (new unified approach)
  console.log(`[${network}] Auto-discovering keys files...`);
  const { attesters, publishers, filesLoaded } =
    await loadAndMergeKeysFiles(network);

  if (filesLoaded.length === 0) {
    console.warn(
      `[${network}] No keys files found. Server will start with empty attester/publisher lists.\n` +
        `Expected file pattern: ${network}-keys-*.json in data directory.`,
    );
  } else {
    console.log(
      `[${network}] Loaded and merged ${filesLoaded.length} keys file(s):`,
    );
    filesLoaded.forEach((f) => console.log(`  - ${f}`));
    console.log(
      `[${network}] Total: ${attesters.length} attester(s), ${publishers.length} publisher(s)`,
    );
  }

  // Check for attesters missing coinbase
  const missingCoinbase = attesters.filter((a) => !a.coinbase);
  if (missingCoinbase.length > 0) {
    console.warn(
      `[${network}] Warning: ${missingCoinbase.length} attester(s) missing coinbase addresses.` +
        `\nRun 'aztec-butler fill-coinbases' to populate them.`,
    );
  }

  // Initialize state from loaded data
  console.log(`[${network}] Initializing state...`);
  initAttesterStatesFromCache(network, attesters);

  // Extract just publisher addresses for PublisherScraper
  const publisherAddresses = publishers.map((p) => p.address);
  updatePublishersState(network, publisherAddresses);

  // ... rest of scraper initialization
  const publisherScraper = new PublisherScraper(
    network,
    config,
    publisherAddresses,
  );
  scraperManager.register(publisherScraper, 30_000);

  // ... rest remains the same
}
```

#### 2.3 Update State Management

**File:** `src/server/state/index.ts`

**Changes:**

- `initAttesterStatesFromCache()` already accepts the right format (address + optional coinbase)
- No changes needed, function signature already compatible:

```typescript
export const initAttesterStatesFromCache = (
  network: string,
  cachedAttesters: Array<{
    address: string;
    coinbase?: string | undefined;
    lastSeenState?: string | undefined;
  }>,
)
```

**Note:** We're not using `lastSeenState` from keys files (it doesn't have that field). Server will initialize all attesters in appropriate state based on current on-chain status.

### Phase 3: Remove Legacy Files

#### 3.1 Deprecate Old Server Config Files

**Remove support for:**

- `{network}-cached-attesters.json` - Replaced by keys files
- `{network}-available-publishers.json` - Replaced by keys files

**Keep (for now):**

- `{network}-cached-coinbases.json` - Used by CLI commands and `fill-coinbases`
- `{network}-scrape-config.json` - Still used by some CLI commands (can deprecate later)

#### 3.2 Remove Old Loading Functions

**Files to modify:**

- `src/core/utils/cachedAttestersOperations.ts`
  - Remove `loadCachedAttesters()`, `saveCachedAttesters()`
  - Remove `loadAvailablePublishers()`, `loadAvailablePublishersFromPath()`
  - Keep only if used by CLI commands

**Check all imports and remove dead code.**

#### 3.3 Update CLI Commands

**Commands that use old config files:**

1. `scrape-attester-status` - Uses `loadCachedAttesters()`, `saveCachedAttesters()`
2. `get-queue-stats` - Uses `loadCachedAttesters()`
3. `scrape-coinbases` - Uses `loadScraperConfig()` (separate file)

**Options:**

- **Option A:** Update these commands to use keys files instead
- **Option B:** Keep them using old formats as CLI-only state (separate from server)
- **Option C:** Deprecate commands that duplicate server functionality

**Recommendation:** Option B for now (keep CLI commands independent). Focus on server using unified format.

### Phase 4: Update Documentation

#### 4.1 Operator Guide Updates

**File:** `docs/operator-guide/README.md` and phase files

**Document new workflow:**

1. **Initial Setup:**

   ```bash
   # Generate keys and initial deployment files
   aztec-butler prepare-deployment \
     --production-keys existing-keys.json \
     --new-public-keys new-keys.json \
     --available-publishers publishers.json \
     --network mainnet

   # Output: mainnet-keys-A-v1.json, mainnet-keys-B-v1.json, etc.
   ```

2. **Populate Coinbases:**

   ```bash
   # Scrape coinbase addresses from on-chain events
   aztec-butler scrape-coinbases --network mainnet

   # Fill coinbases into deployment files
   aztec-butler fill-coinbases --network mainnet --keys-file mainnet-keys-A-v1.json
   aztec-butler fill-coinbases --network mainnet --keys-file mainnet-keys-B-v1.json
   ```

3. **Deploy to Servers:**

   ```bash
   # Copy keys files to monitoring server's data directory
   scp mainnet-keys-A-v1.json server:/home/user/.local/share/aztec-butler/
   scp mainnet-keys-B-v1.json server:/home/user/.local/share/aztec-butler/

   # Copy to validator nodes (each server gets its own file)
   scp mainnet-keys-A-v1.json serverA:/path/to/validator/
   scp mainnet-keys-B-v1.json serverB:/path/to/validator/
   ```

4. **Start Monitoring Server:**
   ```bash
   # Server auto-discovers mainnet-keys-*.json files
   aztec-butler start-server --network mainnet
   ```

#### 4.2 Update README.md

**File:** `README.md`

**Add sections:**

- File naming conventions
- Server auto-discovery behavior
- How to add new validators (create new versioned file)
- How to update existing deployments (increment version)

### Phase 5: Testing

#### 5.1 Manual Testing Checklist

- [ ] `prepare-deployment` generates files with correct naming pattern
- [ ] `fill-coinbases` correctly updates keys files with coinbase addresses
- [ ] Server discovers multiple keys files on startup
- [ ] Server correctly merges attesters from multiple files
- [ ] Server correctly tracks publishers per server
- [ ] Server handles missing coinbase addresses gracefully
- [ ] Server warns when no keys files found
- [ ] Duplicate attesters across files handled correctly (last file wins, no warning needed - this is normal)
- [ ] Metrics correctly reflect merged data

#### 5.2 Test Scenarios

**Scenario 1: Fresh deployment**

- No keys files exist
- Server starts with empty lists
- Logs appropriate warnings

**Scenario 2: Single server**

- One keys file: `mainnet-keys-A-v1.json`
- Server loads attesters and publishers
- All functionality works

**Scenario 3: Multiple servers**

- Two keys files: `mainnet-keys-A-v1.json`, `mainnet-keys-B-v1.json`
- Server merges all attesters
- Publisher tracking shows correct server assignment

**Scenario 4: Version increment**

- Start with `mainnet-keys-A-v1.json`
- Create `mainnet-keys-A-v2.json` with updated data
- Server loads both (or latest only?)
- Decision: Should server load ALL versions or only highest version per server?

**Important Decision Point:**
Do we want server to load:

- **All versions:** `mainnet-keys-A-v1.json` + `mainnet-keys-A-v2.json` + `mainnet-keys-B-v1.json`
- **Latest per server:** `mainnet-keys-A-v2.json` (skip v1) + `mainnet-keys-B-v1.json`

**Recommendation:** Latest per server only. Loading old versions serves no purpose and could cause conflicts.

**Implementation:**

```typescript
export async function discoverKeysFiles(network: string): Promise<string[]> {
  const dataDir = getDataDir();

  try {
    const files = await fs.readdir(dataDir);

    // Group files by server ID
    const serverFiles = new Map<
      string,
      Array<{ file: string; version: number }>
    >();

    for (const file of files) {
      const match = file.match(
        new RegExp(`^${escapeRegex(network)}-keys-([^-]+)-v(\\d+)\\.json$`),
      );
      if (match) {
        const serverId = match[1]!;
        const version = parseInt(match[2]!, 10);

        if (!serverFiles.has(serverId)) {
          serverFiles.set(serverId, []);
        }
        serverFiles.get(serverId)!.push({ file, version });
      }
    }

    // Select highest version for each server
    const selectedFiles: string[] = [];
    for (const [serverId, versions] of serverFiles.entries()) {
      const latest = versions.reduce((max, curr) =>
        curr.version > max.version ? curr : max,
      );
      selectedFiles.push(path.join(dataDir, latest.file));

      if (versions.length > 1) {
        console.log(
          `[${network}] Server ${serverId}: Found ${versions.length} versions, using v${latest.version}`,
        );
      }
    }

    return selectedFiles.sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
```

---

## Migration Notes

**No migration needed** - system is not in production.

When deploying for the first time:

1. Generate keys files using updated `prepare-deployment`
2. Run `scrape-coinbases` to build coinbase cache
3. Run `fill-coinbases` on each keys file
4. Deploy keys files to servers
5. Start monitoring server

---

## Breaking Changes

1. **`prepare-deployment` output filename format changes**
   - Old: User-specified or `prod-mainnet-keys_A_v1.json`
   - New: `mainnet-keys-A-v1.json` (standardized)

2. **Server no longer reads:**
   - `{network}-cached-attesters.json`
   - `{network}-available-publishers.json`

3. **Server now requires:**
   - One or more `{network}-keys-*.json` files in data directory
   - Files must follow naming convention: `[network]-keys-[serverId]-v[N].json`

---

## Future Enhancements (Out of Scope)

1. **Dynamic reloading:** Server detects new keys files and hot-reloads without restart
2. **API endpoint:** Add `/config` endpoint to view loaded attesters/publishers
3. **Validation endpoint:** Add `/validate-keys` to check keys file before deployment
4. **Publisher balance tracking per server:** Metrics showing balance per server ID
5. **Attester-to-server mapping:** Track which attester came from which keys file
6. **Deprecate `scrape-config.json`:** Fully eliminate legacy CLI config format
7. **Unified CLI:** Update all CLI commands to use keys files instead of separate formats

---

## Summary

This plan unifies server configuration around the deployment keys file format, eliminating the need for manual file transformations. Operators will:

1. Generate keys files with `prepare-deployment` (standardized naming)
2. Fill coinbases with `fill-coinbases` command
3. Deploy multiple keys files to monitoring server's data directory
4. Server auto-discovers and merges files on startup

Benefits:

- Single source of truth (deployment keys)
- No manual transformation needed
- Support for multi-server deployments
- Automatic merging and deduplication
- Clear versioning and server assignment

The system remains flexible (server can start with no keys files) while providing clear conventions for production deployments.
