import * as command from "./commands/index.js";
import { getNodeInfo } from "../core/components/aztecClient.js";
import { init, printImportantInfo } from "../core/components/ethereumClient.js";
import { initConfig } from "../core/config/index.js";
import {
  ATTESTER_REGISTRATIONS_DIR_NAME,
  getDockerDirData,
} from "../core/utils/fileOperations.js";

export const runCli = async () => {
  const config = await initConfig();
  const data = await getDockerDirData(config.AZTEC_DOCKER_DIR);
  if (config.AZTEC_NODE_URL !== data.l2RpcUrl) {
    console.warn(
      `⚠️ Warning: AZTEC_NODE_URL in config (${config.AZTEC_NODE_URL}) does not match L2 RPC URL in docker dir (${data.l2RpcUrl}`,
    );
  }
  const nodeInfo = await getNodeInfo(config.AZTEC_NODE_URL);
  console.log(
    "✅ Retrieved Aztec node info:",
    JSON.stringify(nodeInfo, null, 2),
  );
  if (config.ETHEREUM_NODE_URL !== data.l1RpcUrl) {
    console.warn(
      `⚠️ Warning: ETHEREUM_NODE_URL in config (${config.ETHEREUM_NODE_URL}) does not match L1 RPC URL in docker dir (${data.l1RpcUrl})`,
    );
  }
  const l1ChainId = nodeInfo.l1ChainId;
  const rollupAddress = nodeInfo.l1ContractAddresses.rollupAddress;
  await init(config.ETHEREUM_NODE_URL, l1ChainId, rollupAddress.toString());
  await printImportantInfo(l1ChainId);
  await command.getPublisherEth(l1ChainId, data);
  data.attesterRegistrations =
    await command.writeAttesterAttesterRegistrationData(
      l1ChainId,
      data,
      `${config.AZTEC_DOCKER_DIR}/${ATTESTER_REGISTRATIONS_DIR_NAME}`,
    );
  for (const attesterReg of data.attesterRegistrations) {
    console.log(`✅ Attester registration data: ${attesterReg.path}`);
  }
  await command.getCreateProviderCallData(
    l1ChainId,
    data,
    config.PROVIDER_ADMIN_ADDRESS,
  );
  await command.getAddKeysToProviderCalldata(
    l1ChainId,
    data,
    config.PROVIDER_ADMIN_ADDRESS,
  );
};
