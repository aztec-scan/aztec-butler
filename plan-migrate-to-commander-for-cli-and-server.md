# Migration Plan: Commander.js for CLI and Server

## Executive Summary

**Goal:** Replace manual argument parsing in `cli.ts` and `src/index.ts` with Commander.js to reduce boilerplate, improve maintainability, and provide auto-generated help text.

**Estimated effort:** 4-6 hours
**Lines of code reduction:** ~100-150 lines (~35-40%)
**Risk level:** Low (Commander is battle-tested, migration is straightforward)

**⚠️ CRITICAL VALIDATION REQUIREMENT:** All shell scripts in `scripts/` directory must continue to work after migration. These scripts are used in production workflows and automation.

---

## Benefits

### Quantified Improvements

1. **Code Reduction**
   - `cli.ts`: ~299 lines → ~150-180 lines (40% reduction)
   - `src/index.ts`: ~45 lines → ~30-35 lines (22% reduction)
   - Total: ~150 lines removed

2. **Maintenance Wins**
   - Auto-generated help text (removes 54 lines of manual help in `cli.ts`)
   - Type-safe argument access (reduces runtime errors)
   - Consistent error messages across commands
   - Self-documenting command structure

3. **Developer Experience**
   - Adding new command: 30-40 lines → 10-15 lines
   - Adding new option: 5-8 lines → 1-3 lines
   - Help text updates: Manual → Automatic

### Qualitative Improvements

- Industry-standard CLI patterns (easier onboarding)
- Built-in validation reduces defensive code
- Subcommand support for future extensibility
- Better error messages out-of-the-box

---

## Migration Strategy

### Phase 1: Setup (30 minutes)

**1.1 Install Commander**

```bash
npm install commander
npm install --save-dev @types/commander
```

**1.2 Create utilities file**
Create `src/cli/utils/commander-helpers.ts` for shared utilities:

- BigInt coercion helper
- Common option builders
- Error formatter wrapper

---

### Phase 2: Migrate `src/index.ts` (1 hour)

**Current state:** Simple mode switch between "serve" and error
**Target:** Commander program with single `serve` command

**File:** `src/index.ts`

**Changes:**

```typescript
// BEFORE (lines 20-36)
const mode = process.argv[2] || "serve";
const main = async () => {
  checkNodeVersion();
  switch (mode) {
    case "serve":
      const { startServer } = await import("./server/index.js");
      await startServer();
      break;
    default:
      console.error(`Unknown mode: ${mode}`);
      console.error("Available modes: serve");
      process.exit(1);
  }
};

// AFTER
import { Command } from "commander";

const program = new Command();

program
  .name("aztec-butler")
  .description("Aztec staking provider management tool")
  .version("2.0.0");

program
  .command("serve")
  .description("Start the metrics server and scrapers")
  .action(async () => {
    checkNodeVersion();
    const { startServer } = await import("./server/index.js");
    await startServer();
  });

program.parseAsync(process.argv).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

**Testing:**

- `npm run dev:serve` should work as before
- `npm start` should work as before
- `node dist/index.js --help` should show help

**Future extensibility:** Can add `program.command('cli')` later if you want to consolidate entry points

---

### Phase 3: Migrate `cli.ts` (3-4 hours)

#### 3.1 Setup Base Structure (30 min)

**Replace lines 14-53 with:**

```typescript
import { Command } from "commander";

const program = new Command();

program
  .name("aztec-butler-cli")
  .description("Aztec Butler CLI - Individual command execution")
  .version("2.0.0");

// Helper for BigInt parsing
function parseBigInt(value: string): bigint {
  return BigInt(value);
}

// Helper to collect multiple values for --address flags
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
```

#### 3.2 Migrate Commands One-by-One

**Order of migration (simplest to most complex):**

1. ✅ `get-provider-id` (simplest - 1 positional arg)
2. ✅ `check-publisher-eth` (no args, just setup)
3. ✅ `add-keys` (1 positional + 1 flag)
4. ✅ `generate-scraper-config` (1 optional flag)
5. ✅ `scrape-coinbases` (multiple flags with types)
6. ✅ `scrape-attester-status` (most complex - multiple boolean flags + array flag)

---

#### 3.2.1 Command: `get-provider-id`

**Before (lines 224-241):**

```typescript
case "get-provider-id": {
  const adminAddress = args[1];
  if (!adminAddress) {
    console.error("❌ Error: Admin address required");
    console.error("Usage: npm run cli -- get-provider-id <admin-address>");
    process.exit(1);
  }
  await command.getProviderId(ethClient, { adminAddress });
  break;
}
```

**After:**

```typescript
program
  .command("get-provider-id <admin-address>")
  .description("Get staking provider ID for an admin address")
  .action(async (adminAddress: string) => {
    const config = await initConfig();
    const ethClient = await initEthClient(config);
    await command.getProviderId(ethClient, { adminAddress });
  });
```

**Benefits:**

- Automatic validation of required `admin-address`
- Auto-generated help text
- Type-safe `adminAddress` parameter
- No manual `args[1]` indexing

---

#### 3.2.2 Command: `check-publisher-eth`

**Before (lines 269-284):**

```typescript
case "check-publisher-eth": {
  const keystorePaths = await glob("keystores/**/*.json", {
    cwd: process.cwd(),
    absolute: true,
  });
  if (keystorePaths.length === 0) {
    console.error("❌ No keystore files found in ./keystores/");
    process.exit(1);
  }
  await command.getPublisherEth(ethClient, { keystorePaths });
  break;
}
```

**After:**

```typescript
program
  .command("check-publisher-eth")
  .description("Check publisher ETH balances")
  .action(async () => {
    const config = await initConfig();
    const ethClient = await initEthClient(config);

    const keystorePaths = await glob("keystores/**/*.json", {
      cwd: process.cwd(),
      absolute: true,
    });

    if (keystorePaths.length === 0) {
      console.error("❌ No keystore files found in ./keystores/");
      process.exit(1);
    }

    await command.getPublisherEth(ethClient, { keystorePaths });
  });
```

---

#### 3.2.3 Command: `add-keys`

**Before (lines 243-267):**

```typescript
case "add-keys": {
  const keystorePath = args[1];
  const updateConfig = args.includes("--update-config");

  if (!keystorePath) {
    console.error("❌ Error: Keystore path required");
    console.error("Usage: npm run cli -- add-keys <keystore-path> [--update-config]");
    process.exit(1);
  }

  await command.getAddKeysToStakingProviderCalldata(ethClient, config, {
    keystorePath,
    network: config.NETWORK,
    updateConfig,
  });
  break;
}
```

**After:**

```typescript
program
  .command("add-keys <keystore-path>")
  .description("Generate calldata to add keys to staking provider")
  .option("--update-config", "Update scraper config with new keys", false)
  .action(async (keystorePath: string, options: { updateConfig: boolean }) => {
    const config = await initConfig();
    const ethClient = await initEthClient(config);

    await command.getAddKeysToStakingProviderCalldata(ethClient, config, {
      keystorePath,
      network: config.NETWORK,
      updateConfig: options.updateConfig,
    });
  });
```

**Benefits:**

- Automatic required argument validation
- Default value for `--update-config` (false)
- Type-safe `options` object

---

#### 3.2.4 Command: `generate-scraper-config`

**Before (lines 133-160):**

```typescript
case "generate-scraper-config": {
  const keystorePaths = await glob("keystores/**/*.json", {
    cwd: process.cwd(),
    absolute: true,
  });

  if (keystorePaths.length === 0) {
    console.error("❌ No keystore files found in ./keystores/");
    process.exit(1);
  }

  const providerIdIndex = args.indexOf("--provider-id");
  const providerIdArg = args[providerIdIndex + 1];
  const providerId = providerIdIndex !== -1 && providerIdArg ? BigInt(providerIdArg) : undefined;

  await command.generateScraperConfig(ethClient, config, {
    network: config.NETWORK,
    l1ChainId: config.ETHEREUM_CHAIN_ID,
    keystorePaths,
    includeZeroCoinbases: true,
    ...(providerId !== undefined ? { providerId } : {}),
  });
  break;
}
```

**After:**

```typescript
program
  .command("generate-scraper-config")
  .description("Generate scraper configuration from keystores")
  .option("--provider-id <id>", "Staking provider ID", parseBigInt)
  .action(async (options: { providerId?: bigint }) => {
    const config = await initConfig();
    const ethClient = await initEthClient(config);

    const keystorePaths = await glob("keystores/**/*.json", {
      cwd: process.cwd(),
      absolute: true,
    });

    if (keystorePaths.length === 0) {
      console.error("❌ No keystore files found in ./keystores/");
      process.exit(1);
    }

    await command.generateScraperConfig(ethClient, config, {
      network: config.NETWORK,
      l1ChainId: config.ETHEREUM_CHAIN_ID,
      keystorePaths,
      includeZeroCoinbases: true,
      ...(options.providerId !== undefined
        ? { providerId: options.providerId }
        : {}),
    });
  });
```

**Benefits:**

- Automatic BigInt parsing with `parseBigInt` helper
- No manual `indexOf` + conditional logic
- Cleaner optional parameter handling

---

#### 3.2.5 Command: `scrape-coinbases`

**Before (lines 162-196):**

```typescript
case "scrape-coinbases": {
  const keystorePaths = await glob("keystores/**/*.json", {
    cwd: process.cwd(),
    absolute: true,
  });

  if (keystorePaths.length === 0) {
    console.error("❌ No keystore files found in ./keystores/");
    process.exit(1);
  }

  const fullRescrape = args.includes("--full");
  const fromBlockIndex = args.indexOf("--from-block");
  const fromBlockArg = args[fromBlockIndex + 1];
  const fromBlock = fromBlockIndex !== -1 && fromBlockArg ? BigInt(fromBlockArg) : undefined;
  const providerIdIndex = args.indexOf("--provider-id");
  const providerIdArg = args[providerIdIndex + 1];
  const providerId = providerIdIndex !== -1 && providerIdArg ? BigInt(providerIdArg) : undefined;

  await command.scrapeCoinbases(ethClient, config, {
    network: config.NETWORK,
    keystorePaths,
    fullRescrape,
    ...(fromBlock !== undefined ? { fromBlock } : {}),
    ...(providerId !== undefined ? { providerId } : {}),
  });
  break;
}
```

**After:**

```typescript
program
  .command("scrape-coinbases")
  .description("Scrape coinbase addresses from chain")
  .option("--full", "Perform full rescrape from deployment block", false)
  .option(
    "--from-block <block>",
    "Start from specific block number",
    parseBigInt,
  )
  .option("--provider-id <id>", "Staking provider ID", parseBigInt)
  .action(
    async (options: {
      full: boolean;
      fromBlock?: bigint;
      providerId?: bigint;
    }) => {
      const config = await initConfig();
      const ethClient = await initEthClient(config);

      const keystorePaths = await glob("keystores/**/*.json", {
        cwd: process.cwd(),
        absolute: true,
      });

      if (keystorePaths.length === 0) {
        console.error("❌ No keystore files found in ./keystores/");
        process.exit(1);
      }

      await command.scrapeCoinbases(ethClient, config, {
        network: config.NETWORK,
        keystorePaths,
        fullRescrape: options.full,
        ...(options.fromBlock !== undefined
          ? { fromBlock: options.fromBlock }
          : {}),
        ...(options.providerId !== undefined
          ? { providerId: options.providerId }
          : {}),
      });
    },
  );
```

**Benefits:**

- No manual `indexOf` + conditional chains (3 eliminated)
- Type-safe options object with proper types
- Default value for `--full` flag
- Automatic BigInt parsing

---

#### 3.2.6 Command: `scrape-attester-status` (Most Complex)

**Before (lines 198-222):**

```typescript
case "scrape-attester-status": {
  const allActive = args.includes("--all-active");
  const allQueued = args.includes("--all-queued");
  const active = args.includes("--active");
  const queued = args.includes("--queued");

  const addresses: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--address" && args[i + 1]) {
      addresses.push(args[i + 1]!);
    }
  }

  await command.scrapeAttesterStatus(ethClient, {
    allActive,
    allQueued,
    active,
    queued,
    network: config.NETWORK,
    ...(addresses.length > 0 ? { addresses } : {}),
  });
  break;
}
```

**After:**

```typescript
program
  .command("scrape-attester-status")
  .description("Scrape attester on-chain status (defaults to config attesters)")
  .option("--active", "Check active attesters from config", false)
  .option("--queued", "Check queued attesters from config", false)
  .option("--all-active", "Check all active attesters on-chain", false)
  .option("--all-queued", "Check all queued attesters on-chain", false)
  .option(
    "--address <address>",
    "Specific attester address to check (can be repeated)",
    collect,
    [],
  )
  .action(
    async (options: {
      active: boolean;
      queued: boolean;
      allActive: boolean;
      allQueued: boolean;
      address: string[];
    }) => {
      const config = await initConfig();
      const ethClient = await initEthClient(config);

      await command.scrapeAttesterStatus(ethClient, {
        allActive: options.allActive,
        allQueued: options.allQueued,
        active: options.active,
        queued: options.queued,
        network: config.NETWORK,
        ...(options.address.length > 0 ? { addresses: options.address } : {}),
      });
    },
  );
```

**Benefits:**

- Eliminates manual loop for `--address` collection (uses `collect` helper)
- All 4 boolean flags have default values
- Type-safe with proper array type for addresses
- Self-documenting with "(can be repeated)" in description

---

#### 3.3 Extract Client Initialization (30 min)

**Create helper function to reduce duplication:**

```typescript
// At top of cli.ts after imports
async function initEthClient(config: ButlerConfig): Promise<EthereumClient> {
  // Initialize Aztec client
  const aztecClient = new AztecClient({
    nodeUrl: config.AZTEC_NODE_URL,
  });
  const nodeInfo = await aztecClient.getNodeInfo();

  // Initialize Ethereum client
  const ethClient = new EthereumClient({
    rpcUrl: config.ETHEREUM_NODE_URL,
    ...(config.ETHEREUM_ARCHIVE_NODE_URL
      ? { archiveRpcUrl: config.ETHEREUM_ARCHIVE_NODE_URL }
      : {}),
    chainId: nodeInfo.l1ChainId,
    rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress.toString(),
  });

  await ethClient.verifyChainId();
  return ethClient;
}
```

**Use in every command action:**

```typescript
.action(async (args...) => {
  const config = await initConfig();
  const ethClient = await initEthClient(config);
  // ... rest of command
});
```

**Benefits:**

- Reduces duplication (currently lines 112-130 repeated implicitly)
- Centralizes client setup logic
- Easier to modify initialization in future

---

#### 3.4 Remove Old Code (30 min)

**Delete:**

- Lines 55-108: Manual help text (replaced by Commander's auto-help)
- Lines 132-291: Entire switch statement
- Lines 14-15: Manual arg parsing

**Keep:**

- Lines 1-13: Imports and formatError function
- Lines 294-298: Main error handler (integrate with Commander)

**New main flow:**

```typescript
// After all program.command() definitions
program.parseAsync(process.argv).catch((error) => {
  console.error("❌ Error:\n");
  console.error(formatError(error));
  process.exit(1);
});
```

---

### Phase 4: Testing (1 hour)

**📋 Quick Reference:** See `MIGRATION-TEST-CHECKLIST.md` for a printable testing checklist.

#### 4.1 Manual Testing Checklist

Test each command with all flag combinations:

**`get-provider-id`:**

- ✅ `npm run cli -- get-provider-id <valid-address>`
- ✅ `npm run cli -- get-provider-id` (should error: missing argument)
- ✅ `npm run cli -- get-provider-id --help`

**`check-publisher-eth`:**

- ✅ `npm run cli -- check-publisher-eth`
- ✅ `npm run cli -- check-publisher-eth --help`

**`add-keys`:**

- ✅ `npm run cli -- add-keys keystores/examples/key1.json`
- ✅ `npm run cli -- add-keys keystores/examples/key1.json --update-config`
- ✅ `npm run cli -- add-keys` (should error: missing argument)
- ✅ `npm run cli -- add-keys --help`

**`generate-scraper-config`:**

- ✅ `npm run cli -- generate-scraper-config`
- ✅ `npm run cli -- generate-scraper-config --provider-id 123`
- ✅ `npm run cli -- generate-scraper-config --provider-id invalid` (should error)
- ✅ `npm run cli -- generate-scraper-config --help`

**`scrape-coinbases`:**

- ✅ `npm run cli -- scrape-coinbases`
- ✅ `npm run cli -- scrape-coinbases --full`
- ✅ `npm run cli -- scrape-coinbases --from-block 12345678`
- ✅ `npm run cli -- scrape-coinbases --provider-id 123`
- ✅ `npm run cli -- scrape-coinbases --full --provider-id 123`
- ✅ `npm run cli -- scrape-coinbases --from-block 12345 --provider-id 123`
- ✅ `npm run cli -- scrape-coinbases --help`

**`scrape-attester-status`:**

- ✅ `npm run cli -- scrape-attester-status`
- ✅ `npm run cli -- scrape-attester-status --active`
- ✅ `npm run cli -- scrape-attester-status --queued`
- ✅ `npm run cli -- scrape-attester-status --active --queued`
- ✅ `npm run cli -- scrape-attester-status --all-active`
- ✅ `npm run cli -- scrape-attester-status --all-queued`
- ✅ `npm run cli -- scrape-attester-status --address 0x123...`
- ✅ `npm run cli -- scrape-attester-status --address 0x123... --address 0x456...`
- ✅ `npm run cli -- scrape-attester-status --help`

**Server mode:**

- ✅ `npm run dev:serve`
- ✅ `npm start` (after build)
- ✅ `node dist/index.js serve`
- ✅ `node dist/index.js --help`

**General:**

- ✅ `npm run cli -- help` or `npm run cli -- --help`
- ✅ `npm run cli -- unknown-command` (should show error + available commands)

---

#### 4.2 Regression Testing: Shell Scripts

**CRITICAL: All scripts in `scripts/` directory must continue to work after migration.**

These scripts are wrapper scripts that call the CLI commands. Verify each one:

**`./scripts/add-keys.sh <keystore-file> [--update-config]`**

- Calls: `npm run cli -- add-keys`
- Test: `./scripts/add-keys.sh keystores/examples/key1.json`
- Test: `./scripts/add-keys.sh keystores/examples/key1.json --update-config`
- Validates: Positional argument + optional flag handling

**`./scripts/check-publisher-eth.sh`**

- Calls: `npm run cli -- check-publisher-eth`
- Test: `./scripts/check-publisher-eth.sh`
- Validates: No-argument command execution

**`./scripts/generate-scraper-config.sh [--provider-id <id>]`**

- Calls: `npm run cli -- generate-scraper-config`
- Test: `./scripts/generate-scraper-config.sh`
- Test: `./scripts/generate-scraper-config.sh --provider-id 123`
- Validates: Optional flag with BigInt parsing

**`./scripts/get-provider-id.sh <admin-address>`**

- Calls: `npm run cli -- get-provider-id`
- Test: `./scripts/get-provider-id.sh 0x1234567890abcdef1234567890abcdef12345678`
- Validates: Required positional argument

**`./scripts/scrape-attester-status.sh [flags]`**

- Calls: `npm run cli -- scrape-attester-status`
- Test: `./scripts/scrape-attester-status.sh`
- Test: `./scripts/scrape-attester-status.sh --active`
- Test: `./scripts/scrape-attester-status.sh --active --queued`
- Test: `./scripts/scrape-attester-status.sh --all-active`
- Test: `./scripts/scrape-attester-status.sh --address 0x123...`
- Test: `./scripts/scrape-attester-status.sh --address 0x123... --address 0x456...`
- Validates: Multiple boolean flags + repeatable array flag

**`./scripts/scrape-coinbases.sh [flags]`**

- Calls: `npm run cli -- scrape-coinbases`
- Test: `./scripts/scrape-coinbases.sh`
- Test: `./scripts/scrape-coinbases.sh --full`
- Test: `./scripts/scrape-coinbases.sh --from-block 12345678`
- Test: `./scripts/scrape-coinbases.sh --provider-id 123`
- Test: `./scripts/scrape-coinbases.sh --full --provider-id 123`
- Validates: Multiple optional flags with different types

**`./scripts/start-server.sh`**

- Calls: `npm run dev:serve` or `npm start`
- Test: `./scripts/start-server.sh` (then Ctrl+C)
- Validates: Server mode entry point

**Testing Strategy:**

1. Create a test checklist from above
2. Run each script with sample/test data (not production)
3. Verify output format matches current behavior
4. Check error messages are still clear
5. Ensure exit codes are correct (0 for success, 1 for errors)

**Why This Matters:**

- These scripts may be used in automation/cron jobs
- Breaking them could disrupt production workflows
- They represent the real-world usage patterns

---

#### 4.3 Help Text Validation

**Compare old vs new help output:**

1. Run `npm run cli -- help` with current implementation, save output
2. Run `npm run cli -- help` with Commander, compare
3. Ensure all commands are documented
4. Ensure all options are documented
5. Verify examples are still clear (add with `.addHelpText()` if needed)

---

### Phase 5: Documentation Updates (30 min)

#### 5.1 Update README.md

**Section to update:** CLI usage examples

**Add note about new help system:**

```markdown
## CLI Commands

Use `npm run cli -- <command> --help` to see detailed help for any command.

### Available Commands

Run `npm run cli -- --help` to see all available commands.

### Examples

...existing examples...
```

#### 5.2 Update package.json scripts (if needed)

No changes needed - `npm run cli` script already uses `cli.ts`

---

## File Structure After Migration

```
src/
├── cli/
│   ├── commands/            (unchanged - command implementations)
│   │   ├── add-keys.ts
│   │   ├── check-publisher-eth.ts
│   │   ├── generate-scraper-config.ts
│   │   ├── get-provider-id.ts
│   │   ├── scrape-attester-status.ts
│   │   ├── scrape-coinbases.ts
│   │   └── index.ts
│   └── utils/               (NEW - Commander helpers)
│       └── commander-helpers.ts  (optional - for shared utilities)
├── core/                    (unchanged)
├── server/                  (unchanged)
├── types/                   (unchanged)
└── index.ts                 (MODIFIED - uses Commander)
cli.ts                       (MODIFIED - uses Commander)
package.json                 (MODIFIED - add commander dependency)
```

---

## Code Comparison: Before vs After

### Before: `cli.ts` (299 lines)

```typescript
// Lines 14-53: Manual parsing setup + formatError
const args = process.argv.slice(2);
const commandName = args[0];

function formatError(error: unknown): string { ... }

// Lines 55-108: 54 lines of hardcoded help text
if (!commandName || commandName === "help") {
  console.log("Aztec Butler CLI");
  console.log("Usage: npm run cli -- <command> [options]");
  // ... 50 more lines
}

// Lines 111-130: Client initialization (repeated per command)
const config = await initConfig();
const aztecClient = new AztecClient({ ... });
const nodeInfo = await aztecClient.getNodeInfo();
const ethClient = new EthereumClient({ ... });
await ethClient.verifyChainId();

// Lines 132-291: 160 lines of switch-case command routing
switch (commandName) {
  case "generate-scraper-config": {
    // 28 lines including manual arg parsing
    const providerIdIndex = args.indexOf("--provider-id");
    const providerIdArg = args[providerIdIndex + 1];
    const providerId = providerIdIndex !== -1 && providerIdArg ? BigInt(providerIdArg) : undefined;
    // ... repeat for each command
  }
  // ... 5 more cases
}

// Lines 294-298: Error handler
main().catch((error) => { ... });
```

### After: `cli.ts` (estimated ~150-180 lines)

```typescript
// Lines 1-20: Imports + helpers
import { Command } from 'commander';

function formatError(error: unknown): string { ... }
function parseBigInt(value: string): bigint { return BigInt(value); }
function collect(value: string, prev: string[]): string[] { return prev.concat([value]); }

async function initEthClient(config: ButlerConfig): Promise<EthereumClient> { ... }

// Lines 21-35: Program setup
const program = new Command();
program
  .name('aztec-butler-cli')
  .description('Aztec Butler CLI')
  .version('2.0.0');

// Lines 36-160: Command definitions (6 commands × ~20 lines each)
program
  .command('generate-scraper-config')
  .description('Generate scraper configuration from keystores')
  .option('--provider-id <id>', 'Staking provider ID', parseBigInt)
  .action(async (options) => {
    const config = await initConfig();
    const ethClient = await initEthClient(config);
    // ... command logic (no manual parsing!)
  });

// ... 5 more commands (each ~15-25 lines)

// Lines 161-165: Parse and error handling
program.parseAsync(process.argv).catch((error) => {
  console.error("❌ Error:\n");
  console.error(formatError(error));
  process.exit(1);
});
```

**Key differences:**

- ❌ No manual `args.indexOf()` chains
- ❌ No hardcoded help text
- ❌ No switch statement
- ✅ Declarative command/option definitions
- ✅ Type-safe action handlers
- ✅ Auto-generated help
- ✅ Reusable client initialization

---

## Rollback Plan

If migration fails or causes issues:

1. **Revert commits:**

   ```bash
   git revert <migration-commit-hash>
   ```

2. **Quick fix strategy:**
   - Keep Commander installed
   - Temporarily add back manual parsing for broken commands
   - Fix incrementally

3. **Nuclear option:**
   ```bash
   npm uninstall commander @types/commander
   git checkout cli.ts src/index.ts
   ```

**Risk mitigation:**

- Commit each command migration separately
- Tag known-good state before starting
- Keep manual testing checklist for quick validation

---

## Future Enhancements (Post-Migration)

Once Commander is integrated, these become easier:

1. **Global options:**

   ```typescript
   program
     .option("-v, --verbose", "Verbose output")
     .option("--dry-run", "Simulate without executing");
   ```

2. **Subcommands:**

   ```typescript
   program.command("scraper").command("config").command("provider");
   ```

3. **Interactive prompts:**

   ```typescript
   // Can add inquirer.js for interactive mode
   .option('--interactive', 'Interactive mode');
   ```

4. **Shell completion:**

   ```typescript
   // Commander supports shell completion generation
   program.configureOutput({ ... });
   ```

5. **Config file support:**
   ```typescript
   .option('-c, --config <path>', 'Config file path');
   ```

---

## Success Criteria

Migration is complete when:

- ✅ All 6 CLI commands work with identical functionality
- ✅ Server mode (`npm run dev:serve`) works
- ✅ Help text is auto-generated and accurate
- ✅ All manual tests pass
- ✅ All existing shell scripts work
- ✅ Code is ~100-150 lines shorter
- ✅ No regression in error handling
- ✅ TypeScript compilation succeeds
- ✅ Documentation is updated

---

## Timeline

| Phase                        | Duration    | Deliverable                          |
| ---------------------------- | ----------- | ------------------------------------ |
| 1. Setup                     | 30 min      | Commander installed, helpers created |
| 2. Migrate `src/index.ts`    | 1 hour      | Server mode uses Commander           |
| 3. Migrate `cli.ts` commands | 3-4 hours   | All 6 commands migrated              |
| 4. Testing                   | 1 hour      | All manual tests pass                |
| 5. Documentation             | 30 min      | README updated                       |
| **Total**                    | **6 hours** | **Fully migrated CLI**               |

---

## Questions & Decisions

### Decision 1: Keep `cli.ts` separate or merge with `src/index.ts`?

**Option A:** Keep separate (recommended)

- Pro: Clear separation of concerns
- Pro: CLI can be used independently
- Con: Two entry points

**Option B:** Merge into single entry point

- Pro: Single binary
- Pro: Can share Commander program
- Con: Mixing server and CLI concerns

**Recommendation:** Keep separate for now, can merge later if needed.

### Decision 2: Create `commander-helpers.ts` or inline helpers?

**Option A:** Separate helpers file

- Pro: Reusable across commands
- Pro: Easier to test
- Con: Extra file

**Option B:** Inline in `cli.ts`

- Pro: Everything in one place
- Con: Harder to test

**Recommendation:** Create helpers file if ≥3 commands use the same helper (e.g., `parseBigInt`, `collect`).

### Decision 3: Add TypeScript types for Commander options?

**Option A:** Explicit interfaces

```typescript
interface ScrapeCoinbasesOptions {
  full: boolean;
  fromBlock?: bigint;
  providerId?: bigint;
}

.action(async (options: ScrapeCoinbasesOptions) => { ... });
```

**Option B:** Inline types

```typescript
.action(async (options: { full: boolean; fromBlock?: bigint; ... }) => { ... });
```

**Recommendation:** Option A (explicit interfaces) for commands with ≥3 options, inline for simpler commands.

---

## Appendix A: Commander Patterns

### Pattern 1: Optional BigInt argument

```typescript
.option('--provider-id <id>', 'Provider ID', parseBigInt)
// parseBigInt defined at top: (value: string) => BigInt(value)
```

### Pattern 2: Boolean flag with default

```typescript
.option('--full', 'Full rescrape', false)
// Third argument is default value
```

### Pattern 3: Multiple values for same flag

```typescript
.option('--address <address>', 'Attester address (can be repeated)', collect, [])
// collect defined as: (value: string, prev: string[]) => prev.concat([value])
// Fourth argument is initial value
```

### Pattern 4: Required positional argument

```typescript
.command('add-keys <keystore-path>')
// Angle brackets = required
```

### Pattern 5: Optional positional argument

```typescript
.command('some-command [optional-arg]')
// Square brackets = optional
```

### Pattern 6: Variadic arguments

```typescript
.command('some-command <files...>')
// Ellipsis = multiple values
```

---

## Appendix B: Commander vs Yargs

| Feature            | Commander | Yargs        |
| ------------------ | --------- | ------------ |
| Bundle size        | ~140KB    | ~290KB       |
| API complexity     | Simple    | More complex |
| TypeScript support | Good      | Good         |
| Subcommands        | Native    | Native       |
| Help generation    | Excellent | Excellent    |
| Middleware         | No        | Yes          |
| Validation         | Basic     | Advanced     |
| Coercion           | Manual    | Built-in     |

**Recommendation for this project:** Commander

- Simpler API matches your straightforward CLI needs
- Smaller bundle size
- Sufficient features (no need for yargs' advanced validation)
- Better for pure CLI tools (yargs is overkill)

---

## Appendix C: Testing Strategy Detail

### Unit Test Ideas (Future)

If you add unit tests later, Commander makes it easier:

```typescript
// cli.test.ts
import { program } from "./cli";

describe("CLI", () => {
  it("should parse provider-id as BigInt", async () => {
    await program.parseAsync([
      "node",
      "cli",
      "generate-scraper-config",
      "--provider-id",
      "123",
    ]);
    // Assert command was called with providerId: 123n
  });
});
```

### Integration Test Ideas

```typescript
// test-cli-commands.ts (enhance existing)
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

describe("CLI Integration", () => {
  it("should show help for unknown command", async () => {
    const { stdout } = await execAsync("npm run cli -- unknown-command");
    expect(stdout).toContain("Unknown command");
  });
});
```

---

## Appendix D: Migration Checklist

Copy this to track progress:

### Setup

- [ ] Install `commander` and `@types/commander`
- [ ] Create `src/cli/utils/commander-helpers.ts` (if needed)
- [ ] Add `parseBigInt`, `collect` helpers

### Migrate `src/index.ts`

- [ ] Replace mode switch with Commander
- [ ] Test `npm run dev:serve`
- [ ] Test `npm start`
- [ ] Commit: "Migrate src/index.ts to Commander"

### Migrate `cli.ts` Commands

- [ ] Setup base program structure
- [ ] Extract `initEthClient()` helper
- [ ] Migrate `get-provider-id`
- [ ] Migrate `check-publisher-eth`
- [ ] Migrate `add-keys`
- [ ] Migrate `generate-scraper-config`
- [ ] Migrate `scrape-coinbases`
- [ ] Migrate `scrape-attester-status`
- [ ] Remove old switch statement
- [ ] Remove manual help text
- [ ] Commit: "Migrate cli.ts to Commander"

### Testing

**Direct CLI Testing:**

- [ ] Test all commands manually (see checklist in Phase 4.1)
- [ ] Compare help text old vs new
- [ ] Verify error messages

**Shell Scripts Regression Testing (CRITICAL):**

- [ ] Test `./scripts/add-keys.sh <keystore>` (positional arg)
- [ ] Test `./scripts/add-keys.sh <keystore> --update-config` (with flag)
- [ ] Test `./scripts/check-publisher-eth.sh` (no args)
- [ ] Test `./scripts/generate-scraper-config.sh` (no args)
- [ ] Test `./scripts/generate-scraper-config.sh --provider-id 123` (with flag)
- [ ] Test `./scripts/get-provider-id.sh <address>` (positional arg)
- [ ] Test `./scripts/scrape-attester-status.sh` (no args)
- [ ] Test `./scripts/scrape-attester-status.sh --active` (boolean flag)
- [ ] Test `./scripts/scrape-attester-status.sh --active --queued` (multi-flag)
- [ ] Test `./scripts/scrape-attester-status.sh --all-active` (boolean flag)
- [ ] Test `./scripts/scrape-attester-status.sh --address 0x123...` (single address)
- [ ] Test `./scripts/scrape-attester-status.sh --address 0x1... --address 0x2...` (multi-address)
- [ ] Test `./scripts/scrape-coinbases.sh` (no args)
- [ ] Test `./scripts/scrape-coinbases.sh --full` (boolean flag)
- [ ] Test `./scripts/scrape-coinbases.sh --from-block 12345` (BigInt flag)
- [ ] Test `./scripts/scrape-coinbases.sh --provider-id 123` (BigInt flag)
- [ ] Test `./scripts/scrape-coinbases.sh --full --provider-id 123` (multi-flag)
- [ ] Test `./scripts/start-server.sh` (server mode)
- [ ] Verify all scripts exit correctly (code 0 on success, 1 on error)
- [ ] Commit: "Verify CLI migration complete"

### Documentation

- [ ] Update README.md
- [ ] Update any other docs mentioning CLI
- [ ] Commit: "Update docs for Commander CLI"

### Cleanup

- [ ] Remove any unused imports
- [ ] Run `npm run lint`
- [ ] Run `npm run type-check`
- [ ] Final commit: "Clean up after Commander migration"

---

## Conclusion

This migration will:

- **Save ~100-150 lines of boilerplate code**
- **Eliminate manual argument parsing bugs**
- **Provide auto-generated, always-accurate help text**
- **Make adding new commands 60-70% faster**
- **Improve type safety and developer experience**

**Estimated effort:** 4-6 hours  
**Risk:** Low (can rollback easily)  
**Value:** High (long-term maintainability win)

**Recommendation:** Proceed with migration ✅

---

## Quick Start

When ready to begin migration:

1. **Read this plan** to understand the full scope
2. **Print/open `MIGRATION-TEST-CHECKLIST.md`** for testing reference
3. **Create a git branch:** `git checkout -b migrate-to-commander`
4. **Follow the phases** in order (Setup → src/index.ts → cli.ts → Testing → Docs)
5. **Test thoroughly** using the checklist, especially the shell scripts
6. **Commit frequently** to enable easy rollback if needed

**Most important:** Validate all shell scripts in `scripts/` directory work correctly. These are used in production!
