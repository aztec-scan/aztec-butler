# Plan: Sync Olla ABI + Event-based Queue Parity

## Goal

Implement Olla support with **maximum behavioral parity** to native by:

1. syncing Olla ABI from `olla-core` artifacts (Option B), and
2. using **event-based queue reconstruction** for duplicate checks.

## Why this is needed

- Olla `StakingProviderRegistry` ABI differs from Aztec `StakingRegistry`:
  - no `registerProvider(...)`
  - no `providerConfigurations(uint256)` iterator
  - no indexed queue read methods (`getFirstIndexInQueue`, `getLastIndexInQueue`, `getValueAtIndexInQueue`)
  - uses `addKeysToProvider(KeyStore[])`, `getQueueLength()`, `getStakingProviderConfig()`
- Butler currently uses one native-oriented ABI and native queue read strategy.
- To preserve duplicate-check parity, Olla queue must be reconstructed from events.

## Scope

- In scope:
  - ABI sync pipeline from `olla-core/contracts/out/...`
  - Olla-target contract read/write support in `EthereumClient`
  - Event-based Olla queue reconstruction for duplicate checks
  - Olla-compatible calldata generation for `add-keys`
  - Olla behavior for `get-create-staking-provider-calldata`
- Out of scope:
  - changing Olla contracts
  - modifying deploy flows in `olla-core`

## Implementation Plan

### 1) Add ABI sync pipeline for Olla registry

Create a script in this repo that mirrors `olla-ui/scripts/sync-contracts.ts` behavior for ABI extraction.

- New script (example): `scripts/sync-olla-abi.ts`
  - source artifact:
    - `/home/filip/c/olla-core/contracts/out/StakingProviderRegistry.sol/StakingProviderRegistry.json`
  - extract `abi` field
  - write to stable generated location in Butler, e.g.:
    - `src/types/generated/olla-staking-provider-registry-abi.json`
- Add npm script in `package.json`:
  - `"sync:olla-abi": "tsx scripts/sync-olla-abi.ts"` (or equivalent runtime used in repo)
- Add a short docs note (README or command docs) for when to run sync.

Acceptance:

- Running `npm run sync:olla-abi` refreshes generated ABI from local `olla-core` artifact.

### 2) Introduce target-specific ABI typing and contract getters

Update Butler types/client so native and Olla are first-class targets.

- Keep existing native `STAKING_REGISTRY_ABI` unchanged.
- Add Olla ABI import from generated JSON and type alias for Olla contract.
- In `EthereumClient`:
  - support target-specific contract creation/getter:
    - native → current ABI
    - olla → generated Olla ABI
  - keep shared registry address selection logic by target.

Acceptance:

- `EthereumClient` can read/write against Olla registry without ABI mismatch.

### 3) Implement Olla provider resolution parity

Native provider lookup iterates provider IDs; Olla has a single provider config.

- In `EthereumClient.getStakingProvider(...)`:
  - native: keep current behavior.
  - olla:
    - call `getStakingProviderConfig()`
    - compare `config.admin` to requested admin
    - if match, return normalized `StakingProviderData` with synthetic `providerId` (e.g. `0n`) for compatibility
    - set `takeRate` placeholder if needed by type usage (or make type optional where safe)

Acceptance:

- `getStakingProvider(admin, "olla")` returns non-null when Olla admin matches on-chain config.

### 4) Implement event-based Olla queue reconstruction

Add queue-reader path for Olla that reconstructs current queue from events:

- Required events from Olla ABI:
  - `KeysAddedToProvider(address[] attesters)`
  - `QueueDripped(address attester)`
- Add a method in `EthereumClient` for Olla queue materialization, e.g.:
  - fetch both event streams from deployment block (or safe configured block) to latest
  - replay chronologically:
    - `KeysAddedToProvider`: enqueue attesters in order
    - `QueueDripped`: dequeue one; optionally assert emitted attester matches head (warn if mismatch)
  - return resulting queue addresses
- `getProviderQueueLength(...)` for Olla should call `getQueueLength()` directly.
- `getProviderQueue(...)`:
  - native: existing indexed reads
  - olla: event-reconstructed queue

Performance/correctness notes:

- Add optional block-range chunking for `getLogs` if provider limits hit.
- Cache reconstructed queue per `(target, latestBlock)` during command run to avoid repeated scans.

Acceptance:

- Cross-registry duplicate checker includes Olla queue entries with parity-quality behavior.

### 5) Update add-keys calldata generation for Olla signature

In `get-add-keys-to-staking-provider-calldata.ts`:

- Native encoding remains:
  - `addKeysToProvider(providerId, keyStores)`
- Olla encoding becomes:
  - `addKeysToProvider(keyStores)`
- Keep chunking and output format behavior same for UX parity.

Acceptance:

- `add-keys --registry olla` produces valid calldata shape for Olla registry.

### 6) Update create-provider calldata command for Olla semantics

In `get-create-staking-provider-calldata.ts`:

- Native: unchanged `registerProvider(...)` calldata generation.
- Olla:
  - do not encode `registerProvider` (function does not exist)
  - print explicit guidance that provider is configured via deployment/initialization + roles
  - optionally display current `getStakingProviderConfig()` and whether admin matches configured Olla admin env var.

Acceptance:

- Command no longer emits invalid Olla calldata and gives actionable output.

### 7) Keep duplicate-check utility parity-safe

In `stakingRegistryChecks.ts`:

- Keep per-target admin map.
- Continue checking all available targets.
- For Olla target, rely on `EthereumClient` event-based queue path transparently.

Acceptance:

- Duplicate check output remains consistent across targets with no ABI-specific branching in command layer.

### 8) Validation and smoke tests

Run:

- `npm run sync:olla-abi`
- `npm run type-check`
- Olla smoke:
  - `get-provider-id --registry olla`
  - `get-create-staking-provider-calldata --registry olla` (should show guidance, not bad calldata)
  - `add-keys --registry olla` with test keys file (should produce calldata without providerId arg)
- Native regression smoke:
  - `get-provider-id --registry native`
  - `add-keys --registry native` (still providerId + keys signature)

## File-level change list

- `scripts/sync-olla-abi.ts` (new)
- `package.json` (add `sync:olla-abi` script)
- `src/types/generated/olla-staking-provider-registry-abi.json` (generated)
- `src/types/*` (if needed for Olla ABI export/type aliases)
- `src/core/components/EthereumClient.ts` (target-specific ABI + Olla queue reconstruction)
- `src/cli/commands/get-add-keys-to-staking-provider-calldata.ts` (Olla calldata signature)
- `src/cli/commands/get-create-staking-provider-calldata.ts` (Olla semantics)
- `src/cli/utils/stakingRegistryChecks.ts` (minimal/no further changes expected)

## Risks and mitigations

- RPC `getLogs` limits/rate limits
  - mitigate with block-range chunking + retries
- Event replay divergence if historical data is missing
  - mitigate via clear warning + fallback behavior; optionally configurable start block
- ABI drift between local `olla-core` and deployed contracts
  - mitigate by pinning/recording commit hash used for sync in docs or sync output

## Definition of Done

- Olla ABI is sourced via sync script, not manually maintained.
- `add-keys --registry olla` generates valid calldata for Olla contract.
- Duplicate checks include Olla queue via event reconstruction.
- Native behavior remains unchanged.
- Type-check passes.
