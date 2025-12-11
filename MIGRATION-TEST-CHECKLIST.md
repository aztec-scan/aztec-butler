# Commander Migration Testing Checklist

**Quick reference for validating the Commander.js migration**

## Shell Scripts Testing (PRIORITY 1)

**These scripts MUST work after migration:**

```bash
# add-keys.sh
./scripts/add-keys.sh keystores/examples/key1.json
./scripts/add-keys.sh keystores/examples/key1.json --update-config

# check-publisher-eth.sh
./scripts/check-publisher-eth.sh

# generate-scraper-config.sh
./scripts/generate-scraper-config.sh
./scripts/generate-scraper-config.sh --provider-id 123

# get-provider-id.sh
./scripts/get-provider-id.sh 0x1234567890abcdef1234567890abcdef12345678

# scrape-attester-status.sh
./scripts/scrape-attester-status.sh
./scripts/scrape-attester-status.sh --active
./scripts/scrape-attester-status.sh --active --queued
./scripts/scrape-attester-status.sh --all-active
./scripts/scrape-attester-status.sh --all-queued
./scripts/scrape-attester-status.sh --address 0x123...
./scripts/scrape-attester-status.sh --address 0x123... --address 0x456...

# scrape-coinbases.sh
./scripts/scrape-coinbases.sh
./scripts/scrape-coinbases.sh --full
./scripts/scrape-coinbases.sh --from-block 12345678
./scripts/scrape-coinbases.sh --provider-id 123
./scripts/scrape-coinbases.sh --full --provider-id 123

# start-server.sh
./scripts/start-server.sh  # Then Ctrl+C to stop
```

## Direct CLI Testing (PRIORITY 2)

```bash
# Help & General
npm run cli -- --help
npm run cli -- unknown-command  # Should error gracefully

# get-provider-id
npm run cli -- get-provider-id 0x1234567890abcdef1234567890abcdef12345678
npm run cli -- get-provider-id  # Should error: missing arg
npm run cli -- get-provider-id --help

# check-publisher-eth
npm run cli -- check-publisher-eth
npm run cli -- check-publisher-eth --help

# add-keys
npm run cli -- add-keys keystores/examples/key1.json
npm run cli -- add-keys keystores/examples/key1.json --update-config
npm run cli -- add-keys  # Should error: missing arg
npm run cli -- add-keys --help

# generate-scraper-config
npm run cli -- generate-scraper-config
npm run cli -- generate-scraper-config --provider-id 123
npm run cli -- generate-scraper-config --provider-id invalid  # Should error
npm run cli -- generate-scraper-config --help

# scrape-coinbases
npm run cli -- scrape-coinbases
npm run cli -- scrape-coinbases --full
npm run cli -- scrape-coinbases --from-block 12345678
npm run cli -- scrape-coinbases --provider-id 123
npm run cli -- scrape-coinbases --full --provider-id 123
npm run cli -- scrape-coinbases --help

# scrape-attester-status
npm run cli -- scrape-attester-status
npm run cli -- scrape-attester-status --active
npm run cli -- scrape-attester-status --queued
npm run cli -- scrape-attester-status --active --queued
npm run cli -- scrape-attester-status --all-active
npm run cli -- scrape-attester-status --all-queued
npm run cli -- scrape-attester-status --address 0x123...
npm run cli -- scrape-attester-status --address 0x123... --address 0x456...
npm run cli -- scrape-attester-status --help
```

## Server Mode Testing (PRIORITY 2)

```bash
# Development mode
npm run dev:serve  # Then Ctrl+C

# Production mode
npm run build
npm start  # Then Ctrl+C
node dist/index.js serve  # Then Ctrl+C
node dist/index.js --help
```

## Validation Criteria

- [ ] All scripts exit with code 0 on success, 1 on error
- [ ] Error messages are clear and helpful
- [ ] Help text is accurate and complete
- [ ] All flags and arguments work as expected
- [ ] No regression in functionality
- [ ] No changes to output format (unless intentional)

## Quick Regression Check

If you need a fast smoke test, run these minimal tests:

```bash
# Smoke test (5 minutes)
./scripts/check-publisher-eth.sh
./scripts/get-provider-id.sh <your-admin-address>
./scripts/scrape-attester-status.sh --active
npm run cli -- --help
npm run dev:serve  # Ctrl+C after startup
```

## Rollback Command

If anything breaks:

```bash
git revert HEAD  # Revert the migration commit
npm install      # Restore dependencies
```
