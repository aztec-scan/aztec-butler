import {
  getNodeInfo,
} from "./aztecClient.ts";
import { getApproveStakeSpendCalldata, init, logAttestersCalldata, printLinks } from "./ethereumClient.ts";
import { getRelevantKeystoreData } from "./fileUtils.ts";

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
  const withdrawerAddress = "0x90e7b822a5Ac10edC381aBc03d94b866e4B985A1"
  const keystoreData = getRelevantKeystoreData();
  const approveCallData = await getApproveStakeSpendCalldata(withdrawerAddress, keystoreData.length);
  console.log("✅ Approve stake spend calldata:", approveCallData);
  await logAttestersCalldata(
    keystoreData,
    withdrawerAddress,
    nodeInfo
  )
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
