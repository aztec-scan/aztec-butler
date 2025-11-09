import {
  getNodeInfo,
} from "./aztecClient.ts";
import { printLinks, init, getApproveStakeSpendCalldata, getDepositCalldata } from "./ethereumClient.ts";

// Main execution function
const main = async () => {
  console.log("📋 Fetching node info...");
  const nodeInfo = await getNodeInfo();
  console.log("✅ Node info:", {
    nodeVersion: nodeInfo.nodeVersion,
    l1ChainId: nodeInfo.l1ChainId,
    rollupVersion: nodeInfo.rollupVersion,
  });
  await init(nodeInfo);
  await printLinks(nodeInfo);
  // TODO: read BLS-key
  const attesterAddress = "0x24F18489c22544DAE85f086eed0E651216a46a3F"
  const withdrawerAddress = "0x90e7b822a5Ac10edC381aBc03d94b866e4B985A1"
  const blsSecretKey = "0x07d7cfa4db24110cdaf321edffd0c0d0a51b6b1692099519dde49d5aca4411fd";
  const approveCallData = await getApproveStakeSpendCalldata(withdrawerAddress);
  console.log("✅ Approve stake spend calldata:", approveCallData);

  const depositCalldata = await getDepositCalldata(
    attesterAddress,
    withdrawerAddress,
    blsSecretKey,
    true,
    nodeInfo,
  );
  console.log("✅ Deposit calldata:", depositCalldata);
};

// Export main function for potential reuse
export { main };

// Export all client functions for external use
export * from "./aztecClient.ts";
export * from "./ethereumClient.ts";

// Run main function if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
