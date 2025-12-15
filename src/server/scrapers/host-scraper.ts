/**
 * HostScraper - Scrapes host connectivity and service availability
 * and updates Prometheus metrics
 */

import { AbstractScraper } from "./base-scraper.js";
import { HostChecker } from "../../core/components/HostChecker.js";
import type { MainnetHostsConfig } from "../../types/index.js";
import {
  updateDnsStatus,
  updateP2PStatus,
  updateRpcHttpsStatus,
  updateRpcIpStatus,
  updateHostInfo,
} from "../metrics/host-metrics.js";
import fs from "fs/promises";
import path from "path";
import envPaths from "env-paths";
import { PACKAGE_NAME } from "../../core/config/index.js";

export class HostScraper extends AbstractScraper {
  readonly name = "host";
  readonly network: string;

  private hostChecker: HostChecker;
  private hostsConfig: MainnetHostsConfig | null = null;
  private configPath: string;

  constructor(network: string) {
    super();
    this.network = network;
    this.hostChecker = new HostChecker();

    // Get config directory
    const configDir = envPaths(PACKAGE_NAME, { suffix: "" }).config;
    this.configPath = path.join(configDir, `${network}-hosts.json`);
  }

  async init(): Promise<void> {
    // Load hosts configuration
    try {
      const configContent = await fs.readFile(this.configPath, "utf-8");
      this.hostsConfig = JSON.parse(configContent) as MainnetHostsConfig;
      console.log(
        `[${this.name}] Loaded hosts config from ${this.configPath} with ${Object.keys(this.hostsConfig).length} host(s)`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        console.warn(
          `[${this.name}] No hosts config found at ${this.configPath}. Host scraper will be idle.`,
        );
        this.hostsConfig = {};
      } else {
        throw new Error(
          `[${this.name}] Failed to load hosts config: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async scrape(): Promise<void> {
    if (!this.hostsConfig || Object.keys(this.hostsConfig).length === 0) {
      // No hosts configured, skip scraping
      return;
    }

    try {
      // Run checks for all hosts
      const hostNames = Object.keys(this.hostsConfig);

      for (const hostname of hostNames) {
        const hostConfig = this.hostsConfig[hostname];
        if (!hostConfig) continue;

        await this.checkHost(hostname, hostConfig);
      }

      console.log(`[${this.name}] Scraped ${hostNames.length} host(s)`);
    } catch (error) {
      console.error(`[${this.name}] Error during scrape:`, error);
      throw error;
    }
  }

  /**
   * Run all checks for a single host and update metrics
   */
  private async checkHost(
    hostname: string,
    hostConfig: MainnetHostsConfig[string],
  ): Promise<void> {
    const { ip, base_domain, services } = hostConfig;

    // Track node version from any successful RPC check
    let detectedNodeVersion: string | undefined;

    // 1. DNS Resolution Check
    if (base_domain) {
      const dnsResult = await this.hostChecker.checkDnsResolution(
        base_domain,
        ip,
      );
      updateDnsStatus(
        this.network,
        hostname,
        base_domain,
        ip,
        dnsResult.success,
      );

      if (!dnsResult.success) {
        console.warn(
          `[${this.name}] DNS check failed for ${hostname} (${base_domain}): ${dnsResult.error}`,
        );
      }
    }

    // 2. P2P Connection Check
    if (services.p2p) {
      const p2pResult = await this.hostChecker.checkP2PConnection(
        ip,
        services.p2p.port,
      );
      updateP2PStatus(
        this.network,
        hostname,
        ip,
        services.p2p.port,
        p2pResult.success,
        p2pResult.latency,
      );

      if (!p2pResult.success) {
        console.warn(
          `[${this.name}] P2P check failed for ${hostname} (${ip}:${services.p2p.port}): ${p2pResult.error}`,
        );
      }
    }

    // 3. Aztec RPC Checks
    if (services.aztec_rpc) {
      // HTTPS check (if subdomain is configured)
      if (services.aztec_rpc.subdomain && base_domain) {
        const httpsUrl = `https://${services.aztec_rpc.subdomain}.${base_domain}`;
        const httpsResult = await this.hostChecker.checkRpcHttps(httpsUrl);
        updateRpcHttpsStatus(
          this.network,
          hostname,
          httpsUrl,
          httpsResult.success,
          httpsResult.latency,
          httpsResult.nodeVersion,
        );

        if (httpsResult.success && httpsResult.nodeVersion) {
          detectedNodeVersion = httpsResult.nodeVersion;
        }

        if (!httpsResult.success) {
          console.warn(
            `[${this.name}] RPC HTTPS check failed for ${hostname} (${httpsUrl}): ${httpsResult.error}`,
          );
        }
      }

      // IP+Port check
      const ipPortResult = await this.hostChecker.checkRpcIpPort(
        ip,
        services.aztec_rpc.port,
      );
      updateRpcIpStatus(
        this.network,
        hostname,
        ip,
        services.aztec_rpc.port,
        ipPortResult.success,
        ipPortResult.latency,
        ipPortResult.nodeVersion,
      );

      if (ipPortResult.success && ipPortResult.nodeVersion) {
        detectedNodeVersion = ipPortResult.nodeVersion;
      }

      if (!ipPortResult.success) {
        console.warn(
          `[${this.name}] RPC IP check failed for ${hostname} (${ip}:${services.aztec_rpc.port}): ${ipPortResult.error}`,
        );
      }
    }

    // 4. Ethereum RPC Checks (if configured)
    if (services.ethereum) {
      // HTTPS check (if subdomain is configured)
      if (services.ethereum.subdomain && base_domain) {
        const httpsUrl = `https://${services.ethereum.subdomain}.${base_domain}`;
        const httpsResult = await this.hostChecker.checkRpcHttps(httpsUrl);
        updateRpcHttpsStatus(
          this.network,
          hostname,
          httpsUrl,
          httpsResult.success,
          httpsResult.latency,
          httpsResult.nodeVersion,
        );

        if (!httpsResult.success) {
          console.warn(
            `[${this.name}] Ethereum HTTPS check failed for ${hostname} (${httpsUrl}): ${httpsResult.error}`,
          );
        }
      }

      // IP+Port check
      const ipPortResult = await this.hostChecker.checkRpcIpPort(
        ip,
        services.ethereum.port,
      );
      updateRpcIpStatus(
        this.network,
        hostname,
        ip,
        services.ethereum.port,
        ipPortResult.success,
        ipPortResult.latency,
        ipPortResult.nodeVersion,
      );

      if (!ipPortResult.success) {
        console.warn(
          `[${this.name}] Ethereum IP check failed for ${hostname} (${ip}:${services.ethereum.port}): ${ipPortResult.error}`,
        );
      }
    }

    // Update host info metric
    updateHostInfo(
      this.network,
      hostname,
      ip,
      base_domain,
      detectedNodeVersion,
    );
  }

  async shutdown(): Promise<void> {
    console.log(`[${this.name}] Shutting down...`);
    this.hostsConfig = null;
  }
}
