import {
  createAztecNodeClient,
  type AztecNode,
  type NodeInfo,
} from "@aztec/aztec.js";
import assert from "assert";
import "dotenv/config";
import { getPackageVersion } from "./fileUtils.js";

// --- Retrieve versions dynamically ---
const aztecjsVersion = getPackageVersion("@aztec/aztec.js");
const aztecL1Version = getPackageVersion("@aztec/l1-artifacts");
const aztecEthereumVersion = getPackageVersion("@aztec/ethereum");
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL;

let client: AztecNode | undefined = undefined;
const getNodeClient = (): AztecNode => {
  if (!client) {
    client = createNodeClient();
  }
  return client;
}

const createNodeClient = () => {
  if (!AZTEC_NODE_URL) {
    throw new Error("AZTEC_NODE_URL is not defined in environment variables");
  }
  return createAztecNodeClient(AZTEC_NODE_URL);
};

export const getNodeInfo = async (): Promise<NodeInfo> => {
  const node = getNodeClient();
  const nodeInfo = await node.getNodeInfo();
  const nodeVersion = nodeInfo.nodeVersion;
  assert(nodeVersion === aztecjsVersion, `Aztec.js package version mismatch: Node version is ${nodeVersion}, but client version is ${aztecjsVersion}`);
  assert(nodeVersion === aztecL1Version, `Aztec L1 Artifacts package version mismatch: Node version is ${nodeVersion}, but client version is ${aztecL1Version}`);
  assert(nodeVersion === aztecEthereumVersion, `Aztec Ethereum package version mismatch: Node version is ${nodeVersion}, but client version is ${aztecEthereumVersion}`);
  return nodeInfo;
};
