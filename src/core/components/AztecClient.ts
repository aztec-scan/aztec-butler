import {
  createAztecNodeClient,
  type AztecNode,
  type NodeInfo,
} from "@aztec/aztec.js";

export interface AztecClientConfig {
  nodeUrl: string;
}

export class AztecClient {
  private readonly client: AztecNode;
  private readonly config: AztecClientConfig;

  constructor(config: AztecClientConfig) {
    this.config = config;
    this.client = createAztecNodeClient(config.nodeUrl);
  }

  /**
   * Get the underlying Aztec node client
   */
  getClient(): AztecNode {
    return this.client;
  }

  /**
   * Get node information
   */
  async getNodeInfo(): Promise<NodeInfo> {
    return await this.client.getNodeInfo();
  }

  /**
   * Get the node URL
   */
  getNodeUrl(): string {
    return this.config.nodeUrl;
  }
}
