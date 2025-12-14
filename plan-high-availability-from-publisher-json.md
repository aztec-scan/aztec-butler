# Plan: Refactor High-Availability Configuration

## Summary of Changes

Remove the `--high-availability-count` CLI option and automatically determine the number of server configuration files to generate based on the keys present in the `available_publishers` JSON file. Update the output file naming convention to `[filename]_[serverId]_[version].json`.

## Key Requirements

1. **Remove** `--high-availability-count` option completely
2. **Auto-detect** number of servers from keys in `available_publishers` file
3. **Change output naming** from `A_prod.json.new` to `prod_server1_v1.json`
4. **Always include server ID** in output filename, even for single server
5. **Use JSON key order** as it appears in the file for server ordering
6. **Remove `.new` suffix** and add version suffix for duplicate prevention
7. **No migration or backward compatibility** - breaking change is acceptable
8. **Version numbering** - find highest existing version and increment from there
9. **Server ID format** - any valid JSON key is acceptable

## Current Behavior

### Input File Structure (`available_publishers`)

```json
{
  "A": ["0x111...", "0x222..."],
  "B": ["0x333...", "0x444..."],
  "C": ["0x555...", "0x666..."]
}
```

### CLI Usage

```bash
# Single server (uses only "A")
aztec-butler prepare-deployment \
  --production-keys prod.json \
  --new-public-keys new.json \
  --available-publishers pubs.json

# Output: prod.json.new

# Multiple servers
aztec-butler prepare-deployment \
  --production-keys prod.json \
  --new-public-keys new.json \
  --available-publishers pubs.json \
  --high-availability-count 3

# Output: A_prod.json.new, B_prod.json.new, C_prod.json.new
```

### Logic

- User specifies count with `--high-availability-count N`
- Code validates that servers "A" through "Z" (first N letters) exist in the file
- Generates N files with prefix naming convention
- Special case: without the option, only uses server "A" and outputs without prefix

## New Behavior

### Input File Structure (`available_publishers`)

```json
{
  "server1": ["0x111...", "0x222..."],
  "server2": ["0x333...", "0x444..."],
  "server3": ["0x555...", "0x666..."]
}
```

### CLI Usage

```bash
# Automatically detects all servers in the file
aztec-butler prepare-deployment \
  --production-keys prod.json \
  --new-public-keys new.json \
  --available-publishers pubs.json

# Output: prod_server1_v1.json, prod_server2_v1.json, prod_server3_v1.json

# If files already exist, increment version
# Second run output: prod_server1_v2.json, prod_server2_v2.json, prod_server3_v2.json
```

### Logic

- Auto-detect all server IDs from `available_publishers` object keys
- Generate one output file per server ID
- Server IDs can be any valid JSON key (no restriction to A-Z)
- Use order as keys appear in `Object.keys()` (insertion order)
- Always include server ID in filename, even for single server
- Version numbering: find highest existing `[filename]_[serverId]_v*.json` and increment
- Skip servers with empty publisher arrays (log warning)
- Fail if all servers have empty arrays

## Detailed Changes

### 1. File: `src/cli/commands/prepare-deployment.ts`

#### Location: Lines 13-20 (Interface Definition)

**Remove:**

```typescript
interface PrepareDeploymentOptions {
  productionKeys: string;
  newPublicKeys: string;
  availablePublishers: string;
  highAvailabilityCount?: number; // ← REMOVE THIS LINE
  outputPath?: string;
  network: string;
}
```

**After:**

```typescript
interface PrepareDeploymentOptions {
  productionKeys: string;
  newPublicKeys: string;
  availablePublishers: string;
  outputPath?: string;
  network: string;
}
```

#### Location: Lines 257-278 (High Availability Validation Section)

**Remove entire section:**

```typescript
// 5. High availability validation
const haCount = options.highAvailabilityCount || 1;

if (haCount > 1) {
  console.log(`\nValidating high availability setup (count: ${haCount})...`);

  const prefixes = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").slice(0, haCount);
  const availableServers = Object.keys(serverPublishers).filter(
    (key) => serverPublishers[key]!.length > 0,
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

**Replace with:**

```typescript
// 5. Server detection
console.log("\nDetecting servers from available publishers...");

const serverIds = Object.keys(serverPublishers).filter(
  (key) => serverPublishers[key]!.length > 0,
);

if (serverIds.length === 0) {
  throw new Error(
    `FATAL: No servers with publishers found in available publishers file.\n` +
      `At least one server with publisher addresses is required.`,
  );
}

console.log(`✅ Found ${serverIds.length} server(s): ${serverIds.join(", ")}`);
```

#### Location: Lines 280-404 (Output File Generation)

**Remove entire section from line 280 to line 404** (everything from "// 6. Generate output file(s)" through the end of the two branches `if (haCount === 1)` and `else`)

**Replace with:**

```typescript
// 6. Generate output file(s)
console.log("\nGenerating output file(s)...");

const outputBasePath =
  options.outputPath || path.basename(options.productionKeys);
const outputDir = path.dirname(options.outputPath || options.productionKeys);

// Helper function to find highest existing version for a server
const findHighestVersion = async (
  baseWithoutExt: string,
  serverId: string,
  dir: string,
): Promise<number> => {
  const pattern = `${baseWithoutExt}_${serverId}_v*.json`;
  const files = await fs.readdir(dir).catch(() => []);

  let highestVersion = 0;
  const regex = new RegExp(
    `^${baseWithoutExt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_${serverId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_v(\\d+)\\.json$`,
  );

  for (const file of files) {
    const match = file.match(regex);
    if (match && match[1]) {
      const version = parseInt(match[1], 10);
      if (version > highestVersion) {
        highestVersion = version;
      }
    }
  }

  return highestVersion;
};

// Helper function to generate versioned filename
const generateVersionedFilename = async (
  basePath: string,
  serverId: string,
  dir: string,
): Promise<string> => {
  // Remove .json extension if present
  const baseWithoutExt = basePath.endsWith(".json")
    ? basePath.slice(0, -5)
    : basePath;

  // Find highest existing version and increment
  const highestVersion = await findHighestVersion(
    baseWithoutExt,
    serverId,
    dir,
  );
  const nextVersion = highestVersion + 1;

  const filename = `${baseWithoutExt}_${serverId}_v${nextVersion}.json`;
  return path.join(dir, filename);
};

// Merge all validators (without publishers yet)
const mergedValidators: KeystoreValidator[] = [
  ...productionData.validators.map((v) => ({
    attester: v.attester,
    coinbase: v.coinbase,
    feeRecipient: v.feeRecipient,
  })),
  ...newPublicKeysData.validators.map((v) => ({
    attester: v.attester,
    feeRecipient: v.feeRecipient,
    // No coinbase for new validators
  })),
];

// Function to assign publishers using round-robin
const assignPublishers = (
  validators: KeystoreValidator[],
  publishers: string[],
): KeystoreValidator[] => {
  return validators.map((v, i) => ({
    ...v,
    publisher: publishers[i % publishers.length]!,
  }));
};

const outputFiles: { filename: string; data: KeystoreFile }[] = [];

// Generate one file per server
for (const serverId of serverIds) {
  const filePublishers = serverPublishers[serverId]!;

  if (filePublishers.length === 0) {
    console.warn(`⚠️  Skipping server ${serverId}: no publishers configured`);
    continue;
  }

  const outputPath = await generateVersionedFilename(
    outputBasePath,
    serverId,
    outputDir,
  );

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

  console.log(
    `  ${path.basename(outputPath)}: ${filePublishers.length} publisher(s) from server ${serverId}`,
  );
}

if (outputFiles.length === 0) {
  throw new Error(
    `FATAL: No output files generated. Ensure at least one server has publishers configured.`,
  );
}
```

#### Location: Lines 497-513 (Summary Section)

**Update the summary output:**

Change:

```typescript
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

To:

```typescript
console.log("\n=== Summary ===");
console.log(
  `Total validators: ${mergedValidators.length} (${productionData.validators.length} existing + ${newPublicKeysData.validators.length} new)`,
);

// Show publishers per server
console.log(`Servers detected: ${serverIds.length}`);
for (const serverId of serverIds) {
  const publishers = serverPublishers[serverId]!;
  console.log(`  - Server ${serverId}: ${publishers.length} publisher(s)`);
}

console.log(`\nOutput files generated: ${outputFiles.length}`);
for (const { filename } of outputFiles) {
  console.log(`  - ${path.basename(filename)}`);
}
console.log(`\nScraper config: ${savedPath}`);
console.log("\n✅ Deployment preparation complete!");
```

### 2. File: `cli.ts`

#### Location: Lines 308-312

**Remove:**

```typescript
  .option(
    "--high-availability-count <n>",
    "Create N files with non-overlapping publishers",
    (value) => parseInt(value, 10),
  )
```

#### Location: Lines 317-339

**Change the options type:**

From:

```typescript
async (options: {
  productionKeys: string;
  newPublicKeys: string;
  availablePublishers: string;
  highAvailabilityCount?: number;
  output?: string;
})
```

To:

```typescript
async (options: {
  productionKeys: string;
  newPublicKeys: string;
  availablePublishers: string;
  output?: string;
})
```

**Remove from the command invocation:**

```typescript
...(options.highAvailabilityCount !== undefined
  ? { highAvailabilityCount: options.highAvailabilityCount }
  : {}),
```

### 3. File: `scripts/prepare-deployment.sh`

#### Location: Lines 3, 21, 36, 61, 64

**Update the file header comments:**

Change:

```bash
# Usage: ./scripts/prepare-deployment.sh <production-keys> <new-public-keys> <available-publishers> [options]
#
# Options:
#   --high-availability-count <n>: Create N files with non-overlapping publishers
#   --output <path>: Custom output file path (default: <production-keys>.new)
#
# Examples:
#   # Basic usage
#   ./scripts/prepare-deployment.sh \
#     prod-testnet-keyfile.json \
#     new-public-keys.json \
#     testnet_available_publisher_addresses.json
#
#   # High availability mode (3-way split)
#   ./scripts/prepare-deployment.sh \
#     prod-testnet-keyfile.json \
#     new-public-keys.json \
#     testnet_available_publisher_addresses.json \
#     --high-availability-count 3
```

To:

```bash
# Usage: ./scripts/prepare-deployment.sh <production-keys> <new-public-keys> <available-publishers> [options]
#
# The number of output files is automatically determined by the number of server keys
# in the available-publishers JSON file.
#
# Options:
#   --output <path>: Custom output file path base (default: <production-keys>)
#
# Examples:
#   # Automatically generates one file per server in available_publishers
#   ./scripts/prepare-deployment.sh \
#     prod-testnet-keyfile.json \
#     new-public-keys.json \
#     testnet_available_publisher_addresses.json
#
#   # Output: prod-testnet-keyfile_server1_v1.json, prod-testnet-keyfile_server2_v1.json, etc.
```

**Update the help text (lines 50-63):**

Change:

```bash
  echo "Usage: $0 <production-keys> <new-public-keys> <available-publishers> [options]"
  echo ""
  echo "Options:"
  echo "  --high-availability-count <n>  Create N files with non-overlapping publishers"
  echo "  --output <path>                Custom output file path"
  echo ""
  echo "Examples:"
  echo "  $0 prod-testnet-keyfile.json new-public-keys.json publishers.json"
  echo "  $0 prod.json new.json pubs.json --high-availability-count 3"
  echo "  $0 prod.json new.json pubs.json --output custom-output.json"
```

To:

```bash
  echo "Usage: $0 <production-keys> <new-public-keys> <available-publishers> [options]"
  echo ""
  echo "The number of output files is automatically determined by server keys in available-publishers."
  echo ""
  echo "Options:"
  echo "  --output <path>                Custom output file path base"
  echo ""
  echo "Examples:"
  echo "  $0 prod-testnet-keyfile.json new-public-keys.json publishers.json"
  echo "  $0 prod.json new.json pubs.json --output custom-output.json"
```

### 4. Documentation: `scripts/README.md`

#### Location: Lines 52-84

**Replace the entire "prepare-deployment" section:**

Current:

````markdown
```bash
# Basic usage
./scripts/prepare-deployment.sh \
  prod-testnet-keyfile.json \
  new-public-keys.json \
  testnet_available_publisher_addresses.json

# High availability mode (3-way split)
./scripts/prepare-deployment.sh \
  prod-testnet-keyfile.json \
  new-public-keys.json \
  testnet_available_publisher_addresses.json \
  --high-availability-count 3

# Custom output path
./scripts/prepare-deployment.sh \
  prod-testnet-keyfile.json \
  new-public-keys.json \
  testnet_available_publisher_addresses.json \
  --output /path/to/output.json
```
````

**Arguments:**

- `production-keys` - Path to existing production keyfile with remoteSigner (required)
- `new-public-keys` - Path to new public keys file from process-private-keys (required)
- `available-publishers` - Path to JSON array of available publisher addresses (required)

**Options:**

- `--high-availability-count <n>` - Create N files with non-overlapping publishers
- `--output <path>` - Custom output file path (default: `<production-keys>.new`)

````

New:
```markdown
```bash
# Basic usage - automatically detects servers from available_publishers
./scripts/prepare-deployment.sh \
  prod-testnet-keyfile.json \
  new-public-keys.json \
  testnet_available_publisher_addresses.json

# Output files are automatically created, one per server in the publishers file
# Example output: prod-testnet-keyfile_server1_v1.json, prod-testnet-keyfile_server2_v1.json

# Custom output path base
./scripts/prepare-deployment.sh \
  prod-testnet-keyfile.json \
  new-public-keys.json \
  testnet_available_publisher_addresses.json \
  --output /path/to/output.json
````

**Arguments:**

- `production-keys` - Path to existing production keyfile with remoteSigner (required)
- `new-public-keys` - Path to new public keys file from process-private-keys (required)
- `available-publishers` - Path to JSON object with server IDs as keys and publisher arrays as values (required)

**Available Publishers File Format:**

```json
{
  "server1": ["0x111...", "0x222..."],
  "server2": ["0x333...", "0x444..."],
  "server3": ["0x555...", "0x666..."]
}
```

The number of output files is automatically determined by the number of keys in this file.

**Options:**

- `--output <path>` - Custom output file path base (default: `<production-keys>`)

````

#### Location: Lines 85-120

**Update the "What it does" and subsequent sections:**

Change:
```markdown
5. **Generates output files:**
   - Standard mode: Single file `<production-keys>.new` (or `.new2` if exists)
   - HA mode: Multiple files `A_<production-keys>.new`, `B_<production-keys>.new`, etc.
   - Merges all validators (existing + new)
   - Round-robin assigns publishers to ALL validators
````

To:

```markdown
5. **Generates output files:**
   - Automatically generates one file per server in available_publishers
   - Naming: `<production-keys>_<serverId>_v<N>.json`
   - Version number auto-increments from highest existing version
   - Merges all validators (existing + new)
   - Round-robin assigns publishers to ALL validators
```

Change:

```markdown
**High Availability Mode:**

When using `--high-availability-count`:

- Creates N files with ALL validators but different publisher sets
- Publishers are partitioned into non-overlapping sets
- Requires at least N publishers (fails if not enough)
- Example with 10 publishers and HA count 3:
  - File A: publishers 1-3
  - File B: publishers 4-6
  - File C: publishers 7-10
```

To:

```markdown
**Multiple Servers:**

When available_publishers contains multiple server keys:

- Creates one file per server with ALL validators but different publisher sets
- Each server uses only its own publisher addresses
- Example with 3 servers:
  - `prod_server1_v1.json`: uses publishers from "server1"
  - `prod_server2_v1.json`: uses publishers from "server2"
  - `prod_server3_v1.json`: uses publishers from "server3"
```

Change:

```markdown
**Output:**

- One or more `.new` files with merged validators and assigned publishers
- Updated scraper config at `~/.local/share/aztec-butler/{network}-scrape-config.json`
```

To:

```markdown
**Output:**

- One or more `*_<serverId>_v<N>.json` files with merged validators and assigned publishers
- Updated scraper config at `~/.local/share/aztec-butler/{network}-scrape-config.json`
```

### 5. Documentation: `docs/operator-guide/phase-3.md`

#### Location: Lines 40-70

**Replace the examples section:**

From:

````markdown
### 1. Single Server Deployment

```bash
aztec-butler prepare-deployment \
  --production-keys prod-testnet-keyfile.json \
  --new-public-keys public-new-private-keys.json \
  --available-publishers available_publisher_addresses.json
```
````

- Creates `prod-testnet-keyfile.json.new`
- Updates scraper config

### 2. High Availability Deployment (Multiple Servers)

```bash
aztec-butler prepare-deployment \
  --production-keys prod-testnet-keyfile.json \
  --new-public-keys public-new-private-keys.json \
  --available-publishers available_publisher_addresses.json \
  --high-availability-count 3
```

**This creates 3 files:**

- `A_prod-testnet-keyfile.json.new` (uses publishers from server A)
- `B_prod-testnet-keyfile.json.new` (uses publishers from server B)
- `C_prod-testnet-keyfile.json.new` (uses publishers from server C)

All files contain **the same validators** but **different publishers**.

````

To:
```markdown
### 1. Prepare Deployment Files

The command automatically detects the number of servers from your `available_publisher_addresses.json` file.

**Example available_publisher_addresses.json:**

```json
{
  "server1": ["0x111...", "0x222...", "0x333..."],
  "server2": ["0x444...", "0x555...", "0x666..."],
  "server3": ["0x777...", "0x888...", "0x999..."]
}
````

**Run the command:**

```bash
aztec-butler prepare-deployment \
  --production-keys prod-testnet-keyfile.json \
  --new-public-keys public-new-private-keys.json \
  --available-publishers available_publisher_addresses.json
```

**This automatically creates one file per server:**

- `prod-testnet-keyfile_server1_v1.json` (uses publishers from server1)
- `prod-testnet-keyfile_server2_v1.json` (uses publishers from server2)
- `prod-testnet-keyfile_server3_v1.json` (uses publishers from server3)

All files contain **the same validators** but **different publishers**.

**For single server:** Use a file with just one key:

```json
{
  "server1": ["0x111...", "0x222..."]
}
```

Output: `prod-testnet-keyfile_server1_v1.json`

````

#### Location: Lines 72-98

**Update verification examples:**

From:
```markdown
### 3. Verify Output Files

#### Single Server:

```bash
# Check validator count
jq '.validators | length' prod-testnet-keyfile.json.new

# Verify all validators have publishers
jq '.validators[] | select(.publisher == null)' prod-testnet-keyfile.json.new
# Should output nothing
````

#### High Availability

```bash
# Verify all files have same validators
diff <(jq '.validators[].attester.eth' A_prod-testnet-keyfile.json.new | sort) \
     <(jq '.validators[].attester.eth' B_prod-testnet-keyfile.json.new | sort)
# Should show no differences

# Verify different publishers
diff <(jq '.validators[].publisher' A_prod-testnet-keyfile.json.new | sort) \
     <(jq '.validators[].publisher' B_prod-testnet-keyfile.json.new | sort)
# Should show differences
```

````

To:
```markdown
### 2. Verify Output Files

#### Check a single file:

```bash
# Check validator count
jq '.validators | length' prod-testnet-keyfile_server1_v1.json

# Verify all validators have publishers
jq '.validators[] | select(.publisher == null)' prod-testnet-keyfile_server1_v1.json
# Should output nothing
````

#### Multiple Servers

```bash
# Verify all files have same validators
diff <(jq '.validators[].attester.eth' prod-testnet-keyfile_server1_v1.json | sort) \
     <(jq '.validators[].attester.eth' prod-testnet-keyfile_server2_v1.json | sort)
# Should show no differences

# Verify different publishers
diff <(jq '.validators[].publisher' prod-testnet-keyfile_server1_v1.json | sort) \
     <(jq '.validators[].publisher' prod-testnet-keyfile_server2_v1.json | sort)
# Should show differences
```

````

#### Location: Lines 100-114

**Update scraper config section:**

Change heading from `### 4. Review Scraper Config` to `### 3. Review Scraper Config`

#### Location: Lines 136-150

**Update checklist:**

From:
```markdown
- [ ] Deployment file(s) created:
  - [ ] `prod-testnet-keyfile.json.new` (single server), OR
  - [ ] `A_prod-testnet-keyfile.json.new`, `B_...`, `C_...` (HA)
````

To:

```markdown
- [ ] Deployment file(s) created:
  - [ ] `prod-testnet-keyfile_<serverId>_v1.json` for each server
```

#### Location: Lines 222-244

**Update troubleshooting section:**

From:

````markdown
### Issue: "Server A not found in available publishers"

**Cause:** Publisher file doesn't have server "A" key.

**Solution:** Ensure publisher file has correct structure:

```json
{
  "A": ["0x111...", "0x222..."]
}
```
````

### Issue: "Not enough servers for HA count"

**Cause:** HA count exceeds available servers in publisher file.

**Example:** `--high-availability-count 3` but file only has A and B.

**Solution:**

- Add server C to publisher file, OR
- Reduce `--high-availability-count` to 2

````

To:
```markdown
### Issue: "No servers with publishers found"

**Cause:** Publisher file has no keys or all server arrays are empty.

**Solution:** Ensure publisher file has correct structure with at least one server:

```json
{
  "server1": ["0x111...", "0x222..."]
}
````

### Issue: "No output files generated"

**Cause:** All server entries in the publisher file have empty arrays.

**Solution:**

- Ensure at least one server has publisher addresses

````

### 6. Documentation: `docs/operator-guide/README.md`

#### Location: Line 75

**Remove or update reference:**

From:
```markdown
- Use `--high-availability-count N` flag in Phase 3
````

To:

```markdown
- Multiple servers auto-detected from available_publishers file in Phase 3
```

### 7. Documentation: `docs/operator-guide/phase-0.md`

#### Location: Line 150

**Update the comment if present:**

From:

```markdown
# New format: {"A": ["0x111...", "0x222..."]}
```

To:

```markdown
# Format: {"server1": ["0x111...", "0x222..."], "server2": ["0x333..."]}
```

## Implementation Checklist

- [ ] Update `src/cli/commands/prepare-deployment.ts`
  - [ ] Remove `highAvailabilityCount` from interface
  - [ ] Remove HA validation section
  - [ ] Replace output file generation logic with auto-detection
  - [ ] Implement version detection and incrementing
  - [ ] Update summary output
- [ ] Update `cli.ts`
  - [ ] Remove `--high-availability-count` option
  - [ ] Remove from action handler parameters
- [ ] Update `scripts/prepare-deployment.sh`
  - [ ] Update header comments
  - [ ] Update help text
  - [ ] Remove references to HA count
- [ ] Update `scripts/README.md`
  - [ ] Update examples
  - [ ] Update arguments documentation
  - [ ] Add available_publishers format documentation
  - [ ] Update "What it does" section
  - [ ] Update output description
- [ ] Update `docs/operator-guide/phase-3.md`
  - [ ] Update examples with new file naming
  - [ ] Update verification commands
  - [ ] Update checklist
  - [ ] Update troubleshooting section
- [ ] Update `docs/operator-guide/README.md`
  - [ ] Remove/update HA count reference
- [ ] Update `docs/operator-guide/phase-0.md`
  - [ ] Update file format comment if present

## Testing Plan

After implementation, verify:

1. **Single server case**
   - Input: `{"server1": ["0x111..."]}`
   - Expected output: `prod_server1_v1.json`

2. **Multiple servers case**
   - Input: `{"server1": [...], "server2": [...], "server3": [...]}`
   - Expected output: `prod_server1_v1.json`, `prod_server2_v1.json`, `prod_server3_v1.json`

3. **Version incrementing**
   - Run twice, verify v1 then v2 files are created
   - Create gaps (v1, v3 exist), verify next is v4

4. **JSON extension stripping**
   - Input: `prod.json` → Output: `prod_server1_v1.json`
   - Input: `prod` → Output: `prod_server1_v1.json`

5. **Empty servers skipped**
   - Input: `{"server1": ["0x111..."], "server2": []}`
   - Expected: Only `prod_server1_v1.json` created
   - Expected: Warning logged for server2

6. **All servers empty**
   - Input: `{"server1": [], "server2": []}`
   - Expected: Error thrown

7. **Shared publisher validation**
   - Input: `{"server1": ["0x111..."], "server2": ["0x111..."]}`
   - Expected: Error thrown before file generation

8. **Server ID formats**
   - Test with various valid JSON keys: `"1"`, `"server-1"`, `"主服务器"`, etc.
   - All should work without restriction

## Breaking Changes

- **CLI option removed**: `--high-availability-count` no longer exists
- **Output file naming changed**:
  - Old: `A_prod.json.new`, `B_prod.json.new`
  - New: `prod_server1_v1.json`, `prod_server2_v1.json`
- **File extension changed**: `.new` suffix removed, replaced with `_v<N>.json`
- **Single server behavior**: Previously no prefix, now always includes server ID
- **Server naming**: Changed from A-Z convention to any JSON key

**Migration and Backward Compatibility should not be considered. This system is not being used in production yet, so breaking changes are acceptable.**
