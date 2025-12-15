/**
 * Host Metrics
 *
 * Prometheus metrics for tracking host connectivity and service availability
 */

import type {
  Histogram,
  ObservableGauge,
} from "@opentelemetry/api";
import {
  createHistogram,
  createObservableGauge,
} from "./registry.js";

// Status metrics (1 = up, 0 = down)
let hostDnsStatusGauge: ObservableGauge | null = null;
let hostP2PStatusGauge: ObservableGauge | null = null;
let hostRpcHttpsStatusGauge: ObservableGauge | null = null;
let hostRpcIpStatusGauge: ObservableGauge | null = null;

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

// Cache for storing status metrics for observable gauges
interface StatusCacheEntry {
  status: boolean;
  labels: Record<string, string>;
}

const dnsStatusCache = new Map<string, StatusCacheEntry>();
const p2pStatusCache = new Map<string, StatusCacheEntry>();
const rpcHttpsStatusCache = new Map<string, StatusCacheEntry>();
const rpcIpStatusCache = new Map<string, StatusCacheEntry>();

/**
 * Initialize host metrics
 */
export const initHostMetrics = () => {
  // Status metrics - using ObservableGauge to track current state (1 = up, 0 = down)
  hostDnsStatusGauge = createObservableGauge("host_dns_status", {
    description: "DNS resolution status (1 = up, 0 = down)",
  });

  hostDnsStatusGauge.addCallback((observableResult) => {
    for (const entry of dnsStatusCache.values()) {
      observableResult.observe(entry.status ? 1 : 0, entry.labels);
    }
  });

  hostP2PStatusGauge = createObservableGauge("host_p2p_status", {
    description: "P2P connection status (1 = up, 0 = down)",
  });

  hostP2PStatusGauge.addCallback((observableResult) => {
    for (const entry of p2pStatusCache.values()) {
      observableResult.observe(entry.status ? 1 : 0, entry.labels);
    }
  });

  hostRpcHttpsStatusGauge = createObservableGauge("host_rpc_https_status", {
    description: "RPC HTTPS status (1 = up, 0 = down)",
  });

  hostRpcHttpsStatusGauge.addCallback((observableResult) => {
    for (const entry of rpcHttpsStatusCache.values()) {
      observableResult.observe(entry.status ? 1 : 0, entry.labels);
    }
  });

  hostRpcIpStatusGauge = createObservableGauge("host_rpc_ip_status", {
    description: "RPC IP+port status (1 = up, 0 = down)",
  });

  hostRpcIpStatusGauge.addCallback((observableResult) => {
    for (const entry of rpcIpStatusCache.values()) {
      observableResult.observe(entry.status ? 1 : 0, entry.labels);
    }
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
  if (!hostDnsStatusGauge) return;

  const labels = {
    network,
    host,
    domain,
    expected_ip: expectedIp,
  };

  // Create unique key for this metric
  const key = `${network}:${host}:${domain}:${expectedIp}`;
  
  // Update cache - gauge callback will report current status
  dnsStatusCache.set(key, { status, labels });
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
  if (!hostP2PStatusGauge) return;

  const labels = {
    network,
    host,
    ip,
    port: port.toString(),
  };

  // Create unique key for this metric
  const key = `${network}:${host}:${ip}:${port}`;
  
  // Update cache - gauge callback will report current status
  p2pStatusCache.set(key, { status, labels });

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
  if (!hostRpcHttpsStatusGauge) return;

  const labels = {
    network,
    host,
    url,
    ...(nodeVersion ? { node_version: nodeVersion } : {}),
  };

  // Create unique key for this metric
  const key = `${network}:${host}:${url}${nodeVersion ? `:${nodeVersion}` : ''}`;
  
  // Update cache - gauge callback will report current status
  rpcHttpsStatusCache.set(key, { status, labels });

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
  if (!hostRpcIpStatusGauge) return;

  const labels = {
    network,
    host,
    ip,
    port: port.toString(),
    ...(nodeVersion ? { node_version: nodeVersion } : {}),
  };

  // Create unique key for this metric
  const key = `${network}:${host}:${ip}:${port}${nodeVersion ? `:${nodeVersion}` : ''}`;
  
  // Update cache - gauge callback will report current status
  rpcIpStatusCache.set(key, { status, labels });

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

/**
 * Clear DNS status from cache
 */
export const clearDnsStatus = (
  network: string,
  host: string,
  domain: string,
  expectedIp: string,
) => {
  const key = `${network}:${host}:${domain}:${expectedIp}`;
  dnsStatusCache.delete(key);
};

/**
 * Clear P2P status from cache
 */
export const clearP2PStatus = (
  network: string,
  host: string,
  ip: string,
  port: number,
) => {
  const key = `${network}:${host}:${ip}:${port}`;
  p2pStatusCache.delete(key);
};

/**
 * Clear RPC HTTPS status from cache
 */
export const clearRpcHttpsStatus = (
  network: string,
  host: string,
  url: string,
  nodeVersion?: string,
) => {
  const key = `${network}:${host}:${url}${nodeVersion ? `:${nodeVersion}` : ''}`;
  rpcHttpsStatusCache.delete(key);
};

/**
 * Clear RPC IP status from cache
 */
export const clearRpcIpStatus = (
  network: string,
  host: string,
  ip: string,
  port: number,
  nodeVersion?: string,
) => {
  const key = `${network}:${host}:${ip}:${port}${nodeVersion ? `:${nodeVersion}` : ''}`;
  rpcIpStatusCache.delete(key);
};

/**
 * Clear all status metrics for a specific host
 */
export const clearAllHostStatus = (network: string, host: string) => {
  // Clear all status caches for this host
  const prefix = `${network}:${host}:`;
  
  for (const key of dnsStatusCache.keys()) {
    if (key.startsWith(prefix)) {
      dnsStatusCache.delete(key);
    }
  }
  
  for (const key of p2pStatusCache.keys()) {
    if (key.startsWith(prefix)) {
      p2pStatusCache.delete(key);
    }
  }
  
  for (const key of rpcHttpsStatusCache.keys()) {
    if (key.startsWith(prefix)) {
      rpcHttpsStatusCache.delete(key);
    }
  }
  
  for (const key of rpcIpStatusCache.keys()) {
    if (key.startsWith(prefix)) {
      rpcIpStatusCache.delete(key);
    }
  }
  
  // Also clear host info
  clearHostInfo(network, host);
};
