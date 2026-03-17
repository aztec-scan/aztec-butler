import type { EthereumClient } from "../../core/components/EthereumClient.js";
import {
  STAKING_REGISTRY_TARGETS,
  type StakingRegistryTarget,
} from "../../types/index.js";

export interface RegistryDuplicateCheckResult {
  duplicates: Map<string, Set<StakingRegistryTarget>>;
}

export const checkAttesterDuplicatesAcrossRegistries = async (
  ethClient: EthereumClient,
  adminAddress: string,
  attesterAddresses: string[],
): Promise<RegistryDuplicateCheckResult> => {
  const normalizedCandidates = attesterAddresses.map((addr) =>
    addr.toLowerCase(),
  );
  const duplicates = new Map<string, Set<StakingRegistryTarget>>();

  for (const target of STAKING_REGISTRY_TARGETS) {
    let registryAddress: string;
    try {
      registryAddress = ethClient.getStakingRegistryAddress(target);
    } catch (error) {
      console.warn(
        `⚠️  Skipping duplicate check for '${target}' registry: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    console.log(`- ${target}: ${registryAddress}`);

    try {
      const providerData = await ethClient.getStakingProvider(
        adminAddress,
        target,
      );
      if (!providerData) {
        console.warn(
          `⚠️  Provider not found in '${target}' registry for admin ${adminAddress}; skipping this registry`,
        );
        continue;
      }

      const queueLength = await ethClient.getProviderQueueLength(
        providerData.providerId,
        target,
      );
      console.log(`  Queue length: ${queueLength}`);

      if (queueLength === 0n) {
        continue;
      }

      const queue = await ethClient.getProviderQueue(
        providerData.providerId,
        target,
      );
      const queueSet = new Set(queue.map((addr) => addr.toLowerCase()));

      for (let i = 0; i < normalizedCandidates.length; i++) {
        const candidate = normalizedCandidates[i]!;
        if (!queueSet.has(candidate)) {
          continue;
        }

        const canonicalAddress = attesterAddresses[i]!;
        if (!duplicates.has(canonicalAddress)) {
          duplicates.set(canonicalAddress, new Set());
        }
        duplicates.get(canonicalAddress)!.add(target);
      }
    } catch (error) {
      console.warn(
        `⚠️  Failed duplicate check for '${target}' registry: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { duplicates };
};
