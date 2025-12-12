this doc is only intended as support. overview.md has the most recent and accurate plan.

Implementation Plan Summary
Based on the clarified document, here's my implementation plan:
Phase 2: process-private-keys Command
Inputs:

- --private-keys <path> - Path to private keys JSON file
- --output <path> (optional) - Output file path (default: public-[inputFilename].json in current directory)
- --network <name> (optional) - Network config to use for provider queue check
  Steps:

1. Load and validate private keys file (fail on malformed keys)
2. Derive public keys:
   - ETH addresses using viem's privateKeyToAccount
   - BLS public keys using @aztec/foundation/crypto/bn254
3. Console log all private/public key pairs (placeholder for GCP) + TODO comment
4. Check that derived ETH addresses are NOT in provider queue (reuse logic from existing command)
5. Create output file with public keys only (attester.eth, attester.bls, feeRecipient)
   Output: Public keys JSON file

---

Phase 3: prepare-deployment Command
Inputs:

- --production-keys <path> - Existing production keyfile (public keys with web3signer)
- --new-public-keys <path> - Output from phase 2
- --available-publishers <path> - JSON array of available publisher addresses
- --high-availability-count <number> (optional) - Number of HA files to create (default: 1)
- --network <name> (optional) - Network for ETH balance checks
  Steps:

1. Load production keys, new public keys, and available publishers
2. Check for duplicate attesters between files (fail if found)
3. Validate existing validators don't have zero-address coinbases (fail if found)
4. Create merged validator array (append new to existing)
5. Distribute publishers:
   - For HA mode: validate enough publishers (fail if publishers.length < ha-count)
   - Partition publishers into non-overlapping sets
   - Round-robin assign publishers to all validators
6. Check publisher funding (warn if low, fail if zero)
7. Create output file(s) with .new suffix (or .new2 if exists)
8. Update scraper config:
   - Merge all attesters (dedupe, prefer non-zero coinbase)
   - Set new attesters to lastSeenState: "NEW"
     Output: One or more deployment-ready keyfiles + updated scraper config

---

Implementation Approach Recommendation
Yes, I strongly recommend implementing this one phase/command at a time in separate sessions. Here's why:
Advantages of Separate Sessions:

1. Clear Focus & Testing
   - Each session has a single, well-defined goal
   - Can test against reference files after each phase (as document states on line 27)
   - Easier to verify correctness before moving to next phase
2. Reduced Complexity
   - Phase 2 is relatively straightforward (key derivation + validation)
   - Phase 3 is more complex (merging, HA mode, scraper config, multiple validations)
   - Tackling them separately reduces cognitive load and chance of errors
3. Natural Dependencies
   - Phase 2 must work before Phase 3 can be tested
   - Output of Phase 2 is input to Phase 3
   - Testing Phase 2 thoroughly will prevent downstream issues
4. Easier Review & Iteration
   - You can review and test Phase 2 implementation before committing to Phase 3
   - If adjustments are needed, they won't affect half-finished work on Phase 3
   - Each PR/commit is self-contained and reviewable
5. Risk Management
   - If Phase 2 reveals unexpected challenges (e.g., with @aztec/foundation import), we address it before starting Phase 3
   - Smaller changes = easier to debug and rollback if needed
     Suggested Session Breakdown:

Session 1: Phase 2 - process-private-keys command

- Focus: Key derivation, validation, provider queue check
- Output: New CLI command that produces public keys file
- Test: Compare output to key-files-and-phases/after_phase2/

Session 2: Phase 3 - prepare-deployment command (without HA)

- Focus: Merging keys, publisher distribution, scraper config update
- Output: Basic deployment preparation (single file)
- Test: Compare output to key-files-and-phases/after_phase3/

Session 3: Phase 3 Extension - High Availability mode

- Focus: Publisher partitioning for multiple deployment files
- Output: Enhanced command with --high-availability-count option
- Test: Manual validation with multiple publishers/validators scenarios
