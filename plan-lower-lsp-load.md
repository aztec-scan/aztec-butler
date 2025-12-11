# Plan: Lower LSP Load for EthereumClient.ts

## Problem

The TypeScript Language Server is timing out frequently when working with `src/core/components/EthereumClient.ts` due to complex type inference and heavy dependencies.

## Root Causes

1. Complex type inference chains with external ABI types
2. Heavy dependencies from `@aztec/ethereum`, `@aztec/l1-artifacts`, and `viem`
3. Missing explicit return types forcing TypeScript to infer complex types repeatedly
4. Inline contract type creation in multiple methods
5. Large method bodies with nested async operations
6. Complex encoded function data with ABI type resolution

## Simple Quick Fixes (Prioritized)

### 1. Add Explicit Return Types ⭐ HIGHEST IMPACT

**Estimated Time:** 5-10 minutes  
**Impact:** Significantly reduces TypeScript inference work

Add explicit return types to these methods:

- `getPublicClient()` (line 97) - should return `PublicClient`
- `getArchiveClient()` (line 104) - should return `PublicClient | null`
- `getChainId()` (line 111) - should return `number`
- `getEtherscanAddressUrl()` (line 187) - should return `string`
- `decodeSplitUpdatedData()` (line 749) - already has inline type, just needs explicit annotation

**Example:**

```typescript
// Before
getPublicClient() {
  return this.client;
}

// After
getPublicClient(): PublicClient {
  return this.client;
}
```

### 2. Extract Complex Contract Types ⭐ EASY WIN

**Estimated Time:** 5 minutes  
**Impact:** Prevents repeated type resolution in methods

Add these type aliases after line 41 (after `const LOG_RANGE_LIMIT = 50_000n;`):

```typescript
type StakingRegistryContract = GetContractReturnType<
  typeof STAKING_REGISTRY_ABI,
  PublicClient
>;
type GovernanceContract = GetContractReturnType<
  typeof GovernanceAbi,
  PublicClient
>;
type GSEContractType = GetContractReturnType<typeof GSEAbi, PublicClient>;
type ERC20Contract = GetContractReturnType<typeof erc20Abi, PublicClient>;
```

These types are currently computed inline in methods like:

- `printImportantInfo()` (lines 201, 206, 225, 235)
- Multiple other methods creating contract instances

After creating these types, update the inline `getContract()` calls to use them.

**Note:** `StakingRegistryContract` already exists in imports (line 25), verify if it's the same type or needs to be used.

### 3. Simplify Type Casts ⭐ LOW EFFORT

**Estimated Time:** 2 minutes  
**Impact:** Removes unnecessary type resolution work

Replace unsafe `as any` casts with proper types:

**Lines 464 and 532:**

```typescript
// Before
getAddress(await rollupContract.read.getGSE()) as any;

// After
getAddress(await rollupContract.read.getGSE()) as Address;
```

### 4. Extract Type Aliases for Complex Return Objects

**Estimated Time:** 10 minutes  
**Impact:** Improves code readability and reduces inline type complexity

Add before line 695:

```typescript
type EntryQueueData = {
  attester: string;
  withdrawer: string;
  publicKeyInG1: { x: bigint; y: bigint };
  publicKeyInG2: { x0: bigint; x1: bigint; y0: bigint; y1: bigint };
  proofOfPossession: { x: bigint; y: bigint };
  moveWithLatestRollup: boolean;
};
```

Then update method signature (line 695):

```typescript
// Before
async getEntryQueueAt(index: bigint): Promise<{
  attester: string;
  withdrawer: string;
  // ... long inline type
}>

// After
async getEntryQueueAt(index: bigint): Promise<EntryQueueData>
```

Similarly for `getLatestSplitAllocations()` (line 328):

```typescript
type SplitAllocationData = {
  recipients: string[];
  allocations: bigint[];
  totalAllocation: bigint;
};
```

### 5. Break Up Large Methods (Future Improvement)

**Estimated Time:** 30-60 minutes  
**Impact:** Reduces complexity for LSP analysis

Consider extracting helpers from `printImportantInfo()` (lines 195-245):

```typescript
private async getGovernanceInfo(): Promise<{
  governance: Address;
  config: any;
  withdrawalDelayInHrs: number;
}> {
  // Extract lines 201-221
}

private async getTokenInfo(tokenAddress: Address, label: string): Promise<void> {
  // Extract token fetching logic (lines 225-244)
}
```

## Implementation Order

1. **Phase 1 (Quick Wins - 10-15 minutes):**
   - Add explicit return types (#1)
   - Extract complex contract types (#2)
   - Fix type casts (#3)

2. **Phase 2 (Code Quality - 10-20 minutes):**
   - Extract type aliases for return objects (#4)

3. **Phase 3 (Optional Refactoring - 30-60 minutes):**
   - Break up large methods (#5)
   - Consider splitting file if still experiencing issues

## Expected Results

- 50-70% reduction in LSP response time after Phase 1
- Improved code maintainability and type safety
- Reduced TypeScript compiler memory usage
- Better IDE responsiveness when editing the file

## Additional Considerations

### If Issues Persist:

1. Check if `tsconfig.json` has `skipLibCheck: true` enabled
2. Consider using TypeScript project references if working in a monorepo
3. Increase VS Code's `typescript.tsserver.maxTsServerMemory` setting
4. Use `// @ts-ignore` sparingly for particularly problematic areas (last resort)

### Performance Monitoring:

- Before changes, note current LSP response time in IDE
- After Phase 1, check if improvements are sufficient
- Only proceed to Phase 2/3 if needed
