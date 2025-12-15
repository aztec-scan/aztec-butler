/**
 * HostChecker - Component for checking host connectivity and service availability
 */

import dns from "dns/promises";
import net from "net";
import {
  CheckResult,
  DnsCheckResult,
  RpcCheckResult,
} from "../../types/index.js";

export class HostChecker {
  /**
   * Check DNS resolution
   * Verifies that base_domain resolves to the expected IP
   */
  async checkDnsResolution(
    domain: string,
    expectedIp: string,
  ): Promise<DnsCheckResult> {
    try {
      const resolvedIps = await dns.resolve4(domain);

      const success = resolvedIps.includes(expectedIp);

      return {
        success,
        resolvedIps,
        ...(success
          ? {}
          : {
              error: `Expected IP ${expectedIp} not in resolved IPs: ${resolvedIps.join(", ")}`,
            }),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check P2P TCP port connectivity
   */
  async checkP2PConnection(ip: string, port: number): Promise<CheckResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new net.Socket();
      let resolved = false;

      // Set timeout for connection attempt
      socket.setTimeout(5000);

      socket.on("connect", () => {
        if (!resolved) {
          resolved = true;
          const latency = Date.now() - startTime;
          socket.destroy();
          resolve({
            success: true,
            latency,
          });
        }
      });

      socket.on("timeout", () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve({
            success: false,
            error: "Connection timeout after 5 seconds",
          });
        }
      });

      socket.on("error", (error) => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve({
            success: false,
            error: error.message,
          });
        }
      });

      socket.connect(port, ip);
    });
  }

  /**
   * Check RPC via HTTPS URL (domain-based)
   * Uses node_getNodeInfo RPC call
   */
  async checkRpcHttps(url: string): Promise<RpcCheckResult> {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "node_getNodeInfo",
          params: [],
          id: 1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;

      if (!response.ok) {
        return {
          success: false,
          latency,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = (await response.json()) as any;

      if (data.error) {
        return {
          success: false,
          latency,
          error: `RPC error: ${data.error.message || JSON.stringify(data.error)}`,
        };
      }

      // Extract node version from result
      const nodeVersion = data.result?.nodeVersion;

      return {
        success: true,
        latency,
        nodeVersion,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      return {
        success: false,
        latency,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check RPC via IP+port (direct connection)
   * Uses node_getNodeInfo RPC call
   */
  async checkRpcIpPort(ip: string, port: number): Promise<RpcCheckResult> {
    const url = `http://${ip}:${port}`;
    return this.checkRpcHttps(url);
  }
}
