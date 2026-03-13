## Multi-Registry Key Proposal Plan (native + olla)

### Goal

Extend butler so validator keys can be proposed to either staking registry target:

- `native` (Aztec native staking registry)
- `olla` (Olla staking registry)

Both paths still end with validators becoming Attesters in Aztec Rollup.

### Scope

- In scope: CLI/config/client changes needed to generate and propose calldata to `native` or `olla` staking registries.
- Out of scope: server scrapers/metrics/state transitions refactor (scrapers remain unchanged in this plan).

### Config Changes

1. Add optional env var in config parsing/validation:
   - `OLLA_AZTEC_STAKING_REGISTRY_ADDRESS`
2. Keep existing native behavior as default when no registry flag is provided.
3. Keep existing Safe proposer flow unchanged:
   - same `SAFE_ADDRESS`, proposer key, and Safe API key
   - only transaction `to` address varies by selected registry target

### Registry Targeting Model

1. Introduce registry target enum/string union used by CLI + client:
   - `native` | `olla`
2. Wire `--registry <native|olla>` into relevant commands, default `native`.
3. Fail fast with clear error if `--registry olla` is selected and `OLLA_AZTEC_STAKING_REGISTRY_ADDRESS` is missing.

### Ethereum Client Refactor

1. Refactor staking registry access to be target-aware (instead of single hardcoded registry):
   - resolve address by target
   - cache contract instances per target
2. Update provider/queue methods to accept target:
   - `getStakingRegistryAddress(...)`
   - `getStakingProvider(...)`
   - `getProviderQueueLength(...)`
   - `getProviderQueue(...)`
   - calldata generation for `addKeysToProvider(...)`

### CLI Command Updates

Add `--registry <native|olla>` to proposal-related commands:

1. `add-keys`
2. `get-provider-id`
3. `get-create-staking-provider-calldata`
4. `process-private-keys` (duplicate-check logic)

Each command should:

- log selected registry target and contract address
- use target-aware Ethereum client calls

### Duplicate-Check Requirements

Duplicate attester checks must be performed across registries (not only selected target):

1. For `add-keys` and `process-private-keys`, load provider queues from both `native` and `olla` (where configured).
2. Reject if any candidate attester already exists in either queue.
3. If one registry is not configured/available, continue with explicit warning and still check the other.
4. Error output should identify where duplicate was found (`native`, `olla`, or both).

### Backward Compatibility

1. Default behavior remains `native` if no flag is passed.
2. Existing configs continue to work without requiring Olla env vars.
3. Existing SAFE proposer/multisig destination remains the same address unless user changes it.

### Documentation Updates

Update docs to reflect:

1. New `--registry <native|olla>` flag and examples.
2. New env var `OLLA_AZTEC_STAKING_REGISTRY_ADDRESS`.
3. Duplicate-check behavior across both registries.
4. Explicit note that scraper support is out of scope for this change.

### Validation Plan

1. Build/typecheck: `npm run build`.
2. Smoke tests:
   - `add-keys` default (`native`) unchanged behavior
   - `add-keys --registry olla` targets Olla address
   - `get-provider-id --registry olla` resolves provider from Olla registry
   - duplicate-checks trigger when attester exists in either registry queue
3. Safe proposal dry run:
   - confirm transaction `to` address matches selected registry
