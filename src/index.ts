import "dotenv/config";
import * as command from "./commands/index.js";
import { getNodeInfo } from "./components/aztecClient.js";
import { init, printImportantInfo } from "./components/ethereumClient.js";
import { ATTESTER_REGISTRATIONS_DIR_NAME, getDockerDirData } from "./utils/fileOperations.js";

const AZTEC_DOCKER_DIR = process.env.AZTEC_DOCKER_DIR || process.cwd();
const ETHEREUM_NODE_URL = process.env.ETHEREUM_NODE_URL;
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL;
const PROVIDER_ADMIN_ADDRESS = "0x90e7b822a5Ac10edC381aBc03d94b866e4B985A1"

const main = async () => {
  const data = await getDockerDirData(AZTEC_DOCKER_DIR);
  const l2RpcUrl = AZTEC_NODE_URL || data.l2RpcUrl || "http://localhost:8080";
  const nodeInfo = await getNodeInfo(l2RpcUrl);
  console.log("✅ Retrieved Aztec node info:", JSON.stringify(nodeInfo, null, 2));
  const l1RpcUrl = ETHEREUM_NODE_URL || data.l1RpcUrl || "http://localhost:8545";
  await init(nodeInfo, l1RpcUrl);
  await printImportantInfo(nodeInfo);
  await command.getPublisherEth(nodeInfo, data);
  data.attesterRegistrations = await command.writeAttesterAttesterRegistrationData(nodeInfo, data, `${AZTEC_DOCKER_DIR}/${ATTESTER_REGISTRATIONS_DIR_NAME}`);
  for (const attesterReg of data.attesterRegistrations) {
    console.log(`✅ Attester registration data: ${attesterReg.path}`);
  }
  await command.getCreateProviderCallData(nodeInfo, data, PROVIDER_ADMIN_ADDRESS);
};

// Export main function for potential reuse
export { main };

// Run main function if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
