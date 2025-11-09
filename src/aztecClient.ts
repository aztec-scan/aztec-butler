import {
  createAztecNodeClient,
  type AztecNode,
  type NodeInfo,
} from "@aztec/aztec.js";
import assert from "assert";
import "dotenv/config";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
const require = createRequire(import.meta.url);

// --- Helper to get package version safely ---
function getPackageVersion(pkgName: string): string {
  try {
    // 1️⃣ Find the main entry of the package
    const entryPath = require.resolve(pkgName);

    // 2️⃣ Walk up to find its nearest package.json
    let dir = path.dirname(entryPath);
    while (dir !== path.parse(dir).root) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
        return pkg.version;
      }
      dir = path.dirname(dir);
    }

    throw new Error(`No package.json found for ${pkgName}`);
  } catch (err) {
    console.warn(`⚠️ Could not resolve version for package "${pkgName}":`, err);
    return "unknown";
  }
}

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
