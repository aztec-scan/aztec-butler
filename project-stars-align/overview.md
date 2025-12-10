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
- CLI retains all Docker directory / keystore functionality

**Result**: Clean separation - CLI has keys, server has none

---

## What Needs to Be Done

### Remove AZTEC_DOCKER_DIR Entirely

- Remove `AZTEC_DOCKER_DIR` from CLI code (currently still required)
- Update all CLI commands to accept keystore paths directly
- Remove `getDockerDirData()` function and `DirData` types entirely
- Update `./scripts/*.sh` to not require AZTEC_DOCKER_DIR env var
- Update configuration schema to remove AZTEC_DOCKER_DIR

### Incremental Coinbase Scraping

- Store `lastScrapedBlock` in coinbase cache (`{network}-mapped-coinbases.json`)
- Update `scrape-coinbases.ts` to query events from last block to current
- Add `--from-block <block>` CLI flag for manual control
- Add `--full` flag to force full rescrape
- Merge incremental results with existing cache

**Benefits**: Seconds instead of minutes, less RPC load

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
