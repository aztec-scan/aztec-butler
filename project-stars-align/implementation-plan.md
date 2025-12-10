# Project "Stars Align" - Implementation Overview

## Summary

Architectural overhaul splitting Aztec Butler into two distinct operational modes:

1. **CLI Mode** (operator's machine) - Handles sensitive operations with private keys
2. **Scraper Mode** (monitoring server) - Handles public monitoring, works only with public keys

## Core Changes Required

### 1. Remove Docker-Compose Config Parsing

**Blocker Level: HIGH** - Deeply integrated throughout codebase

- `getDockerDirData()` in `src/core/utils/fileOperations.ts` currently parses docker directory structure
- Used by CLI (`src/cli/index.ts:12`) and Server (`src/server/index.ts:79`)
- Parses `.env` files and `keys/` directory for private keys

**Required Changes:**

- Complete removal of docker-dir `.env` file parsing logic
- Aztec Butler config should be renamed from `basic` to `{network}-base.env`
- Scraper needs separate config format containing only public keys for scraping - `{network}-scrape-config.json` in stdpath data-dir
- Scraper should always start scrapers from available configs (i.e. multinetwork if both testnet and mainnet config exists)
- CLI should default to testnet if two networks exist (user should use flag to run select config)

### 2. Scraper (Server) Refactoring

**Current Private Key Usage:**

- Reads keystores via `getDockerDirData()` in `src/server/index.ts:79`
- `StakingProviderScraper` accesses keystores (`src/server/scrapers/staking-provider-scraper.ts:42`)
- State management derives addresses from private keys (`src/server/state/index.ts:771,807`)

**Required Changes:**

- Rename "Server" to "Scraper" throughout codebase
- Create new scraper config format accepting:
  - Attester public keys (ETH addresses)
    - connected coinbase (or 0x00..00 if none)
  - Publisher public keys (ETH addresses)

### 3. CLI Commands Implementation Status

#### Partially Implemented

**`addKeysToProvider` calldata** (`src/cli/commands/get-add-keys-to-staking-provider-calldata.ts`)

NOTE: this will still read the same keys.json format to generate calldata

- ✅ Exists and generates calldata
- ❌ Missing: THROW if keys already present in queue
- ❌ Missing: always console.log, also propose multisig if config available (option to opt-out)

**`fund publishers` calldata** (`src/cli/commands/get-publisher-eth.ts`)

- ✅ Exists and checks publisher balances
- ❌ Missing: Add better flags to easier just say e.g. "top-up to this amount" or "top-up X per attester it's sharing"
- ❌ Missing: ensure proposals only are proposed for a sane threshold - no nitty-gritty additions of 0.00000001 ETH etc...
- ❌ Missing: Generate actual calldata for funding
- ❌ Missing: always console.log, also propose multisig if config available (option to opt-out)

#### Not Implemented

**`scrape on-chain coinbases`**

- Inputs: start block, eth-rpc-url, attester addresses from web3signer
- Verify coinbase mappings from blockchain
- cache in butler stdpath data-dir
  - {network}-mapped-coinbases.json
  - should include up until what block it was scraped, and for which providerId
- Output: {network}-mapped-coinbases.json to selected location
- THROW for detected incorrect coinbases

**`generate scraper config`**

- Extract attester public keys from web3signer
- Extract publisher public keys from private keys
- Generate JSON config file for scraper (share zod-schema with scraper to avoid inconsistencies)

### 4. Scraper Feature Requirements

From goal.md, scraper needs to track:

**Publisher Monitoring:**

- ✅ Already implemented: ETH balance tracking
- ❌ Load calculation should be removed (it will only be derived in Grafana to be general load i.e. attestersCount/publisherCount)

**Attester State Tracking:**

- ✅ State machine exists
- ⚠️ Change in functionality:
  - remove: `WAITING_FOR_MULTISIG_SIGN` (attesters will be in NEW until they are discovered in stakingProviderQueue)
  - `IN_STAKING_QUEUE`
    - when in this state, also export metric: ATTESTERS_MISSING_COINBASE if they have 0x00..00
  - `ACTIVE`
    - when in this state, also export metric: ATTESTERS_MISSING_COINBASE_URGENT if they have 0x00..00

### 5. File Structure Changes

**For CLI:**

- Input: Private keys via key files (same format as previously)
- Output: Calldata to console or create multisig proposals

**For Scraper:**

```
scraper-config.json
{
  "rpcUrls": {
    "l1": "https://...",
    "l2": "https://..."
  },
  "attesters": [
    {
      "address": "0x...",
      "coinbase": "0x..."
    }
  ],
  "publishers": [
    {
      "address": "0x...",
    }
  ],
  "stakingProviderId": {
    "adminAddress": "0x..."
  }
}
```

## No Major Architectural Blockers

The codebase is well-structured for this split:

- ✅ State management already separated
- ✅ Scrapers are modular
- ✅ Handlers are event-driven
- ✅ Config is centralized
- ✅ Safe multisig client ready

## Implementation Priority

### Phase 1: Foundation

1. Create new config format for scraper
2. Add CLI command to generate scraper config from private keys
3. Remove docker-compose parsing dependency

### Phase 2: Scraper Refactoring

1. Update scraper to read new config format
2. Remove all private key access from scraper code

### Phase 3: CLI Completion

1. Implement "scrape on-chain coinbases" command
2. Add multisig propose option to existing commands
3. Add THROW for duplicate keys in addKeysToProvider

### Phase 4: Deployment

1. Update documentation
2. Update daemon/install scripts if needed
3. Document prerequisites (generating keys etc.)

## Guidlines

- There is no need for backwards compability for any functionality
- There is no need to consider migration of existing systems

## External Repository Changes Required

As noted in goal.md, changes needed in other repos:

- Aztec-CLI: Generate priv-keys
- GCP: Add secrets management
- Ansible: Extract pub-keys from web3signer
- Ansible: Distribute keys in aztec-compliant JSON format
- Ansible: Run butler-scraper on monitoring-server
- Ansible: Handle coinbase mappings
