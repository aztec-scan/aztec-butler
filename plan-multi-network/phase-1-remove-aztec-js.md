# Phase 1: Replace @aztec/aztec.js with HTTP + Zod

## Problem

The butler depends on `@aztec/aztec.js` (v2.1.2) solely for `createAztecNodeClient` and the `NodeInfo` type. This heavy SDK:

- Couples butler to a specific Aztec protocol version
- Won't work with devnet nodes running v4.0.0
- Adds significant dependency weight and build time

## What's Actually Used

Every usage of `AztecClient` does exactly one thing: `getNodeInfo()`. The only properties read from the result are:

- `nodeInfo.l1ChainId` (number)
- `nodeInfo.l1ContractAddresses.rollupAddress` (hex string, called with `.toString()`)

The underlying RPC call is `node_getNodeInfo` via JSON-RPC POST. `HostChecker.ts` already makes this exact call directly via `fetch()`.

## Verified Response Format

All three nodes (mainnet v2.1.9, testnet v3.0.2, devnet v4.0.0) return identical schema:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "nodeVersion": "2.1.9",
    "l1ChainId": 1,
    "rollupVersion": 0,
    "l1ContractAddresses": {
      "rollupAddress": "0x603bb2c05d474794ea97805e8de69bccfb3bca12",
      "registryAddress": "0x...",
      "inboxAddress": "0x...",
      "outboxAddress": "0x...",
      "feeJuiceAddress": "0x...",
      "stakingAssetAddress": "0x...",
      "feeJuicePortalAddress": "0x...",
      "coinIssuerAddress": "0x...",
      "rewardDistributorAddress": "0x...",
      "governanceProposerAddress": "0x...",
      "governanceAddress": "0x...",
      "gseAddress": "0x..."
    },
    "protocolContractAddresses": { ... }
  }
}
```

Devnet v4 adds `"realProofs": false` but is otherwise identical. The Zod schema uses `.passthrough()` to be forward-compatible.

## Changes

### 1. Create `src/types/aztec-node.ts` -- Zod schema for NodeInfo

Define a Zod schema matching the response, parsing only the fields we need. Use `.passthrough()` on the outer objects so unknown fields (like `realProofs`) don't cause validation errors.

### 2. Rewrite `src/core/components/AztecClient.ts`

Replace the `@aztec/aztec.js` import with a direct `fetch()` call to the JSON-RPC endpoint. Parse the response with the Zod schema.

### 3. Update `src/cli/commands/deposit-calldata.ts`

Replace `import { NodeInfo } from "@aztec/aztec.js"` with the local type.

### 4. Remove `@aztec/aztec.js` from `package.json`

Remove the dependency. Other `@aztec/*` packages (`@aztec/ethereum`, `@aztec/l1-artifacts`, `@aztec/foundation`) are still used by CLI commands and `EthereumClient.ts` -- those stay for now.

### 5. Run `npm install` to update lockfile

## Files Changed

| File                                   | Action                                    |
| -------------------------------------- | ----------------------------------------- |
| `src/types/aztec-node.ts`              | **New** -- Zod schema + exported types    |
| `src/core/components/AztecClient.ts`   | **Rewrite** -- fetch + Zod instead of SDK |
| `src/cli/commands/deposit-calldata.ts` | **Edit** -- update import                 |
| `package.json`                         | **Edit** -- remove `@aztec/aztec.js`      |

## No Downstream Changes Needed

All scrapers and server code use `AztecClient.getNodeInfo()` and access `nodeInfo.l1ChainId` and `nodeInfo.l1ContractAddresses.rollupAddress.toString()`. The new implementation returns the same shape, so no scraper changes are required.
