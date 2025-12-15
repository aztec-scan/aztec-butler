/**
 * Host Metrics
 *
 * Prometheus metrics for tracking host connectivity and service availability
 */

import type {
  UpDownCounter,
  Histogram,
  ObservableGauge,
} from "@opentelemetry/api";
import {
  createUpDownCounter,
  createHistogram,
  createObservableGauge,
} from "./registry.js";

// Status metrics (1 = up, 0 = down)
let hostDnsStatusCounter: UpDownCounter | null = null;
let hostP2PStatusCounter: UpDownCounter | null = null;
let hostRpcHttpsStatusCounter: UpDownCounter | null = null;
let hostRpcIpStatusCounter: UpDownCounter | null = null;

// Latency metrics (in milliseconds)
let hostP2PLatencyHistogram: Histogram | null = null;
let hostRpcHttpsLatencyHistogram: Histogram | null = null;
let hostRpcIpLatencyHistogram: Histogram | null = null;

// Info metric
let hostInfoGauge: ObservableGauge | null = null;

// Cache for storing host info for observable gauge
const hostInfoCache = new Map<
  string,
  {
    host: string;
    ip: string;
    base_domain?: string;
    node_version?: string;
    network: string;
  }
>();

/**
 * Initialize host metrics
 */
export const initHostMetrics = () => {
  // Status metrics - using UpDownCounter to track current state (1 = up, 0 = down)
  hostDnsStatusCounter = createUpDownCounter("host_dns_status", {
    description: "DNS resolution status (1 = up, 0 = down)",
  });

  hostP2PStatusCounter = createUpDownCounter("host_p2p_status", {
    description: "P2P connection status (1 = up, 0 = down)",
  });

  hostRpcHttpsStatusCounter = createUpDownCounter("host_rpc_https_status", {
    description: "RPC HTTPS status (1 = up, 0 = down)",
  });

  hostRpcIpStatusCounter = createUpDownCounter("host_rpc_ip_status", {
    description: "RPC IP+port status (1 = up, 0 = down)",
  });

  // Latency metrics - using Histogram for distribution analysis
  hostP2PLatencyHistogram = createHistogram("host_p2p_latency_ms", {
    description: "P2P connection latency in milliseconds",
    unit: "ms",
  });

  hostRpcHttpsLatencyHistogram = createHistogram("host_rpc_https_latency_ms", {
    description: "RPC HTTPS latency in milliseconds",
    unit: "ms",
  });

  hostRpcIpLatencyHistogram = createHistogram("host_rpc_ip_latency_ms", {
    description: "RPC IP+port latency in milliseconds",
    unit: "ms",
  });

  // Info metric - observable gauge for static information
  hostInfoGauge = createObservableGauge("host_info", {
    description: "Host information (always 1)",
  });

  hostInfoGauge.addCallback((observableResult) => {
    for (const info of hostInfoCache.values()) {
      const labels: Record<string, string> = {
        network: info.network,
        host: info.host,
        ip: info.ip,
      };
      if (info.base_domain) {
        labels.base_domain = info.base_domain;
      }
      if (info.node_version) {
        labels.node_version = info.node_version;
      }
      observableResult.observe(1, labels);
    }
  });

  console.log("Host metrics initialized successfully");
};

/**
 * Update DNS status metric
 */
export const updateDnsStatus = (
  network: string,
  host: string,
  domain: string,
  expectedIp: string,
  status: boolean,
) => {
  if (!hostDnsStatusCounter) return;

  const labels = {
    network,
    host,
    domain,
    expected_ip: expectedIp,
  };

  // Set to 1 if up, 0 if down
  // We need to manage the state ourselves by tracking previous values
  hostDnsStatusCounter.add(status ? 1 : 0, labels);
};

/**
 * Update P2P status and latency metrics
 */
export const updateP2PStatus = (
  network: string,
  host: string,
  ip: string,
  port: number,
  status: boolean,
  latency?: number,
) => {
  if (!hostP2PStatusCounter) return;

  const labels = {
    network,
    host,
    ip,
    port: port.toString(),
  };

  // Update status
  hostP2PStatusCounter.add(status ? 1 : 0, labels);

  // Update latency if available
  if (status && latency !== undefined && hostP2PLatencyHistogram) {
    hostP2PLatencyHistogram.record(latency, labels);
  }
};

/**
 * Update RPC HTTPS status and latency metrics
 */
export const updateRpcHttpsStatus = (
  network: string,
  host: string,
  url: string,
  status: boolean,
  latency?: number,
  nodeVersion?: string,
) => {
  if (!hostRpcHttpsStatusCounter) return;

  const labels = {
    network,
    host,
    url,
    ...(nodeVersion ? { node_version: nodeVersion } : {}),
  };

  // Update status
  hostRpcHttpsStatusCounter.add(status ? 1 : 0, labels);

  // Update latency if available
  if (status && latency !== undefined && hostRpcHttpsLatencyHistogram) {
    hostRpcHttpsLatencyHistogram.record(latency, labels);
  }
};

/**
 * Update RPC IP+port status and latency metrics
 */
export const updateRpcIpStatus = (
  network: string,
  host: string,
  ip: string,
  port: number,
  status: boolean,
  latency?: number,
  nodeVersion?: string,
) => {
  if (!hostRpcIpStatusCounter) return;

  const labels = {
    network,
    host,
    ip,
    port: port.toString(),
    ...(nodeVersion ? { node_version: nodeVersion } : {}),
  };

  // Update status
  hostRpcIpStatusCounter.add(status ? 1 : 0, labels);

  // Update latency if available
  if (status && latency !== undefined && hostRpcIpLatencyHistogram) {
    hostRpcIpLatencyHistogram.record(latency, labels);
  }
};

/**
 * Update host info cache for observable gauge
 */
export const updateHostInfo = (
  network: string,
  host: string,
  ip: string,
  baseDomain?: string,
  nodeVersion?: string,
) => {
  const key = `${network}:${host}`;
  const info: {
    host: string;
    ip: string;
    base_domain?: string;
    node_version?: string;
    network: string;
  } = {
    network,
    host,
    ip,
  };
  if (baseDomain) {
    info.base_domain = baseDomain;
  }
  if (nodeVersion) {
    info.node_version = nodeVersion;
  }
  hostInfoCache.set(key, info);
};

/**
 * Clear host info from cache
 */
export const clearHostInfo = (network: string, host: string) => {
  const key = `${network}:${host}`;
  hostInfoCache.delete(key);
};
