import { z } from "zod";

/**
 * Zod schema for the `node_getNodeInfo` JSON-RPC response.
 *
 * Only the fields actually consumed by the butler are strictly typed;
 * `.passthrough()` is used so that newer Aztec node versions (which may
 * add fields like `realProofs`) don't cause validation failures.
 */

const L1ContractAddressesSchema = z
  .object({
    rollupAddress: z.string(),
    registryAddress: z.string(),
    inboxAddress: z.string(),
    outboxAddress: z.string(),
    feeJuiceAddress: z.string(),
    stakingAssetAddress: z.string(),
    feeJuicePortalAddress: z.string(),
    coinIssuerAddress: z.string(),
    rewardDistributorAddress: z.string(),
    governanceProposerAddress: z.string(),
    governanceAddress: z.string(),
  })
  .passthrough();

const NodeInfoResultSchema = z
  .object({
    nodeVersion: z.string(),
    l1ChainId: z.number(),
    rollupVersion: z.number(),
    l1ContractAddresses: L1ContractAddressesSchema,
    protocolContractAddresses: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export const NodeInfoRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number(),
  result: NodeInfoResultSchema,
});

/** Parsed node info — the `.result` portion of the RPC response. */
export type NodeInfo = z.infer<typeof NodeInfoResultSchema>;
