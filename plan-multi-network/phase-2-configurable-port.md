# Phase 2: Make Metrics Port Configurable

## Problem

The Prometheus metrics port is hardcoded to `9464` in `src/server/index.ts:305`. With one process per network, each needs its own port.

## Solution

Add `METRICS_PORT` to the config system. Default to `9464` for backward compatibility.

## Changes

### 1. Add `METRICS_PORT` to `src/core/config/index.ts`

In `buildConfig()`, add:

```typescript
METRICS_PORT: parseConfigField(
  "METRICS_PORT",
  z.coerce.number().int().positive(),
  process.env.METRICS_PORT || "9464",
),
```

### 2. Use config value in `src/server/index.ts`

Replace:

```typescript
const metricsPort = 9464;
```

With:

```typescript
const metricsPort = firstConfig.METRICS_PORT;
```

## Port Allocation

| Network | Port                      |
| ------- | ------------------------- |
| mainnet | 9464 (default, unchanged) |
| testnet | 9465                      |
| devnet  | 9466                      |

## Files Changed

| File                       | Action                               |
| -------------------------- | ------------------------------------ |
| `src/core/config/index.ts` | **Edit** -- add `METRICS_PORT` field |
| `src/server/index.ts`      | **Edit** -- use config value         |
