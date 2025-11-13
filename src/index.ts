import { getNodeInfo } from "./components/aztecClient.js";
import { init, printImportantInfo, printPublisherETH } from "./components/ethereumClient.js";
import { getDockerDirData } from "./utils/fileOperations.js";
import "dotenv/config";

const AZTEC_DOCKER_DIR = process.env.AZTEC_DOCKER_DIR || process.cwd();
const ETHEREUM_NODE_URL = process.env.ETHEREUM_NODE_URL;
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL;

const main = async () => {
  const data = await getDockerDirData(AZTEC_DOCKER_DIR);
  const l2RpcUrl = AZTEC_NODE_URL || data.l2RpcUrl || "localhost:8080";
  const nodeInfo = await getNodeInfo(l2RpcUrl);
  console.log("✅ Retrieved Aztec node info:", JSON.stringify(nodeInfo, null, 2));
  const l1RpcUrl = ETHEREUM_NODE_URL || data.l1RpcUrl || "http://localhost:8545";
  await init(nodeInfo, l1RpcUrl);
  await printImportantInfo(nodeInfo);
  await printPublisherETH(nodeInfo, data);
  // run command(s)
};

// Export main function for potential reuse
export { main };

// Run main function if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
