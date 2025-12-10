import { getAddressFromPrivateKey } from "@aztec/ethereum";
import { formatEther, parseEther } from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import { HexString } from "../../types/index.js";

const RECOMMENDED_ETH_PER_ATTESTER = parseEther("0.1");

interface GetPublisherEthOptions {
  keystorePaths: string[];
}

const command = async (
  ethClient: EthereumClient,
  options: GetPublisherEthOptions,
) => {
  console.log("\n=== Checking Publisher ETH Balances ===\n");

  // Load keystores
  console.log(`Loading ${options.keystorePaths.length} keystore file(s)...`);
  const { loadKeystoresFromPaths } = await import(
    "../../core/utils/keystoreOperations.js"
  );
  const keystores = await loadKeystoresFromPaths(options.keystorePaths);
  console.log(`✅ Loaded ${keystores.length} keystore file(s)\n`);

  const client = ethClient.getPublicClient();
  const publishers: Record<
    HexString,
    {
      load: number;
      currentBalance: bigint;
      requiredTopUp: bigint;
    }
  > = {};

  for (const keystore of keystores) {
    for (const validator of keystore.data.validators) {
      if (typeof validator.publisher === "string") {
        const publisherKey = validator.publisher as HexString;
        const pub = publishers[publisherKey] || {
          load: 0,
          currentBalance: 0n,
          requiredTopUp: 0n,
        };
        pub.load += 1;
        publishers[publisherKey] = pub;
      } else {
        const loadFactor = 1 / validator.publisher.length;
        for (const pubPrivKey of validator.publisher) {
          const publisherKey = pubPrivKey as HexString;
          const pub = publishers[publisherKey] || {
            load: 0,
            currentBalance: 0n,
            requiredTopUp: 0n,
          };
          pub.load += loadFactor;
          publishers[publisherKey] = pub;
        }
      }
    }
  }

  console.log("Publisher ETH balances and required top-ups:");
  const topUpsNeeded: Array<{ address: string; amount: bigint }> = [];

  for (const [publisherPrivKey, info] of Object.entries(publishers)) {
    const privKey = publisherPrivKey as HexString;
    const pubAddr = getAddressFromPrivateKey(privKey);
    publishers[privKey]!.currentBalance = await client.getBalance({
      address: pubAddr,
    });
    publishers[privKey]!.requiredTopUp =
      BigInt(Math.ceil(info.load)) * RECOMMENDED_ETH_PER_ATTESTER -
      info.currentBalance;

    const requiresTopUpString =
      publishers[privKey]!.requiredTopUp > 0n
        ? `❌ REQUIRES ADDITIONAL: ${formatEther(publishers[privKey]!.requiredTopUp)} ETH`
        : `✅`;
    console.log(
      `${pubAddr} - load: ${info.load}, current balance: ${formatEther(publishers[privKey]!.currentBalance)} ETH ${requiresTopUpString}`,
    );

    // Collect top-ups needed
    if (publishers[privKey]!.requiredTopUp > 0n) {
      topUpsNeeded.push({
        address: pubAddr,
        amount: publishers[privKey]!.requiredTopUp,
      });
    }
  }

  // Generate simple calldata for funding (based on MIN_ETH_PER_ATTESTER from config)
  if (topUpsNeeded.length > 0) {
    console.log("\n💸 FUNDING CALL DATA:");
    console.log(
      "Note: These are ETH transfers. Execute these transactions to fund the publishers.\n",
    );

    const calls = topUpsNeeded.map((topUp) => ({
      to: topUp.address,
      value: topUp.amount.toString(),
      data: "0x", // Simple ETH transfer
    }));

    console.log(JSON.stringify(calls, null, 2));

    // TODO: Implement --target-balance flag to specify exact target balance per publisher
    // TODO: Implement --per-attester flag to customize ETH amount per attester (different from MIN_ETH_PER_ATTESTER)
    // TODO: Implement --threshold flag to filter out tiny top-ups (default: 0.01 ETH)
    // TODO: Implement multisig batch proposal when Safe is configured
    // These will be implemented when CLI argument parsing is available

    console.warn("\n⚠️  Note: Advanced features not yet implemented:");
    console.warn("    - --target-balance: Specify exact target balance");
    console.warn("    - --per-attester: Customize ETH per attester");
    console.warn("    - --threshold: Filter small top-ups");
    console.warn("    - Automatic Safe multisig batch proposal");
    console.warn(
      "\n    Please copy the calldata above and execute manually via your Safe multisig.",
    );
  } else {
    console.log("\n✅ All publishers have sufficient ETH balance");
  }
};

export default command;
