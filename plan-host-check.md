# Plan: Host Connection Check

## Status

- ✅ **Phase 1 (CLI Implementation): COMPLETED**
- ⏳ **Phase 2 (Prometheus Metrics): PENDING**

## Overview

This plan covers implementing host connection checks for Aztec nodes and exposing them via Prometheus metrics. The implementation will check:

1. DNS resolution check (verify domain resolves to correct IP)
2. P2P connection status (TCP port connectivity)
3. RPC status via HTTPS URL (domain without port)
4. RPC status via IP+port (direct connection)

## Configuration

### {network}-hosts.json

Configuration files are stored in the standard config directory (`~/.config/aztec-butler/` on Linux) next to the network `.env` files. The filename follows the pattern `{network}-hosts.json` (e.g., `mainnet-hosts.json`, `testnet-hosts.json`).

Example structure:

```json
{
  "beast-3": {
    "ip": "146.59.108.112",
    "base_domain": "beast-3.aztlanlabs.xyz",
    "services": {
      "p2p": {
        "port": 40404
      },
      "aztec_rpc": {
        "port": 8085,
        "subdomain": "rpc.mainnet.aztec"
      }
    }
  }
}
```

**Notes:**

- IP is defined once at the host level, not repeated for each service
- `base_domain` is used to construct service URLs and for DNS checks
- Service `subdomain` is optional - if present, constructs HTTPS URL as `https://{subdomain}.{base_domain}`
- Hosts may have partial service availability (e.g., no ethereum node, no domain for RPC)
- Services are optional - only check what is defined
- There should be no consideration for backwards compatibility or migration notes

### Host Configuration Schema

```typescript
interface HostServices {
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

interface HostConfig {
  ip: string;
  base_domain?: string;
  services: HostServices;
}

interface MainnetHostsConfig {
  [hostname: string]: HostConfig;
}
```

## Implementation Plan

### Phase 1: CLI Implementation ✅ COMPLETED

All components of Phase 1 have been implemented and tested successfully.

#### 1.1 Core Check Functions ✅

Implemented in `src/core/components/HostChecker.ts`:

```typescript
export class HostChecker {
  /**
   * Check DNS resolution
   * Verifies that base_domain resolves to the expected IP
   * Returns: { success: boolean, resolvedIps?: string[], error?: string }
   */
  async checkDnsResolution(
    domain: string,
    expectedIp: string,
  ): Promise<DnsCheckResult>;

  /**
   * Check P2P TCP port connectivity
   * Returns: { success: boolean, latency?: number, error?: string }
   */
  async checkP2PConnection(ip: string, port: number): Promise<CheckResult>;

  /**
   * Check RPC via HTTPS URL (domain-based)
   * Uses node_getNodeInfo RPC call
   * Returns: { success: boolean, latency?: number, nodeVersion?: string, error?: string }
   */
  async checkRpcHttps(url: string): Promise<RpcCheckResult>;

  /**
   * Check RPC via IP+port (direct connection)
   * Uses node_getNodeInfo RPC call
   * Returns: { success: boolean, latency?: number, nodeVersion?: string, error?: string }
   */
  async checkRpcIpPort(ip: string, port: number): Promise<RpcCheckResult>;
}
```

**Technical Details:**

- **DNS Check**: Use Node.js `dns.promises.resolve4()` to resolve A records
  - Verify the domain resolves to the expected IP address
  - Handle DNS resolution failures and timeouts
  - Return all resolved IPs for comparison

- **P2P Check**: Use Node.js `net.Socket` to attempt TCP connection with 5 second timeout
  - Measure connection latency
  - Properly close connection after successful check
- **RPC HTTPS Check**: Use `fetch` API to call JSON-RPC endpoint
  - Request: `{"jsonrpc":"2.0","method":"node_getNodeInfo","params":[],"id":1}`
  - Measure response latency
  - Parse response to extract node version
  - Handle network errors, timeouts, and invalid responses
- **RPC IP+Port Check**: Same as HTTPS check but construct URL as `http://{ip}:{port}`

#### 1.2 CLI Command ✅

Implemented in `src/cli/commands/check-hosts.ts`.

**Command Options:**

- `--config <path>`: Path to hosts config file (default: `~/.config/aztec-butler/{network}-hosts.json`)
- `--host <name>`: Check specific host only (default: check all)
- `--check <type>`: Check specific type only: dns, p2p, rpc, all (default: all)
- `--json`: Output results as JSON (default: pretty table)

**Output Format (pretty):**

```
Checking hosts from ~/.config/aztec-butler/mainnet-hosts.json...

beast-3 (146.59.108.112)
  DNS Resolution
    ✓ beast-3.aztlanlabs.xyz → 146.59.108.112 - OK

  P2P Connection
    ✓ 146.59.108.112:40404 - OK (42ms)

  Aztec RPC
    ✗ https://rpc.mainnet.aztec.beast-3.aztlanlabs.xyz - FAILED: ...
    ✓ 146.59.108.112:8085 - OK (96ms) [2.1.9]

Summary: 3/4 checks passed
```

**Output Format (JSON):**

```json
{
  "timestamp": "2025-12-15T10:30:00Z",
  "results": {
    "beast-3": {
      "ip": "146.59.108.112",
      "base_domain": "beast-3.aztlanlabs.xyz",
      "dns": {
        "success": true,
        "resolvedIps": ["146.59.108.112"],
        "domain": "beast-3.aztlanlabs.xyz"
      },
      "p2p": {
        "success": true,
        "latency": 12,
        "endpoint": "146.59.108.112:40404"
      },
      "aztec_rpc": {
        "https": {
          "success": true,
          "latency": 145,
          "nodeVersion": "v0.63.1",
          "endpoint": "https://rpc.mainnet.aztec.beast-3.aztlanlabs.xyz"
        },
        "ip_port": {
          "success": true,
          "latency": 23,
          "nodeVersion": "v0.63.1",
          "endpoint": "146.59.108.112:8085"
        }
      }
    }
  },
  "summary": {
    "total_checks": 4,
    "passed": 4,
    "failed": 0
  }
}
```

#### 1.3 CLI Integration ✅

Implemented in `cli.ts`:

```bash
# Usage examples:
npm run cli -- check-hosts --network mainnet
npm run cli -- check-hosts --network mainnet --host beast-3
npm run cli -- check-hosts --network mainnet --check dns
npm run cli -- check-hosts --network mainnet --json
```

### Phase 2: Prometheus Metrics ⏳ PENDING

This phase will be implemented in the future when metrics export is needed.

#### 2.1 Metrics Definition

Create `src/server/metrics/host-metrics.ts`:

```typescript
// Gauge metrics for connection status (1 = up, 0 = down)
- aztec_butler_host_dns_status{host, domain, expected_ip}
- aztec_butler_host_p2p_status{host, ip, port}
- aztec_butler_host_rpc_https_status{host, url, node_version}
- aztec_butler_host_rpc_ip_status{host, ip, port, node_version}

// Gauge metrics for latency in milliseconds
- aztec_butler_host_p2p_latency_ms{host, ip, port}
- aztec_butler_host_rpc_https_latency_ms{host, url}
- aztec_butler_host_rpc_ip_latency_ms{host, ip, port}

// Info metric
- aztec_butler_host_info{host, ip, base_domain, node_version}
```

#### 2.2 Scraper Implementation

Create `src/server/scrapers/host-scraper.ts`:

```typescript
export class HostScraper extends BaseScraper {
  async scrapeAndUpdateMetrics(): Promise<void>;
}
```

**Scraper Behavior:**

- Load `mainnet-hosts.json` on initialization
- Run checks periodically (configurable interval, default: 30 seconds)
- Update metrics for each host and service
- Handle timeouts and errors gracefully
- Log failures at appropriate log levels

#### 2.3 Server Integration

Add to `src/server/index.ts`:

- Initialize HostScraper in ScraperManager
- Add host scraper to periodic scraping schedule

## Implementation References

### Patterns from aztecmonitor

The Go implementation in `aztecmonitor/aztec/aztec.go` provides these patterns:

1. **P2P Check** (line 314-329):
   - Uses `net.DialTimeout("tcp", address, 5*time.Second)`
   - Sets status metric to 1 on success, 0 on failure
   - Closes connection immediately after check

2. **RPC Check** (line 114-155):
   - Makes JSON-RPC POST request with proper headers
   - Uses context for cancellation
   - Parses response and handles errors
   - Extracts node info from response

3. **HTTP Client Setup** (line 88-99):
   - 30 second request timeout
   - 10 second dial timeout
   - Connection pooling with keep-alive
   - Proper connection limits

4. **Metrics Update** (line 332-340):
   - Uses static labels where appropriate
   - Separate info metric for version information
   - Consistent label ordering

### Patterns from aztec-butler

1. **Scraper Pattern** (`src/server/scrapers/base-scraper.ts`):
   - Abstract base class with common scraping logic
   - Periodic execution with configurable intervals
   - Error handling and logging

2. **Metrics Pattern** (`src/server/metrics/registry.ts`):
   - Factory functions for creating metrics
   - Automatic name prepending
   - OpenTelemetry integration

3. **CLI Pattern** (`cli.ts`):
   - Commander-based command structure
   - Consistent error formatting
   - Global options for network configuration

## Testing Strategy

### CLI Testing ✅

Tested and verified working:

```bash
# Check all hosts
npm run cli -- check-hosts --network mainnet

# Check specific host
npm run cli -- check-hosts --network mainnet --host beast-3

# Check specific type
npm run cli -- check-hosts --network mainnet --check dns
npm run cli -- check-hosts --network mainnet --check p2p
npm run cli -- check-hosts --network mainnet --check rpc

# JSON output
npm run cli -- check-hosts --network mainnet --json

# Custom config
npm run cli -- check-hosts --config ./custom-hosts.json
```

### Expected Failures to Handle ✅

All failure scenarios are handled gracefully:

1. **DNS resolution failure**: Domain does not resolve or resolves to wrong IP ✓
2. **Network unreachable**: Timeout after 5 seconds ✓
3. **Port closed**: Connection refused ✓
4. **Invalid RPC response**: Parse error ✓
5. **HTTPS certificate error**: SSL/TLS error ✓
6. **Service not configured**: Skip check gracefully ✓

## Implementation Summary

### Files Created ✅

```
aztec-butler/
├── ~/.config/aztec-butler/
│   └── {network}-hosts.json                    # Config files per network
├── src/
│   ├── types/
│   │   ├── host-check.ts                       # TypeScript types
│   │   └── index.ts                            # Export types
│   ├── core/
│   │   └── components/
│   │       └── HostChecker.ts                  # Core checker component
│   ├── cli/
│   │   └── commands/
│   │       ├── check-hosts.ts                  # CLI command
│   │       └── index.ts                        # Export command
│   └── server/                                 # Phase 2 (pending)
│       ├── metrics/
│       │   └── host-metrics.ts                 # Metrics (Phase 2)
│       └── scrapers/
│           └── host-scraper.ts                 # Scraper (Phase 2)
└── cli.ts                                      # Integrated command
```

## Dependencies ✅

No new dependencies required. Uses built-in Node.js modules:

- `dns.promises` for DNS resolution checks ✓
- `net` for TCP connection checks ✓
- `fetch` API for HTTP/HTTPS checks (available in Node.js 18+) ✓
- `env-paths` for standard config directory location ✓
- Existing OpenTelemetry metrics for Prometheus export (Phase 2)

## Notes

- ✅ **Phase 1 Complete**: CLI implementation fully functional and tested
- ⏳ **Phase 2 Pending**: Prometheus metrics to be implemented when needed
- ✅ **No backwards compatibility required**: This is a new feature
- ✅ **Config stored in standard location**: `~/.config/aztec-butler/{network}-hosts.json`
- ✅ **Inspired by aztecmonitor**: Similar check patterns, adapted to TypeScript/Node.js
- ✅ **Optional services**: Hosts may not have all services configured
- ✅ **Graceful degradation**: Skip checks for unconfigured services
- ✅ **Separate concerns**: CLI checks are independent of metrics export
