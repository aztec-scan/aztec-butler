# Aztec Butler: Project Overview

## What's Done ✅

### Phase 1: CLI Commands

- Multi-network config system (`{network}-base.env`)
- Scraper config schema + operations
- CLI commands: `generate-scraper-config`, `scrape-coinbases`, `add-keys`, `check-publisher-eth`
- Bash scripts in `./scripts/` for all commands
- Comprehensive documentation in `./scripts/README.md`

### Phase 2: Server Mode Separation

- Server uses public-key-only scraper configs (`{network}-scrape-config.json`)
- Complete removal of Docker directory dependencies from server code
- Removed `src/server/watchers/` directory (no file watching)
- Removed `AttesterNewStateHandler` (operators use CLI commands instead)
- State management cleaned (no DirData/dirData in server)
- Publisher load calculated dynamically from scraper config
- Coinbase field required in schema (uses zero address `0x0000000000000000000000000000000000000000` for missing values)
- New metrics: `attesters_missing_coinbase`, `attesters_missing_coinbase_urgent`

**Result**: Clean separation - CLI has keys, server has none

### Phase 3: Complete AZTEC_DOCKER_DIR Removal

- ✅ Removed `AZTEC_DOCKER_DIR` from config schema
- ✅ Deleted `src/cli/index.ts` (legacy `runCli()` function)
- ✅ Deleted `src/cli/commands/write-attester-registration-data.ts`
- ✅ Deleted `src/types/directory.ts` (`DirData` type)
- ✅ Removed `getDockerDirData()`, `parseEnvFile()`, and related functions
- ✅ CLI commands now use keystore paths directly via glob patterns
- ✅ Updated `src/index.ts` to only support server mode
- ✅ Removed all `ATTESTER_REGISTRATIONS_DIR_NAME` references
- ✅ Scripts use `npm run cli` (no env var needed)

**Result**: No more Docker directory dependencies anywhere in codebase

### Phase 4: Incremental Coinbase Scraping

- ✅ Created shared `CoinbaseScraper` component in `src/core/components/`
- ✅ Implemented incremental scraping from `lastScrapedBlock` to current
- ✅ Added `--full` flag to force full rescrape
- ✅ Added `--from-block <block>` flag for manual block range control
- ✅ Smart merge logic with conflict detection
- ✅ Zero address (`0x0000...`) can always be overridden
- ✅ Non-zero coinbase conflicts throw errors with block number
- ✅ Updated bash script to support new flags
- ✅ Updated documentation in `scripts/README.md`

**Result**: Incremental scrapes take seconds instead of minutes, with safe merge and validation

---

## What Needs to Be Done

### CLI Argument Improvements

- Add `--min-eth <amount>` flag to `check-publisher-eth` command
- Add `--target <amount>` flag for target balance instead of minimum
- Add `--keystore <path>` flag to all commands (instead of scanning directory)
- Add `--output <format>` flag for output format (json, text)
- Consider using `yargs` or similar for better arg parsing

## Current Architecture

**CLI Mode** (operator machine with keystores):

- Access to keystores
- Generates scraper configs
- Creates calldata for Safe multisig
- Manual proposal to Safe

**Server Mode** (monitoring server):

- Uses scraper config (public keys only)
- No keystore access
- Static config (restart required for updates)
- Metrics and monitoring only

**Deployment Flow**:

1. Operator generates scraper config via CLI
2. (ansible) config to monitoring server
3. Restart server to load new config
