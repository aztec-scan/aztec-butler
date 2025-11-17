import {
  createAztecNodeClient,
  type AztecNode,
  type NodeInfo,
} from "@aztec/aztec.js";
import assert from "assert";
//import { getPackageVersion } from "../utils/fileOperations.js";
//
//// --- Retrieve versions dynamically ---
//const aztecjsVersion = getPackageVersion("@aztec/aztec.js");
//const aztecL1Version = getPackageVersion("@aztec/l1-artifacts");
//const aztecEthereumVersion = getPackageVersion("@aztec/ethereum");
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL;

let client: AztecNode | undefined = undefined;

const getNodeClient = (url?: string): AztecNode => {
  if (!client) {
    if (!url) {
      throw new Error("Aztec node URL must be provided for the first initialization of the Aztec node client");
    }
    client = createNodeClient(url);
  }
  return client;
}

const createNodeClient = (url: string) => {
  return createAztecNodeClient(url);
};

export const getNodeInfo = async (url: string): Promise<NodeInfo> => {
  const node = getNodeClient(url);
  const nodeInfo = await node.getNodeInfo();
  // const nodeVersion = nodeInfo.nodeVersion;
  //  assert(nodeVersion === aztecjsVersion, `Aztec.js package version mismatch: Node version is ${nodeVersion}, but client version is ${aztecjsVersion}`);
  //  assert(nodeVersion === aztecL1Version, `Aztec L1 Artifacts package version mismatch: Node version is ${nodeVersion}, but client version is ${aztecL1Version}`);
  //  assert(nodeVersion === aztecEthereumVersion, `Aztec Ethereum package version mismatch: Node version is ${nodeVersion}, but client version is ${aztecEthereumVersion}`);
  return nodeInfo;
};
