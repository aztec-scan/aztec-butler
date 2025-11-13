import { NodeInfo } from "@aztec/aztec.js";
import { getAddressFromPrivateKey } from "@aztec/ethereum";
import { formatEther, parseEther } from "viem";
import { getEthereumClient } from "../components/ethereumClient.js";
import { DirData, HexString } from "../types.js";

const RECOMMENDED_ETH_PER_ATTESTER = parseEther("0.1");

const command = async (nodeInfo: NodeInfo, dirData: DirData) => {
  const client = getEthereumClient(nodeInfo.l1ChainId);
  const publishers: Record<HexString, {
    load: number,
    currentBalance: bigint,
    requiredTopUp: bigint
  }> = {};
  for (const keystore of dirData.keystores) {
    for (const validator of keystore.data.validators) {
      if (typeof validator.publisher === "string") {
        const pub = publishers[validator.publisher] || { load: 0, currentBalance: 0n, requiredTopUp: 0n };
        pub.load += 1;
        publishers[validator.publisher] = pub;
      } else {
        const loadFactor = 1 / validator.publisher.length;
        for (const pubPrivKey of validator.publisher) {
          const pub = publishers[pubPrivKey] || { load: 0, currentBalance: 0n, requiredTopUp: 0n };
          pub.load += loadFactor;
          publishers[pubPrivKey] = pub;
        }
      }
    }
  }
  console.log("Publisher ETH balances and required top-ups:");
  for (const [publisherPrivKey, info] of Object.entries(publishers)) {
    const privKey = publisherPrivKey as HexString;
    const pubAddr = getAddressFromPrivateKey(privKey);
    publishers[privKey]!.currentBalance = await client.getBalance({ address: pubAddr });
    publishers[privKey]!.requiredTopUp = BigInt(Math.ceil(info.load)) * RECOMMENDED_ETH_PER_ATTESTER - info.currentBalance;
    const requiresTopUpString = publishers[privKey]!.requiredTopUp > 0n ? `❌ REQUIRES ADDITIONAL: ${formatEther(publishers[privKey]!.requiredTopUp)} ETH` : `✅`;
    console.log(`${pubAddr} - load: ${info.load}, current balance: ${formatEther(publishers[privKey]!.currentBalance)} ETH ${requiresTopUpString}`);
  }
}

export default command;
