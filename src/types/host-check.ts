/**
 * Host configuration and check result types
 */

export interface HostServices {
  p2p?: {
    port: number;
  };
  aztec_rpc?: {
    port: number;
    subdomain?: string;
  };
  ethereum?: {
    port: number;
    subdomain?: string;
  };
}

export interface HostConfig {
  ip: string;
  base_domain?: string;
  services: HostServices;
}

export interface MainnetHostsConfig {
  [hostname: string]: HostConfig;
}

export interface CheckResult {
  success: boolean;
  latency?: number;
  error?: string;
}

export interface DnsCheckResult {
  success: boolean;
  resolvedIps?: string[];
  error?: string;
}

export interface RpcCheckResult extends CheckResult {
  nodeVersion?: string;
}

export interface DnsCheck {
  success: boolean;
  resolvedIps?: string[];
  domain: string;
  error?: string;
}

export interface P2PCheck {
  success: boolean;
  latency?: number;
  endpoint: string;
  error?: string;
}

export interface RpcEndpointCheck {
  success: boolean;
  latency?: number;
  nodeVersion?: string;
  endpoint: string;
  error?: string;
}

export interface ServiceChecks {
  https?: RpcEndpointCheck;
  ip_port?: RpcEndpointCheck;
}

export interface HostCheckResult {
  ip: string;
  base_domain?: string;
  dns?: DnsCheck;
  p2p?: P2PCheck;
  aztec_rpc?: ServiceChecks;
  ethereum?: ServiceChecks;
}

export interface HostCheckResults {
  timestamp: string;
  results: {
    [hostname: string]: HostCheckResult;
  };
  summary: {
    total_checks: number;
    passed: number;
    failed: number;
  };
}
