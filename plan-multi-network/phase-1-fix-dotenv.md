# Phase 1: Fix dotenv Config Pollution (aztec-butler)

## Problem

`src/core/config/index.ts:62` calls `dotenv.config({ path })` which merges parsed values into `process.env`. When `loadAllAvailableNetworkConfigs()` loads multiple networks sequentially, values from earlier networks leak into later ones.

Example: if `mainnet-base.env` sets `ETHEREUM_NODE_URL=https://rpc.mainnet.eth.beast-4.aztlanlabs.xyz` and `testnet-base.env` does NOT set `ETHEREUM_NODE_URL`, testnet inherits mainnet's value.

Even if all env files set every key, this is fragile -- any omission causes silent cross-contamination.

## Solution

Replace `dotenv.config()` (which writes to `process.env`) with `dotenv.parse()` (which returns a plain object). Pass the parsed object into `buildConfig()` instead of having it read from `process.env`.

## Changes

### File: `src/core/config/index.ts`

### Step 1: Change `loadNetworkConfig()` to use `dotenv.parse()`

**Before:**

```typescript
async function loadNetworkConfig(
  network: string,
  suppressLog?: boolean,
  userConfigFilePath?: string,
): Promise<ReturnType<typeof buildConfig>> {
  const configPath =
    userConfigFilePath || path.join(getConfigDir(), `${network}-base.env`);
  dotenv.config({ path: configPath });

  const config = buildConfig(network);
  // ...
```

**After:**

```typescript
async function loadNetworkConfig(
  network: string,
  suppressLog?: boolean,
  userConfigFilePath?: string,
): Promise<ReturnType<typeof buildConfig>> {
  const configPath =
    userConfigFilePath || path.join(getConfigDir(), `${network}-base.env`);

  // Parse env file into isolated object instead of polluting process.env
  let envVars: Record<string, string> = {};
  try {
    const envFileContent = await fs.readFile(configPath, "utf-8");
    envVars = dotenv.parse(envFileContent);
  } catch (error) {
    // File doesn't exist yet -- will be handled by ensureConfigFile below
  }

  const config = buildConfig(network, envVars);
  // ...
```

### Step 2: Change `buildConfig()` to accept env object

**Before:**

```typescript
function buildConfig(network: string) {
  return {
    NETWORK: parseConfigField("NETWORK", z.string(), network),
    ETHEREUM_CHAIN_ID: parseConfigField(
      "ETHEREUM_CHAIN_ID",
      z.coerce.number().int(),
      process.env.ETHEREUM_CHAIN_ID,
    ),
    ETHEREUM_NODE_URL: parseConfigField(
      "ETHEREUM_NODE_URL",
      z.string().url(),
      process.env.ETHEREUM_NODE_URL || "http://localhost:8545",
    ),
    // ... all other fields reading from process.env
  };
}
```

**After:**

```typescript
function buildConfig(network: string, env: Record<string, string> = {}) {
  // Merge: env file values take precedence, fall back to process.env for
  // values that might be set globally (e.g. METRICS_BEARER_TOKEN via systemd)
  const get = (key: string) => env[key] ?? process.env[key];

  return {
    NETWORK: parseConfigField("NETWORK", z.string(), network),
    ETHEREUM_CHAIN_ID: parseConfigField(
      "ETHEREUM_CHAIN_ID",
      z.coerce.number().int(),
      get("ETHEREUM_CHAIN_ID"),
    ),
    ETHEREUM_NODE_URL: parseConfigField(
      "ETHEREUM_NODE_URL",
      z.string().url(),
      get("ETHEREUM_NODE_URL") || "http://localhost:8545",
    ),
    // ... all other fields: replace process.env.X with get("X")
  };
}
```

The `get()` helper checks the parsed env file first, then falls back to `process.env`. This allows systemd-level environment variables (like `NODE_ENV`) to still work, while keeping per-network config fully isolated.

### Step 3: Update `ensureConfigFile()`

The `ensureConfigFile` call needs the parsed env object passed through so it can write defaults. No functional change needed -- it already receives the built `config` object.

### Step 4: Update type export

No change needed -- `ButlerConfig` is derived from `buildConfig()` return type, and the return shape doesn't change.

## Testing

1. Create two env files with different values for the same keys
2. Call `loadAllAvailableNetworkConfigs()` and verify each network gets its own values
3. Verify that a key missing from one env file does NOT inherit from another network's file
4. Verify that `process.env` values (e.g. from systemd `Environment=`) still work as fallbacks

## Risk

Low. This is a targeted change to one function's input source. The config object shape is unchanged. All downstream code is unaffected.
