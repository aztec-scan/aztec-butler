import { loadAndMergeKeysFiles } from "../../core/utils/keysFileOperations.js";

export interface LoadAttestersResult {
  addresses: string[];
  attestersWithCoinbase: Array<{ address: string; coinbase: string }>;
  attestersWithoutCoinbase: string[];
  filesLoaded: string[];
}

/**
 * Load attester addresses from keys files for CLI commands
 */
export async function loadAttestersForCLI(
  network: string,
): Promise<LoadAttestersResult> {
  const { attesters, filesLoaded } = await loadAndMergeKeysFiles(network);

  if (filesLoaded.length === 0) {
    throw new Error(
      `No keys files found for network "${network}".\n` +
        `Expected pattern: ${network}-keys-*.json in data directory.\n` +
        `Run 'aztec-butler prepare-deployment' to create keys files.`,
    );
  }

  const attestersWithCoinbase = attesters
    .filter((a) => a.coinbase)
    .map((a) => ({
      address: a.address,
      coinbase: a.coinbase!,
    }));

  const attestersWithoutCoinbase = attesters
    .filter((a) => !a.coinbase)
    .map((a) => a.address);

  return {
    addresses: attesters.map((a) => a.address),
    attestersWithCoinbase,
    attestersWithoutCoinbase,
    filesLoaded,
  };
}
