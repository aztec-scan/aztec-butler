/**
 * Chain context for the agent: a single shared {@link EthereumClient},
 * verified against the configured network, plus resolved provider IDs.
 *
 * Agent mode performs only read-only L1/L2 calls. The chain ID is verified
 * before any read is trusted (PLAN.md "Safety requirements").
 */

import type { Address } from "viem";
import { AztecClient } from "../core/components/AztecClient.js";
import { EthereumClient } from "../core/components/EthereumClient.js";
import {
  describeNativeProvider,
  resolveNativeProvider,
  type NativeProviderSelector,
} from "../core/components/staking-provider.js";
import type { Registry } from "./keys/local-key-loader.js";
import type { AgentConfig } from "./config.js";

export interface ResolvedProvider {
  registry: Registry;
  providerId: bigint | null;
  adminAddress: string;
  rewardsRecipient: string;
}

export interface AgentChainContext {
  ethClient: EthereumClient;
  chainId: number;
  /** Resolved staking-provider info, keyed by registry. Absent when the
   *  registry's admin address is not configured or the provider was not found. */
  providers: Partial<Record<Registry, ResolvedProvider>>;
}

/**
 * Build the agent's chain context: fetch node info, verify chain ID,
 * construct the read-only EthereumClient, and resolve provider IDs.
 */
export const initAgentChain = async (config: AgentConfig): Promise<AgentChainContext> => {
  const aztecClient = new AztecClient({ nodeUrl: config.aztecNodeUrl });
  const nodeInfo = await aztecClient.getNodeInfo();

  if (nodeInfo.l1ChainId !== config.ethereumChainId) {
    throw new Error(
      `Chain ID mismatch: config ETHEREUM_CHAIN_ID=${config.ethereumChainId}, ` +
        `but Aztec node reports l1ChainId=${nodeInfo.l1ChainId}. Refusing to trust L1 reads.`,
    );
  }

  const ethClient = new EthereumClient({
    rpcUrl: config.ethereumNodeUrl,
    ...(config.ethereumArchiveNodeUrl ? { archiveRpcUrl: config.ethereumArchiveNodeUrl } : {}),
    chainId: nodeInfo.l1ChainId,
    rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress as Address,
    ...(config.ollaStakingRegistryAddress
      ? { ollaStakingRegistryAddress: config.ollaStakingRegistryAddress as Address }
      : {}),
  });

  // Verify the RPC endpoint itself reports the expected chain.
  await ethClient.verifyChainId();

  const providers: Partial<Record<Registry, ResolvedProvider>> = {};

  // Resolve the native provider — by stable id when configured, else by admin
  // address (see core/components/staking-provider.ts). Skipped when neither set.
  if (config.nativeProviderId !== undefined || config.nativeProviderAdminAddress) {
    const selector: NativeProviderSelector = {
      ...(config.nativeProviderId !== undefined
        ? { providerId: config.nativeProviderId }
        : {}),
      ...(config.nativeProviderAdminAddress
        ? { adminAddress: config.nativeProviderAdminAddress }
        : {}),
    };
    try {
      const data = await resolveNativeProvider(ethClient, selector);
      if (data) {
        providers.native = {
          registry: "native",
          providerId: data.providerId,
          adminAddress: data.admin,
          rewardsRecipient: data.rewardsRecipient,
        };
        console.log(`[agent] Resolved native provider id=${data.providerId}`);
      } else {
        console.warn(
          `[agent] No native staking provider found for ${describeNativeProvider(selector)}.`,
        );
      }
    } catch (error) {
      console.warn(
        `[agent] Failed to resolve native provider: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.ollaProviderAdminAddress && config.ollaStakingRegistryAddress) {
    try {
      const data = await ethClient.getStakingProvider(config.ollaProviderAdminAddress, "olla");
      if (data) {
        providers.olla = {
          registry: "olla",
          providerId: data.providerId,
          adminAddress: config.ollaProviderAdminAddress,
          rewardsRecipient: data.rewardsRecipient,
        };
        console.log(`[agent] Resolved Olla provider (admin ${data.admin}).`);
      } else {
        console.warn(
          `[agent] No Olla staking provider found for admin ${config.ollaProviderAdminAddress}.`,
        );
      }
    } catch (error) {
      console.warn(
        `[agent] Failed to resolve Olla provider: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (config.ollaProviderAdminAddress && !config.ollaStakingRegistryAddress) {
    console.warn(
      "[agent] OLLA_AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS is set but " +
        "OLLA_AZTEC_STAKING_REGISTRY_ADDRESS is missing — Olla scrapes are disabled.",
    );
  }

  return { ethClient, chainId: nodeInfo.l1ChainId, providers };
};
