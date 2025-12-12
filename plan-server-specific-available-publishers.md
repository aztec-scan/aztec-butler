# Plan: Server-Specific Available Publishers

## Overview

Modify the `prepare-deployment` command to require `available_publisher_addresses.json` to be structured as an object with server-specific arrays (e.g., `{A: [], B: [], ...}`) instead of a flat array. This ensures:

1. Publisher addresses are explicitly assigned to specific servers
2. No publisher address can be deployed to multiple servers accidentally
3. The same addresses are consistently used for the same server across deployments
4. When running without high availability, default to using server "A"

## Current State

**File:** `src/cli/commands/prepare-deployment.ts:99-115`

Currently loads `available_publisher_addresses.json` as a flat array:

```typescript
let availablePublishers: string[];
try {
  const content = await fs.readFile(options.availablePublishers, "utf-8");
  availablePublishers = JSON.parse(content);
} catch (error) {
  throw new Error(
    `Failed to load available publishers file: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (!Array.isArray(availablePublishers)) {
  throw new Error(
    "Invalid available publishers file: must be a JSON array of addresses",
  );
}
```

## Target State

### New File Format

**Before (current):**

```json
["0x1234...", "0x5678...", "0x9abc..."]
```

**After (new):**

```json
{
  "A": ["0x1111...", "0x2222...", "0x3333..."],
  "B": ["0x4444...", "0x5555...", "0x6666..."],
  "C": ["0x7777...", "0x8888..."]
}
```

### Behavior Changes

1. **Default (no HA):** Use publishers from key "A"
   - Creates single file: `[production-keys].new`
   - Uses only publishers from the "A" array

2. **With HA count:** Use corresponding keys for each server
   - `--high-availability-count 3` → Uses keys "A", "B", "C"
   - Creates files: `A_[production-keys].new`, `B_[production-keys].new`, `C_[production-keys].new`
   - File A uses publishers from "A" array
   - File B uses publishers from "B" array
   - File C uses publishers from "C" array

3. **Validation:** Ensure no address appears in multiple server arrays
   - Before any processing, collect all addresses from all server arrays
   - Check for duplicates across arrays
   - Fail with clear error if any address appears in more than one array
   - Fail with clear error if there are more HA-count than there are arrays in available publishers file

## Implementation Plan

### Phase 1: Update Type Definitions

**Location:** `src/cli/commands/prepare-deployment.ts:99-115`

Add new type for server-specific publishers:

```typescript
interface ServerPublishers {
  [server: string]: string[]; // e.g., { A: [...], B: [...] }
}
```

### Phase 2: Modify File Loading and Validation

**Location:** `src/cli/commands/prepare-deployment.ts:99-115`

Replace array loading with object loading:

```typescript
let serverPublishers: ServerPublishers;
try {
  const content = await fs.readFile(options.availablePublishers, "utf-8");
  serverPublishers = JSON.parse(content);
} catch (error) {
  throw new Error(
    `Failed to load available publishers file: ${error instanceof Error ? error.message : String(error)}`,
  );
}

// Validate structure
if (
  typeof serverPublishers !== "object" ||
  Array.isArray(serverPublishers) ||
  serverPublishers === null
) {
  throw new Error(
    "Invalid available publishers file: must be a JSON object with server keys (e.g., {A: [], B: []})",
  );
}

// Validate all values are arrays
for (const [server, publishers] of Object.entries(serverPublishers)) {
  if (!Array.isArray(publishers)) {
    throw new Error(
      `Invalid available publishers file: server "${server}" must have an array of addresses`,
    );
  }
}

console.log(
  `✅ Loaded publishers for server(s): ${Object.keys(serverPublishers).join(", ")}`,
);
```

### Phase 3: Add Cross-Server Duplicate Validation

**Location:** After file loading (around line 115)

Add validation to ensure no publisher appears in multiple server arrays:

```typescript
// Validate no publisher addresses are shared between servers
console.log("\nValidating publisher assignments across servers...");

const publisherToServers = new Map<string, string[]>();

for (const [server, publishers] of Object.entries(serverPublishers)) {
  for (const publisher of publishers) {
    const normalizedAddr = publisher.toLowerCase();
    if (!publisherToServers.has(normalizedAddr)) {
      publisherToServers.set(normalizedAddr, []);
    }
    publisherToServers.get(normalizedAddr)!.push(server);
  }
}

const sharedPublishers = Array.from(publisherToServers.entries())
  .filter(([, servers]) => servers.length > 1)
  .map(([addr, servers]) => ({ address: addr, servers }));

if (sharedPublishers.length > 0) {
  const errorMsg = sharedPublishers
    .map(
      ({ address, servers }) =>
        `  - ${address} appears in servers: ${servers.join(", ")}`,
    )
    .join("\n");

  throw new Error(
    `FATAL: Publisher addresses cannot be shared between servers:\n${errorMsg}\n\n` +
      `Each server must have its own unique set of publisher addresses.`,
  );
}

console.log("✅ No publisher addresses shared between servers");
```

### Phase 4: Update Default Server Selection

**Location:** Around line 246 (single file output)

Modify to use "A" server by default:

```typescript
if (haCount === 1) {
  // Single file output - use server "A"
  if (!serverPublishers.A) {
    throw new Error(
      `FATAL: Server "A" not found in available publishers file.\n` +
        `When running without high availability, publishers for server "A" are required.`,
    );
  }

  const availablePublishers = serverPublishers.A;

  if (availablePublishers.length === 0) {
    throw new Error(
      `FATAL: Server "A" has no publisher addresses.\n` +
        `At least one publisher address is required for server "A".`,
    );
  }

  let outputFilename = `${outputBasePath}.new`;
  let outputPath = path.join(outputDir, outputFilename);

  // Check if .new exists, create .new2 instead
  try {
    await fs.access(outputPath);
    outputFilename = `${outputBasePath}.new2`;
    outputPath = path.join(outputDir, outputFilename);
    console.log(`  .new file exists, creating ${outputFilename} instead`);
  } catch {
    // File doesn't exist, use .new
  }

  const validatorsWithPublishers = assignPublishers(
    mergedValidators,
    availablePublishers,
  );

  outputFiles.push({
    filename: outputPath,
    data: {
      schemaVersion: productionData.schemaVersion || 1,
      remoteSigner: productionData.remoteSigner,
      validators: validatorsWithPublishers,
    },
  });

  console.log(
    `✅ Using ${availablePublishers.length} publisher(s) from server A`,
  );
}
```

### Phase 5: Update High Availability Mode

**Location:** Around line 274 (HA mode)

Modify to use server-specific publishers:

```typescript
else {
  // High availability mode - use specified server keys
  const prefixes = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").slice(0, haCount);

  // Validate all required servers have publishers
  const missingServers = prefixes.filter(server => !serverPublishers[server] || serverPublishers[server].length === 0);

  if (missingServers.length > 0) {
    throw new Error(
      `FATAL: Missing or empty publisher arrays for server(s): ${missingServers.join(', ')}\n` +
      `High availability count of ${haCount} requires publishers for servers: ${prefixes.join(', ')}`
    );
  }

  for (let i = 0; i < haCount; i++) {
    const prefix = prefixes[i];
    const filePublishers = serverPublishers[prefix]!;

    const outputFilename = `${prefix}_${outputBasePath}.new`;
    const outputPath = path.join(outputDir, outputFilename);

    const validatorsWithPublishers = assignPublishers(
      mergedValidators,
      filePublishers,
    );

    outputFiles.push({
      filename: outputPath,
      data: {
        schemaVersion: productionData.schemaVersion || 1,
        remoteSigner: productionData.remoteSigner,
        validators: validatorsWithPublishers,
      },
    });

    console.log(`  ${outputFilename}: ${filePublishers.length} publisher(s) from server ${prefix}`);
  }
}
```

### Phase 6: Update Publisher Funding Check

**Location:** Around line 164-192

Update to check all publishers from all servers:

```typescript
// 4. Publisher funding check
console.log("\nChecking publisher funding...");

const minEthPerAttester = BigInt(
  Math.floor(parseFloat(config.MIN_ETH_PER_ATTESTER) * 1e18),
);

const publicClient = ethClient.getPublicClient();

// Collect all unique publishers across all servers
const allPublishers = new Set<string>();
for (const publishers of Object.values(serverPublishers)) {
  for (const addr of publishers) {
    allPublishers.add(addr);
  }
}

for (const publisherAddr of allPublishers) {
  const balance = await publicClient.getBalance({
    address: publisherAddr as `0x${string}`,
  });
  const balanceEth = formatEther(balance);

  if (balance === 0n) {
    throw new Error(`FATAL: Publisher ${publisherAddr} has 0 ETH balance!`);
  }

  if (balance < minEthPerAttester) {
    console.warn(
      `⚠️  Publisher ${publisherAddr} has low balance: ${balanceEth} ETH (min: ${config.MIN_ETH_PER_ATTESTER} ETH)`,
    );
  } else {
    console.log(`  ${publisherAddr}: ${balanceEth} ETH ✅`);
  }
}

console.log("✅ All publishers have ETH");
```

### Phase 7: Update HA Validation

**Location:** Around line 194-210

Update validation to check against server-specific structure:

```typescript
// 5. High availability validation
const haCount = options.highAvailabilityCount || 1;

if (haCount > 1) {
  console.log(`\nValidating high availability setup (count: ${haCount})...`);

  const prefixes = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").slice(0, haCount);
  const availableServers = Object.keys(serverPublishers).filter(
    (key) => serverPublishers[key].length > 0,
  );

  if (availableServers.length < haCount) {
    throw new Error(
      `FATAL: Not enough servers configured for high availability.\n` +
        `Need ${haCount} servers (${prefixes.join(", ")}) but only have ${availableServers.length} configured: ${availableServers.join(", ")}`,
    );
  }

  console.log(
    `✅ Sufficient servers configured for ${haCount}-way high availability`,
  );
}
```

### Phase 8: Update Summary Output

**Location:** Around line 392-403

Update summary to show server-specific information:

```typescript
// Summary
console.log("\n=== Summary ===");
console.log(
  `Total validators: ${mergedValidators.length} (${productionData.validators.length} existing + ${newPublicKeysData.validators.length} new)`,
);

// Show publishers per server
console.log(`Servers configured:`);
for (const [server, publishers] of Object.entries(serverPublishers)) {
  console.log(`  - Server ${server}: ${publishers.length} publisher(s)`);
}

console.log(`Output files: ${outputFiles.length}`);
for (const { filename } of outputFiles) {
  console.log(`  - ${filename}`);
}
console.log(`Scraper config: ${savedPath}`);
console.log("\n✅ Deployment preparation complete!");
```

## Testing Plan

### Test 1: Create Test Files

Create test file: `test-server-specific-publishers.json`

```json
{
  "A": [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333"
  ],
  "B": [
    "0x4444444444444444444444444444444444444444",
    "0x5555555555555555555555555555555555555555"
  ],
  "C": ["0x6666666666666666666666666666666666666666"]
}
```

### Test 2: Default Mode (Server A)

```bash
npm run cli -- prepare-deployment \
  --production-keys test-prod-keys.json \
  --new-public-keys test-new-public-keys.json \
  --available-publishers test-server-specific-publishers.json
```

**Expected:**

- ✅ Uses only publishers from server "A"
- ✅ Creates single file: `test-prod-keys.new`
- ✅ Validators use publishers: 0x1111..., 0x2222..., 0x3333... in round-robin

### Test 3: High Availability Mode

```bash
npm run cli -- prepare-deployment \
  --production-keys test-prod-keys.json \
  --new-public-keys test-new-public-keys.json \
  --available-publishers test-server-specific-publishers.json \
  --high-availability-count 3
```

**Expected:**

- ✅ Creates 3 files: `A_test-prod-keys.new`, `B_test-prod-keys.new`, `C_test-prod-keys.new`
- ✅ File A uses publishers from A array
- ✅ File B uses publishers from B array
- ✅ File C uses publishers from C array
- ✅ All files have same validators, different publishers

### Test 4: Duplicate Detection

Create test file with duplicates: `test-duplicate-publishers.json`

```json
{
  "A": [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222"
  ],
  "B": [
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333"
  ]
}
```

**Expected:**

- ❌ Fails with error: "Publisher addresses cannot be shared between servers"
- ❌ Shows: "0x2222... appears in servers: A, B"

### Test 5: Missing Server A

Create test file: `test-no-server-a.json`

```json
{
  "B": ["0x1111111111111111111111111111111111111111"],
  "C": ["0x2222222222222222222222222222222222222222"]
}
```

**Expected:**

- ❌ Fails with error: 'Server "A" not found in available publishers file'

### Test 6: Invalid File Format (Old Format)

Use old format: `["0x1111...", "0x2222..."]`

**Expected:**

- ❌ Fails with error: "must be a JSON object with server keys"

### Test 7: HA Count Exceeds Available Servers

```bash
npm run cli -- prepare-deployment \
  --production-keys test-prod-keys.json \
  --new-public-keys test-new-public-keys.json \
  --available-publishers test-server-specific-publishers.json \
  --high-availability-count 5
```

(File only has A, B, C)

**Expected:**

- ❌ Fails with error: "Need 5 servers (A, B, C, D, E) but only have 3 configured"

## Migration Guide for Users

### For Operators

**Old workflow:**

```bash
# Old file format
echo '["0x1111...", "0x2222...", ...]' > available_publishers.json
```

**New workflow:**

```bash
# New file format - organize by server
cat > available_publisher_addresses.json <<EOF
{
  "A": [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222"
  ],
  "B": [
    "0x3333333333333333333333333333333333333333",
    "0x4444444444444444444444444444444444444444"
  ]
}
EOF
```

**Benefits:**

1. Clear assignment of which publishers go to which server
2. Prevents accidental reuse of publishers across servers
3. Consistent deployments - same server always gets same addresses
4. Easier to audit and maintain

## Edge Cases to Handle

1. **Empty server array:**
   - If server "A" has `[]`, should fail
   - If server "B" has `[]` but HA count is 1, should succeed (doesn't use B)

2. **Extra servers defined:**
   - If file has A, B, C, D but HA count is 2, should succeed (only uses A, B)

3. **Non-uppercase keys:**
   - Should we support `{"a": [...]}` or enforce uppercase?
   - **Decision:** Enforce uppercase A, B, C... for consistency

4. **Non-alphabetic keys:**
   - Should we support `{"server1": [...]}` or only A, B, C?
   - **Decision:** Only support A, B, C... to match HA file naming convention

## Backward Compatibility

**Breaking Change:** This is a breaking change to the file format.

**Decision:** Don't support old format anymore. Users must migrate to new format manually.

## Related TODO Items

From `README.md:15`:

> 1. available_publisher_addresses.json should already have separated on which servers they are used. To prevent deploying same address to two different servers.

**Status:** This plan addresses this TODO item directly.

## Files to Modify

1. `src/cli/commands/prepare-deployment.ts` - Main implementation
2. `README.md` - Update TODO (mark as completed)

## Success Criteria

- ✅ File format requires server-specific structure: `{A: [], B: [], ...}`
- ✅ Validates no publisher address appears in multiple server arrays
- ✅ Default behavior (no HA) uses server "A" publishers
- ✅ High availability mode uses corresponding server keys
- ✅ Clear error messages for all validation failures
- ✅ All existing tests still pass (after updating test files)
- ✅ Same server always gets same publisher addresses across deployments
- ✅ Documentation updated with new format
