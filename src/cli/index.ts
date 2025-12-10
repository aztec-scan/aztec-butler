import * as command from "./commands/index.js";
import { AztecClient } from "../core/components/AztecClient.js";
import { EthereumClient } from "../core/components/EthereumClient.js";
import { initConfig } from "../core/config/index.js";
import {
  ATTESTER_REGISTRATIONS_DIR_NAME,
  getDockerDirData,
} from "../core/utils/fileOperations.js";

export const runCli = async () => {
  const config = await initConfig();
  if (!config.AZTEC_DOCKER_DIR) {
    throw new Error("AZTEC_DOCKER_DIR must be configured for CLI mode");
  }
  const data = await getDockerDirData(config.AZTEC_DOCKER_DIR);
  if (config.AZTEC_NODE_URL !== data.l2RpcUrl) {
    console.warn(
      `⚠️ Warning: AZTEC_NODE_URL in config (${config.AZTEC_NODE_URL}) does not match L2 RPC URL in docker dir (${data.l2RpcUrl}`,
    );
  }

  // Initialize Aztec client
  const aztecClient = new AztecClient({
    nodeUrl: config.AZTEC_NODE_URL,
  });
  const nodeInfo = await aztecClient.getNodeInfo();
  console.log(
    "✅ Retrieved Aztec node info:",
    JSON.stringify(nodeInfo, null, 2),
  );

  if (config.ETHEREUM_NODE_URL !== data.l1RpcUrl) {
    console.warn(
      `⚠️ Warning: ETHEREUM_NODE_URL in config (${config.ETHEREUM_NODE_URL}) does not match L1 RPC URL in docker dir (${data.l1RpcUrl})`,
    );
  }

  // Initialize Ethereum client
  const ethClient = new EthereumClient({
    rpcUrl: config.ETHEREUM_NODE_URL,
    ...(config.ETHEREUM_ARCHIVE_NODE_URL
      ? { archiveRpcUrl: config.ETHEREUM_ARCHIVE_NODE_URL }
      : {}),
    chainId: nodeInfo.l1ChainId,
    rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress.toString(),
  });

  await ethClient.verifyChainId();
  await ethClient.printImportantInfo();

  // Pass clients to commands (old interface - uses DirData for backwards compatibility)
  await command.getPublisherEth(ethClient, {
    keystorePaths: data.keystores.map((k) => k.path),
  });
  data.attesterRegistrations =
    await command.writeAttesterAttesterRegistrationData(
      ethClient,
      data,
      `${config.AZTEC_DOCKER_DIR}/${ATTESTER_REGISTRATIONS_DIR_NAME}`,
    );
  for (const attesterReg of data.attesterRegistrations) {
    console.log(`✅ Attester registration data: ${attesterReg.path}`);
  }
  await command.getCreateStakingProviderCallData(
    ethClient,
    data,
    config.PROVIDER_ADMIN_ADDRESS,
  );

  // Note: The old getAddKeysToStakingProviderCalldata used DirData with attesterRegistrations
  // The new version uses keystorePaths directly. For the "cli" mode, we still support
  // the old workflow with attester-registrations directory
  if (data.attesterRegistrations.length > 0) {
    console.log(
      "\n⚠️  Note: To use the new keystore-based workflow, run commands individually:",
    );
    console.log(
      "    get-add-keys-to-staking-provider-calldata --keystore <path>",
    );
  }
};
