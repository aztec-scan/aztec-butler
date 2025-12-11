# Plan: Use Provider ID Directly

## Goal

Allow users to query and use provider ID directly instead of querying from admin address every time.

## Current Behavior

- All commands query `getStakingProvider(adminAddress)` to get provider ID
- This requires RPC call every time
- Provider ID rarely changes

## Proposed Changes

### 1. Add CLI Command: `get-provider-id`

```bash
npm run cli -- get-provider-id <admin-address>
```

**Output:**

```
Provider ID: 123
Admin: 0x1234...
Take Rate: 1000
Rewards Recipient: 0x5678...
```

### 2. Add `--provider-id` Flag to Commands

Support provider ID directly in commands that need it:

```bash
npm run cli -- scrape-coinbases --provider-id 123
npm run cli -- generate-scraper-config --provider-id 123
```

### 3. Implementation

**File:** `src/cli/commands/get-provider-id.ts` (NEW)

```typescript
const command = async (
  ethClient: EthereumClient,
  options: { adminAddress: string },
) => {
  const providerData = await ethClient.getStakingProvider(options.adminAddress);
  // Print provider details
};
```

**Update:** `cli.ts`

- Add `get-provider-id` case
- Parse `--provider-id` flag in relevant commands

### 4. Benefits

- Faster execution (skip RPC call)
- Useful for scripting and automation
- Can cache provider ID locally
- Easier testing with specific provider IDs

## Use Cases

- Query provider ID once, use in multiple commands
- Testing with specific provider IDs
- Automation scripts that know provider ID
