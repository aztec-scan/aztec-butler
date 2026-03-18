# Plan: Add Olla env-vars to prepare-deployment workflow

## Context / Current State

- `OLLA_AZTEC_STAKING_REGISTRY_ADDRESS` — already in config (`src/core/config/index.ts:147-151`), already used by `EthereumClient` for `--registry olla`. Working.
- `AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS` — one shared admin address used for both registries. Olla needs its own: `OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS`.
- `OLLA_REWARDS_COINBASE_ADDRESS` — not in config at all. For Olla, all validators share one coinbase (the `RewardsAccumulator` proxy), unlike native where coinbases are per-attester split contracts.
- `prepare-deployment` currently validates coinbases per-validator and loads from a scraped coinbase cache — none of this applies to Olla.

## Target env vars

```
OLLA_AZTEC_STAKING_REGISTRY_ADDRESS=0x62EB3A17629C8B600D494B88232874866272Ae65
OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS=0xeFB5C5e06b5d4b78838fe8186931AaD104898a9A
OLLA_REWARDS_COINBASE_ADDRESS=0xC9d7235cb57e62E36C4c814Fd80226D1cE6907fB
```

None of these are required — they're only needed when operating with `--registry olla`.

## Changes (5 tasks, 5 files)

### 1. Add 2 new env vars to config

**File:** `src/core/config/index.ts`

Add to `buildConfig()`:
- `OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS` — optional `0x` address (42 chars), same validation as the existing native one.
- `OLLA_REWARDS_COINBASE_ADDRESS` — optional `0x` address (42 chars).

### 2. Update callers to resolve the correct admin address per registry target

Currently `getStakingProvider()` takes a single `adminAddress` parameter and callers always pass `config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS`. Callers need to pick the right admin address based on target:

- `--registry olla` → use `config.OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS`
- `--registry native` → use `config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS`

Key callers to update:
- **`src/cli/commands/get-add-keys-to-staking-provider-calldata.ts`** — line 58, passes admin + target.
- **`src/cli/utils/stakingRegistryChecks.ts`** — iterates all targets with a single admin. Needs config or per-target admin map.

### 3. Update `prepare-deployment` for Olla coinbase

**File:** `src/cli/commands/prepare-deployment.ts`

Add `registry` field to `PrepareDeploymentOptions`. Behavior when `--registry olla`:
- Require `OLLA_REWARDS_COINBASE_ADDRESS` is set in config.
- Set all validators' coinbase to `OLLA_REWARDS_COINBASE_ADDRESS` — no scraping needed.
- Skip coinbase cache loading entirely (per TODO.md: "scrape/fill coinbases not needed for Olla").
- Zero-address coinbase validation still runs (but should always pass since we set them).

When `--registry native` (default): behavior unchanged.

### 4. Add `--registry` option to `prepare-deployment` CLI command

**File:** `cli.ts`

Add `--registry` option to the `prepare-deployment` command definition, matching the existing pattern from `add-keys`. Pass registry target through to the command.

### 5. Update `stakingRegistryChecks.ts` to use per-registry admin address

**File:** `src/cli/utils/stakingRegistryChecks.ts`

The cross-registry duplicate checker iterates all targets with a single `adminAddress`. Change signature to accept config or a per-target admin map so it can resolve the correct admin address per target.

## Files to modify

| File | Change |
|---|---|
| `src/core/config/index.ts` | Add `OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS` and `OLLA_REWARDS_COINBASE_ADDRESS` |
| `src/cli/commands/prepare-deployment.ts` | Add `registry` option, use Olla coinbase, skip coinbase cache for olla |
| `cli.ts` | Add `--registry` option to `prepare-deployment` command |
| `src/cli/utils/stakingRegistryChecks.ts` | Accept per-target admin addresses instead of single admin |
| `src/cli/commands/get-add-keys-to-staking-provider-calldata.ts` | Use olla admin address when `--registry olla` |

## Not in scope

- **ABIs** — assume current ABI works for both targets.
- **Server scrapers** — out of scope per previous plan.
- **`process-private-keys`** — already has `--registry` support, minor follow-up to use correct admin address.
- **`EthereumClient` internals** — methods are fine; it's callers that pick the right admin address.
