import {
  NodeInfoRpcResponseSchema,
  type NodeInfo,
} from "../../types/aztec-node.js";

export interface AztecClientConfig {
  nodeUrl: string;
}

export class AztecClient {
  private readonly config: AztecClientConfig;

  constructor(config: AztecClientConfig) {
    this.config = config;
  }

  /**
   * Get node information via the `node_getNodeInfo` JSON-RPC call.
   *
   * Replaces the previous `@aztec/aztec.js` SDK dependency with a direct
   * HTTP request + Zod validation, so the butler works against any Aztec
   * node version (mainnet, testnet, devnet).
   */
  async getNodeInfo(): Promise<NodeInfo> {
    const response = await fetch(this.config.nodeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "node_getNodeInfo",
        params: [],
        id: 1,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `node_getNodeInfo HTTP error: ${response.status} ${response.statusText}`,
      );
    }

    const json: unknown = await response.json();
    const parsed = NodeInfoRpcResponseSchema.parse(json);
    return parsed.result;
  }

  /**
   * Get the node URL
   */
  getNodeUrl(): string {
    return this.config.nodeUrl;
  }
}
