import { NodeInfo } from "@aztec/aztec.js";
import { getApproveStakeSpendCalldata, logAttestersCalldata, printImportantInfo } from "../components/ethereumClient.js";

const command = async (nodeInfo: NodeInfo) => {
  // console.log("✅ Node info:", {
  //   nodeVersion: nodeInfo.nodeVersion,
  //   l1ChainId: nodeInfo.l1ChainId,
  //   rollupVersion: nodeInfo.rollupVersion,
  // });
  // await printLinks(nodeInfo);
  // const withdrawerAddress = "0x90e7b822a5Ac10edC381aBc03d94b866e4B985A1"
  // const keystoreData = await getRelevantKeystoreData();
  // const approveCallData = await getApproveStakeSpendCalldata(withdrawerAddress, keystoreData.length);
  // console.log("✅ Approve stake spend calldata:", approveCallData);
  // await logAttestersCalldata(
  //   //keystoreData,
  //   withdrawerAddress,
  //   nodeInfo
  // )
};

export default command;
