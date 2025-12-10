# Implementation Plan

## Phase 1: CLI Commands ✅ COMPLETE

**Objective**: Remove Docker directory dependency from CLI, work with keystore files directly

**Completed:**

- ✅ Multi-network config system (`{network}-base.env`)
- ✅ Scraper config schema + operations
- ✅ Keystore operations (extract addresses, load from paths)
- ✅ `generate-scraper-config` - Create config from keystores
- ✅ `scrape-coinbases` - Scrape StakedWithProvider events
- ✅ `add-keys` - Generate calldata with duplicate detection + optional config update
- ✅ `check-publisher-eth` - Check balances + generate funding calldata
- ✅ Removed `WAITING_FOR_MULTISIG_SIGN` state
- ✅ Bash scripts in `./scripts/` for all commands
- ✅ Comprehensive documentation in `./scripts/README.md`

## Phase 2: Scraper Mode (Pending)

**Objective**: Update Scraper (Server) mode to use public-key-only configs

**Tasks:**

1. Update `src/server/index.ts` to load `{network}-scrape-config.json` instead of keystores
2. Update scrapers to work with public addresses only
3. Remove `AZTEC_DOCKER_DIR` requirement from scraper mode
4. Update metrics to use scraper config
5. Add `ATTESTERS_MISSING_COINBASE` and `ATTESTERS_MISSING_COINBASE_URGENT` metrics

## Phase 3: Enhancements (Optional)

**Objective**: Polish and automation

**Tasks:**

1. Auto-propose to Safe multisig (currently manual copy/paste)
2. CLI argument improvements (`--target-balance`, `--threshold` flags)
3. Incremental coinbase scraping (use `lastScrapedBlock`)

## Phase 4: Deployment (External)

**Objective**: Ansible/infrastructure updates

**External tasks** (other repos):

- Ansible: Key distribution
- Ansible: Deploy scraper with new configs
- Documentation: Migration guide
- GCP: Secrets management

---

## Notes

- No backward compatibility required
- Phase 1 is production-ready for CLI usage
- Scraper mode still works with old system (AZTEC_DOCKER_DIR)
