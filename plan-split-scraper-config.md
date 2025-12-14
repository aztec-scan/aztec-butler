# Plan: Split Scraper Config into Separate Files

## Overview

Replace the single `{network}-scrape-config.json` with two separate files to better separate operator-defined configuration from cached/derived data.

**No migration or backwards compatibility required** - this is a breaking change.

## Current Architecture

### Files

- `{network}-base.env` - Network connection config (in config dir)
- `{network}-scrape-config.json` - Monolithic monitoring config (in data dir)
  - Contains: network, l1ChainId, stakingProviderId, stakingProviderAdmin, attesters[], publishers[], lastUpdated, version
- `{network}-mapped-coinbases.json` - Coinbase mapping cache (in data dir)
- `available_publishers.json` - Per-server publisher addresses (user-specified path)

### CLI Commands

- `aztec-butler generate-scraper-config` - Generates/updates scrape-config.json
- `scripts/scrape-attester-status.sh` - Wrapper script for scraping

### Server Startup

1. Loads all `{network}-base.env` files
2. For each network, loads `{network}-scrape-config.json`
3. Initializes state from scraper config
4. Starts scrapers

## Proposed Architecture

### Files

#### Config Files (operator-defined, in `~/.config/aztec-butler/`)

- `{network}-base.env` - Network connection and operator config

  ```env
  NETWORK=testnet
  ETHEREUM_CHAIN_ID=11155111
  ETHEREUM_NODE_URL=https://...
  AZTEC_NODE_URL=https://...
  AZTEC_STAKING_PROVIDER_ID=4
  AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS=0x90e7b822a5Ac10edC381aBc03d94b866e4B985A1
  MIN_ETH_PER_ATTESTER=0.1
  # ... other config
  ```

- `{network}-available-publishers.json` - Per-server publisher addresses (in data dir for server, operator-specified path for CLI)

  ```json
  {
    "server1": ["0x111...", "0x222..."],
    "server2": ["0x333...", "0x444..."]
  }
  ```

#### Cache Files (auto-generated, in `~/.local/share/aztec-butler/`)

- `{network}-cached-attesters.json` - Attester state cache

  ```json
  {
    "attesters": [
      {
        "address": "0x...",
        "coinbase": "0x...", // optional
        "lastSeenState": "ACTIVE" // optional
      }
    ],
    "lastUpdated": "2025-12-14T...",
    "version": "2.0"
  }
  ```

- `{network}-mapped-coinbases.json` - Unchanged, keeps existing structure

### CLI Commands

**Decision: Use `scrape-attester-status` and remove `generate-scraper-config` entirely**

- Modify `scrape-attester-status` to automatically update the cache when run
- Remove the `--update-cache` flag - caching happens automatically
- This is the operator's primary tool for refreshing attester state
- Delete `generate-scraper-config` command completely

### Server Startup Flow

```
For each network:
1. Load {network}-base.env
   → Get ETHEREUM_NODE_URL, AZTEC_NODE_URL, AZTEC_STAKING_PROVIDER_ID,
      AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS, etc.

2. Load {network}-cached-attesters.json (optional, warn if missing)
   → Get attesters to monitor with their states
   → If missing: log warning and start with empty attesters list

3. Load {network}-available-publishers.json from data dir (optional)
   → Get publishers to monitor
   → If missing: log warning and start with empty publishers list

4. Initialize state with loaded data

5. Start scrapers
```

## Implementation Steps

### Phase 1: Update Type Definitions

1. **Create new schema** for `cached-attesters.json`:
   - File: `src/types/scraper-config.ts` (or create new `cached-attesters.ts`)
   - Schema:

     ```typescript
     export const CachedAttestersSchema = z.object({
       attesters: z.array(ScraperAttesterSchema),
       lastUpdated: z.string().datetime(),
       version: z.literal("2.0"),
     });
     ```

2. **Update config schema** to include new fields:
   - File: `src/core/config/index.ts`
   - Add:

     ```typescript
     AZTEC_STAKING_PROVIDER_ID: z.coerce.bigint().optional();
     ```

### Phase 2: Update File Operations

1. **Create new file operations** for cached attesters:
   - File: `src/core/utils/cachedAttestersOperations.ts` (new)
   - Functions:
     - `loadCachedAttesters(network, customPath?)`
     - `saveCachedAttesters(network, attesters, customPath?)`
   - Path: `{dataDir}/{network}-cached-attesters.json`

2. **Update available-publishers path handling**:
   - CLI: Path must always be provided by operator (no default)
   - Server: Reads from data dir `{dataDir}/{network}-available-publishers.json` (no path override option)
   - Operator must manually copy file to data dir for server use

3. **Update scraper-config operations** (or deprecate):
   - If keeping for transition: add warnings about deprecation
   - If removing: delete `src/core/utils/scraperConfigOperations.ts` exports related to scraper config

### Phase 3: Update CLI Commands

1. **Enhance `scrape-attester-status` command and remove `generate-scraper-config`**:
   - File: `src/cli/commands/scrape-attester-status.ts`
   - Modify to automatically save results to `{network}-cached-attesters.json` on every run
   - Remove all `--update-config` flag logic (now always saves to cache)
   - File: `src/cli/commands/generate-scraper-config.ts`
   - Delete this file entirely
   - File: `cli.ts`
   - Remove `generate-scraper-config` command registration

2. **Update `prepare-deployment` command**:
   - File: `src/cli/commands/prepare-deployment.ts`
   - Remove scraper-config update logic (lines ~403-486)
   - Attesters are only cached via `scrape-attester-status`, not during deployment preparation

3. **Update CLI entry point**:
   - File: `cli.ts`
   - Update command definitions
   - Update help text

### Phase 4: Update Server Code

1. **Update server initialization**:
   - File: `src/server/index.ts` (lines 52-62)
   - Replace:

     ```typescript
     const scraperConfig = await loadScraperConfig(network);
     initAttesterStatesFromScraperConfig(network, scraperConfig);
     updateScraperConfigState(network, scraperConfig);
     ```

   - With:

     ```typescript
     // Load cached attesters (optional)
     let cachedAttesters = [];
     try {
       const cache = await loadCachedAttesters(network);
       cachedAttesters = cache.attesters;
     } catch (error) {
       console.warn(`No cached attesters found for ${network}, starting fresh`);
     }

     // Load available publishers (optional)
     let publishers = [];
     try {
       const pubData = await loadAvailablePublishers(network);
       publishers = Object.values(pubData).flat();
     } catch (error) {
       console.warn(`No publisher config found for ${network}`);
     }

     // Initialize state
     initAttesterStatesFromCache(network, cachedAttesters);
     updatePublishersState(network, publishers);
     ```

2. **Update scraper constructors**:
   - Files:
     - `src/server/scrapers/staking-provider-scraper.ts`
     - `src/server/scrapers/publisher-scraper.ts`
   - Change from receiving `ScraperConfig` to receiving attesters/publishers directly
   - Or update to read from state instead of passing in constructor

3. **Update state management**:
   - File: `src/server/state/index.ts`
   - Remove `scraperConfig` from NetworkState
   - Update functions:
     - `initAttesterStatesFromScraperConfig` → `initAttesterStatesFromCache`
     - `updateScraperConfigState` → remove or refactor
     - `getScraperConfig` → remove or replace with separate getters

4. **Update metrics**:
   - Files in `src/server/metrics/`
   - Replace `getScraperConfig()` calls with direct state access
   - Update to get provider ID from config instead of scraper config

### Phase 5: Update Scripts

1. **Update shell scripts**:
   - File: `scripts/scrape-attester-status.sh`
   - Update script description to mention automatic caching behavior
   - Remove any `--update-config` flags (no longer needed)

2. **Remove generate-scraper-config script**:
   - File: `scripts/generate-scraper-config.sh`
   - Delete this file entirely

### Phase 6: Update Documentation

**Note: No migration docs needed - breaking change**

1. **Update operator guide**:
   - Files: `docs/operator-guide/*.md`
   - Replace references to scraper-config with cached-attesters
   - Update command examples
   - Update file structure diagrams
   - Phase 3 (prepare-deployment): Remove scraper config update step or update to new format
   - Phase 0: Update prerequisites to mention new file structure

2. **Update README**:
   - File: `README.md`
   - Update file structure documentation
   - Update example commands

3. **Update scripts README**:
   - File: `scripts/README.md`
   - Update script descriptions

### Phase 7: Cleanup

1. **Remove deprecated code**:
   - Remove `ScraperConfig` type (or keep minimal version if still used internally)
   - Remove `generate-scraper-config` command if replaced
   - Remove old file operation functions
   - Clean up unused imports

2. **Remove old files** (after deployment):
   - Delete `{network}-scrape-config.json` files from data dir
   - This is manual operator cleanup, mention in docs

## File Naming Convention

All cache files in data dir should follow pattern: `{network}-cached-{datatype}.json`

Examples:

- `testnet-cached-attesters.json` ✅
- `testnet-cached-coinbases.json` (renamed from `testnet-mapped-coinbases.json`)
- `mainnet-cached-attesters.json` ✅

## Testing Checklist

- [ ] Server starts successfully with new file structure
- [ ] Server handles missing cached-attesters.json gracefully
- [ ] Server handles missing available-publishers.json gracefully
- [ ] CLI command creates cached-attesters.json correctly
- [ ] Attesters are monitored correctly
- [ ] Publishers are monitored correctly
- [ ] Metrics expose correct data
- [ ] State transitions work correctly
- [ ] Multiple networks work simultaneously

## Rollout Strategy

**This is a breaking change - no backwards compatibility**

1. Implement all changes
2. Update documentation
3. Release new version (bump major version)
4. Operators must:
   - Update aztec-butler
   - Add `AZTEC_STAKING_PROVIDER_ID` to base.env files
   - (Optional) Run `scrape-attester-status` to pre-populate cache
   - (Optional) Copy `{network}-available-publishers.json` to data dir for server use
   - Restart server (will start with empty lists if cache files don't exist)

## Decisions Made

1. **CLI command approach:**
   - ✅ Use `scrape-attester-status` and make it automatically update cache on every run
   - ✅ Remove `generate-scraper-config` command entirely

2. **Rename `mapped-coinbases.json`:**
   - ✅ Yes, rename to `{network}-cached-coinbases.json` for consistency

3. **Default behavior when cached-attesters.json is missing:**
   - ✅ CLI: Execute normally and create new file
   - ✅ Server: Log warning but continue running with empty attester list (will be populated by next scrape)

4. **Available-publishers.json path handling:**
   - ✅ CLI: Path must always be provided by operator (no default location)
   - ✅ Server: Always reads from data dir at `{dataDir}/{network}-available-publishers.json` (no override option)
   - ✅ Operator copies file to data dir manually after CLI operations

## Benefits

1. ✅ Clear separation: config vs cache
2. ✅ Reduced redundancy: no duplication between base.env and scrape-config
3. ✅ Simpler server startup: read config, read cache, start
4. ✅ Future-proof: easier to add L1/L2 RPC and P2P monitoring
5. ✅ Better semantics: file names indicate purpose (cached vs configured)
6. ✅ Follows XDG Base Directory spec: config in config dir, cache in data dir

## Risks

1. ⚠️ Breaking change requires operator action
   - **Note**: This is acceptable - no migration/backwards compatibility documentation needed as this is not production software yet
2. ⚠️ Server won't start if AZTEC_STAKING_PROVIDER_ID missing from base.env
   - **Mitigation**: Clear error message pointing to missing env var
3. ⚠️ Initial deployment workflow changes
   - **Note**: Server starts fine with empty attesters/publishers - they will be populated on first scrape
   - NO! The server should start with empty attesters if cache file is missing
   - Publishers should not be required either

## Success Criteria

- [ ] Server starts with new file structure
- [ ] All existing functionality works
- [ ] Documentation is clear and accurate
- [ ] Operators can easily adopt new structure
- [ ] Code is cleaner and more maintainable
