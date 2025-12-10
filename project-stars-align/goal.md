# Project "Stars Align"

Architectural overhaul splitting Aztec Butler into two distinct operational modes:

1. **CLI Mode** (operator's machine) - Handles sensitive operations with private keys
2. **Scraper Mode** (monitoring server) - Handles public monitoring with public keys only

## Current Status

**Phase 1: COMPLETE** ✅

All CLI commands implemented:

- `generate-scraper-config` - Creates scraper config from keystores
- `scrape-coinbases` - Maps attesters to coinbase addresses via on-chain events
- `add-keys` - Generates calldata for adding keys (with duplicate detection)
- `check-publisher-eth` - Checks balances and generates funding calldata

See `./scripts/README.md` for usage.

## Key Changes Made

### Configuration

- Multi-network support: `{network}-base.env` files
- Scraper configs: `{network}-scrape-config.json` (public keys only)
- Coinbase cache: `{network}-mapped-coinbases.json`
- No backward compatibility with old configs

### CLI (Operator Machine)

- Works with keystores in `./keystores/` directory
- Generates calldata for Safe multisig proposals
- Checks for duplicates before generating proposals
- Can update scraper config automatically

### Scraper (Phase 2 - Pending)

- Will use public-key-only scraper config
- Runs on monitoring server
- No access to private keys

### State Management

- Removed `WAITING_FOR_MULTISIG_SIGN` state
- Attesters stay in `NEW` until on-chain

## Next Steps

**Phase 2**: Update Scraper mode to use public-key configs (remove AZTEC_DOCKER_DIR)
**Phase 3**: Safe multisig auto-proposal (currently manual copy/paste)
**Phase 4**: External repo changes (Ansible, key distribution)
