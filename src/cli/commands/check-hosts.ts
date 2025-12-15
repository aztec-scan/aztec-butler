/**
 * CLI Command: Check Hosts
 *
 * Check host connection status and service availability
 */

import { readFile } from "fs/promises";
import { join } from "path";
import envPath from "env-paths";
import type { ButlerConfig } from "../../core/config/index.js";
import { HostChecker } from "../../core/components/HostChecker.js";
import type {
  MainnetHostsConfig,
  HostCheckResults,
  HostCheckResult,
  DnsCheck,
  P2PCheck,
  RpcEndpointCheck,
  ServiceChecks,
} from "../../types/index.js";

interface CheckHostsOptions {
  configPath?: string;
  host?: string;
  check?: "dns" | "p2p" | "rpc" | "all";
  json?: boolean;
}

const command = async (config: ButlerConfig, options: CheckHostsOptions) => {
  // Load hosts configuration from standard config directory
  const configDir = envPath("aztec-butler", { suffix: "" }).config;
  const defaultConfigPath = join(configDir, `${config.NETWORK}-hosts.json`);
  const configPath = options.configPath || defaultConfigPath;

  let hostsConfig: MainnetHostsConfig;
  try {
    const configContent = await readFile(configPath, "utf-8");
    hostsConfig = JSON.parse(configContent);
  } catch (error) {
    console.error(`❌ Failed to load hosts config from ${configPath}:`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Filter to specific host if requested
  const hostnames = options.host ? [options.host] : Object.keys(hostsConfig);

  if (options.host && !hostsConfig[options.host]) {
    console.error(`❌ Host "${options.host}" not found in config`);
    process.exit(1);
  }

  const checker = new HostChecker();
  const results: HostCheckResults = {
    timestamp: new Date().toISOString(),
    results: {},
    summary: {
      total_checks: 0,
      passed: 0,
      failed: 0,
    },
  };

  if (!options.json) {
    console.log(`Checking hosts from ${configPath}...\n`);
  }

  // Perform checks for each host
  for (const hostname of hostnames) {
    const hostConfig = hostsConfig[hostname]!;
    const hostResult: HostCheckResult = {
      ip: hostConfig.ip,
      ...(hostConfig.base_domain
        ? { base_domain: hostConfig.base_domain }
        : {}),
    };

    const checkDns =
      !options.check || options.check === "dns" || options.check === "all";
    const checkP2p =
      !options.check || options.check === "p2p" || options.check === "all";
    const checkRpc =
      !options.check || options.check === "rpc" || options.check === "all";

    if (!options.json) {
      console.log(`${hostname} (${hostConfig.ip})`);
    }

    // DNS Resolution Check
    if (checkDns && hostConfig.base_domain) {
      if (!options.json) {
        console.log("  DNS Resolution");
      }

      const dnsResult = await checker.checkDnsResolution(
        hostConfig.base_domain,
        hostConfig.ip,
      );

      const dnsCheck: DnsCheck = {
        success: dnsResult.success,
        domain: hostConfig.base_domain,
        ...(dnsResult.resolvedIps
          ? { resolvedIps: dnsResult.resolvedIps }
          : {}),
        ...(dnsResult.error ? { error: dnsResult.error } : {}),
      };

      hostResult.dns = dnsCheck;
      results.summary.total_checks++;
      if (dnsResult.success) {
        results.summary.passed++;
        if (!options.json) {
          console.log(
            `    ✓ ${hostConfig.base_domain} → ${hostConfig.ip} - OK`,
          );
        }
      } else {
        results.summary.failed++;
        if (!options.json) {
          console.log(
            `    ✗ ${hostConfig.base_domain} - FAILED: ${dnsResult.error}`,
          );
        }
      }

      if (!options.json) {
        console.log();
      }
    }

    // P2P Connection Check
    if (checkP2p && hostConfig.services.p2p) {
      if (!options.json) {
        console.log("  P2P Connection");
      }

      const p2pResult = await checker.checkP2PConnection(
        hostConfig.ip,
        hostConfig.services.p2p.port,
      );

      const endpoint = `${hostConfig.ip}:${hostConfig.services.p2p.port}`;
      const p2pCheck: P2PCheck = {
        success: p2pResult.success,
        endpoint,
        ...(p2pResult.latency !== undefined
          ? { latency: p2pResult.latency }
          : {}),
        ...(p2pResult.error ? { error: p2pResult.error } : {}),
      };

      hostResult.p2p = p2pCheck;
      results.summary.total_checks++;
      if (p2pResult.success) {
        results.summary.passed++;
        if (!options.json) {
          console.log(`    ✓ ${endpoint} - OK (${p2pResult.latency}ms)`);
        }
      } else {
        results.summary.failed++;
        if (!options.json) {
          console.log(`    ✗ ${endpoint} - FAILED: ${p2pResult.error}`);
        }
      }

      if (!options.json) {
        console.log();
      }
    }

    // Aztec RPC Check
    if (checkRpc && hostConfig.services.aztec_rpc) {
      if (!options.json) {
        console.log("  Aztec RPC");
      }

      const rpcService = hostConfig.services.aztec_rpc;
      const serviceChecks: ServiceChecks = {};

      // Check HTTPS URL if subdomain is configured
      if (rpcService.subdomain && hostConfig.base_domain) {
        const httpsUrl = `https://${rpcService.subdomain}.${hostConfig.base_domain}`;
        const httpsResult = await checker.checkRpcHttps(httpsUrl);

        const httpsCheck: RpcEndpointCheck = {
          success: httpsResult.success,
          endpoint: httpsUrl,
          ...(httpsResult.latency !== undefined
            ? { latency: httpsResult.latency }
            : {}),
          ...(httpsResult.nodeVersion
            ? { nodeVersion: httpsResult.nodeVersion }
            : {}),
          ...(httpsResult.error ? { error: httpsResult.error } : {}),
        };

        serviceChecks.https = httpsCheck;
        results.summary.total_checks++;
        if (httpsResult.success) {
          results.summary.passed++;
          if (!options.json) {
            console.log(
              `    ✓ ${httpsUrl} - OK (${httpsResult.latency}ms)${httpsResult.nodeVersion ? ` [${httpsResult.nodeVersion}]` : ""}`,
            );
          }
        } else {
          results.summary.failed++;
          if (!options.json) {
            console.log(`    ✗ ${httpsUrl} - FAILED: ${httpsResult.error}`);
          }
        }
      }

      // Check IP+port
      const ipPortResult = await checker.checkRpcIpPort(
        hostConfig.ip,
        rpcService.port,
      );

      const endpoint = `${hostConfig.ip}:${rpcService.port}`;
      const ipPortCheck: RpcEndpointCheck = {
        success: ipPortResult.success,
        endpoint,
        ...(ipPortResult.latency !== undefined
          ? { latency: ipPortResult.latency }
          : {}),
        ...(ipPortResult.nodeVersion
          ? { nodeVersion: ipPortResult.nodeVersion }
          : {}),
        ...(ipPortResult.error ? { error: ipPortResult.error } : {}),
      };

      serviceChecks.ip_port = ipPortCheck;
      results.summary.total_checks++;
      if (ipPortResult.success) {
        results.summary.passed++;
        if (!options.json) {
          console.log(
            `    ✓ ${endpoint} - OK (${ipPortResult.latency}ms)${ipPortResult.nodeVersion ? ` [${ipPortResult.nodeVersion}]` : ""}`,
          );
        }
      } else {
        results.summary.failed++;
        if (!options.json) {
          console.log(`    ✗ ${endpoint} - FAILED: ${ipPortResult.error}`);
        }
      }

      hostResult.aztec_rpc = serviceChecks;

      if (!options.json) {
        console.log();
      }
    }

    // Ethereum RPC Check (similar to Aztec RPC)
    if (checkRpc && hostConfig.services.ethereum) {
      if (!options.json) {
        console.log("  Ethereum RPC");
      }

      const rpcService = hostConfig.services.ethereum;
      const serviceChecks: ServiceChecks = {};

      // Check HTTPS URL if subdomain is configured
      if (rpcService.subdomain && hostConfig.base_domain) {
        const httpsUrl = `https://${rpcService.subdomain}.${hostConfig.base_domain}`;
        const httpsResult = await checker.checkRpcHttps(httpsUrl);

        const httpsCheck: RpcEndpointCheck = {
          success: httpsResult.success,
          endpoint: httpsUrl,
          ...(httpsResult.latency !== undefined
            ? { latency: httpsResult.latency }
            : {}),
          ...(httpsResult.nodeVersion
            ? { nodeVersion: httpsResult.nodeVersion }
            : {}),
          ...(httpsResult.error ? { error: httpsResult.error } : {}),
        };

        serviceChecks.https = httpsCheck;
        results.summary.total_checks++;
        if (httpsResult.success) {
          results.summary.passed++;
          if (!options.json) {
            console.log(
              `    ✓ ${httpsUrl} - OK (${httpsResult.latency}ms)${httpsResult.nodeVersion ? ` [${httpsResult.nodeVersion}]` : ""}`,
            );
          }
        } else {
          results.summary.failed++;
          if (!options.json) {
            console.log(`    ✗ ${httpsUrl} - FAILED: ${httpsResult.error}`);
          }
        }
      }

      // Check IP+port
      const ipPortResult = await checker.checkRpcIpPort(
        hostConfig.ip,
        rpcService.port,
      );

      const endpoint = `${hostConfig.ip}:${rpcService.port}`;
      const ipPortCheck: RpcEndpointCheck = {
        success: ipPortResult.success,
        endpoint,
        ...(ipPortResult.latency !== undefined
          ? { latency: ipPortResult.latency }
          : {}),
        ...(ipPortResult.nodeVersion
          ? { nodeVersion: ipPortResult.nodeVersion }
          : {}),
        ...(ipPortResult.error ? { error: ipPortResult.error } : {}),
      };

      serviceChecks.ip_port = ipPortCheck;
      results.summary.total_checks++;
      if (ipPortResult.success) {
        results.summary.passed++;
        if (!options.json) {
          console.log(
            `    ✓ ${endpoint} - OK (${ipPortResult.latency}ms)${ipPortResult.nodeVersion ? ` [${ipPortResult.nodeVersion}]` : ""}`,
          );
        }
      } else {
        results.summary.failed++;
        if (!options.json) {
          console.log(`    ✗ ${endpoint} - FAILED: ${ipPortResult.error}`);
        }
      }

      hostResult.ethereum = serviceChecks;

      if (!options.json) {
        console.log();
      }
    }

    results.results[hostname] = hostResult;
  }

  // Output summary or JSON
  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(
      `Summary: ${results.summary.passed}/${results.summary.total_checks} checks passed`,
    );
  }

  // Exit with error if any checks failed
  if (results.summary.failed > 0) {
    process.exit(1);
  }
};

export default command;
