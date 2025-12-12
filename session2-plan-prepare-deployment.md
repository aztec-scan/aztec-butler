# Session 2 Plan: prepare-deployment Command (with HA)

## Goal

Implement Phase 3 of the full key flow: a CLI command that merges production keys with new public keys, redistributes publishers, validates coinbases/funding, updates scraper config, and supports high-availability mode.

## Clarifications from Reference Files

After analyzing after_phase3/ files:

1. Publisher redistribution: Round-robin applies to ALL validators (old + new), replacing existing publisher assignments
2. Coinbase validation: Fail only on explicit "coinbase": "0x0000...0000". Missing coinbase field is acceptable.
3. New validators: Get publisher assigned but NO coinbase field
4. Available publishers file format: Simple JSON array of addresses

## Command Interface

```bash
aztec-butler prepare-deployment \
  --production-keys <path>          # Existing keyfile with web3signer
  --new-public-keys <path>          # Output from process-private-keys
  --available-publishers <path>     # JSON array of publisher addresses
  [--high-availability-count <n>]   # Optional: create n files with non-overlapping publishers
  [--output <path>]                 # Optional: override output path
```

## Implementation Steps

### 1. Load and Validate Input Files

- Load production keyfile (validate has remoteSigner, validators array)
- Load new public keys file (from Phase 2)
- Load available publishers JSON array
- Fail if any file is malformed

### 2. Duplicate Check

- Collect all attester.eth addresses from both files
- Fail if any address appears more than once

### 3. Coinbase Validation

- Check all validators (old and new) for explicit zero-address coinbase
- Zero-address = "0x0000000000000000000000000000000000000000" (40 zeros)
- Missing coinbase field is acceptable
- Fail with clear error listing which validator(s) have zero coinbase

### 4. Publisher Funding Check

- Query ETH balance for each address in available-publishers array
- If any has 0 ETH → fail with error
- If any has < MIN_ETH_PER_ATTESTER → warn to console

### 5. High Availability Validation (if enabled)

- If --high-availability-count provided:
  - Validate publishers.length >= high-availability-count
  - Fail if not enough publishers

### 6. Generate Output File(s)

**Without HA (or HA count = 1):**

- Create single file [production-keys].new (or .new2 if exists)
- Merge validators: production validators + new validators
- Round-robin assign publishers to ALL validators

**With HA (count > 1):**

- Partition publishers into n non-overlapping sets
- Create files: A*[filename].new, B*[filename].new, etc.
- Each file has ALL validators but different publisher sets
- Round-robin within each file's publisher set

### 7. Update Scraper Config

- Load existing scraper config for network
- Add new attesters with:
  - address: attester.eth
  - publisher: assigned publisher (from first/A file)
  - coinbase: "0x0000000000000000000000000000000000000000" (not yet known)
  - lastSeenState: "NEW"
- Merge with existing (dedupe by address, prefer non-zero coinbase)
- Save updated config

## Files to Create/Modify

**Create:**

- src/cli/commands/prepare-deployment.ts

**Modify:**

- src/cli/commands/index.ts - add export
- cli.ts - register command

## Testing Plan

1. Basic merge test: Run with reference files, compare to after_phase3/
2. Duplicate detection: Test with overlapping attester addresses
3. Zero coinbase rejection: Test with validator having explicit zero coinbase
4. HA mode: Test with 3 publishers, HA count 3 → 3 files, 1 publisher each
5. HA validation: Test with 2 publishers, HA count 3 → should fail
