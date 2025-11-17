# Aztec Butler - Architecture & Implementation Plan

## Current State

Single CLI tool with manual commands for Aztec node admin operations.

## Target State

Two execution modes:

1. **CLI mode** - Individual commands (current functionality)
2. **Server mode** - Combined Prometheus exporter + Event watcher

---

## Architecture Decision: Combined Server Mode

### ✅ Combined Prometheus + Watcher - RIGHT CHOICE FOR THIS PROJECT

**We're combining Prometheus exporter and event watcher into a single server process because:**

1. **Shared Data Sources**
   - Both need to scrape the same sources (on-chain data, local node files)
   - Prometheus exposes current state as metrics
   - Watcher monitors the same state for changes
   - No point fetching the same data twice from two processes

2. **Simpler Deployment**
   - Single process to manage and monitor
   - One container/service to deploy
   - Single configuration file
   - One health check endpoint
   - Fewer moving parts = more reliable

3. **Resource Efficiency**
   - Single RPC connection to Ethereum/Aztec nodes
   - One set of file system watchers
   - Shared in-memory state between components
   - Lower overhead on the host system

4. **Appropriate Scale**
   - Managing individual Aztec nodes, not multi-tenant platform
   - Not running hundreds of instances
   - Resource contention won't be an issue
   - Brief restarts are acceptable (Prometheus can tolerate short downtime)

5. **Unified Lifecycle**
   - Both are long-running daemons with same uptime requirements
   - If either fails, restarting both together makes sense
   - Shared error handling and recovery logic
   - Single graceful shutdown procedure

### Why Not Separate Processes?

The separation would be good engineering for large-scale systems, but introduces unnecessary complexity for this use case:

- No need to scale components independently
- Same failure recovery strategy for both
- Added operational overhead with no real benefit

### Binary Design

```bash
aztec-butler <command>              # CLI mode (one-shot commands)
aztec-butler serve                  # Server mode (Prometheus + Watcher)
```

This gives you:

- Single build artifact
- Shared code/config between modes
- Simple deployment story
- Can still split later if needed (YAGNI principle)

---

## Proposed Repository Layout

```
aztec-butler/
├── src/
│   ├── cli/                       # CLI command implementations
│   │   ├── commands/
│   │   │   ├── deposit-calldata.ts
│   │   │   ├── get-publisher-eth.ts
│   │   │   ├── attester-registration.ts
│   │   │   ├── provider-management.ts
│   │   │   └── index.ts           # Export all commands
│   │   ├── index.ts               # CLI entry point & arg parsing
│   │   └── runner.ts              # Execute individual commands
│   │
│   ├── server/                    # Combined server mode (Prometheus + Watcher)
│   │   ├── index.ts               # Server entry point (starts both HTTP + watchers)
│   │   ├── http-server.ts         # HTTP server for /metrics and /health
│   │   │
│   │   ├── scrapers/              # Data collection from sources
│   │   │   ├── base-scraper.ts    # Abstract scraper interface
│   │   │   ├── node-scraper.ts    # Aztec node data (files + RPC)
│   │   │   ├── l1-scraper.ts      # L1 contract state
│   │   │   └── index.ts
│   │   │
│   │   ├── metrics/               # Prometheus metrics exposure
│   │   │   ├── registry.ts        # Central metrics registry
│   │   │   ├── node-metrics.ts    # Node-related metrics
│   │   │   ├── l1-metrics.ts      # L1 contract metrics
│   │   │   └── index.ts
│   │   │
│   │   ├── watchers/              # Event monitoring & action triggers
│   │   │   ├── event-listener.ts  # On-chain event subscription
│   │   │   ├── file-watcher.ts    # Local file change monitoring
│   │   │   └── index.ts
│   │   │
│   │   ├── handlers/              # Event handlers that trigger actions
│   │   │   ├── stake-handler.ts   # Delegated stake changes
│   │   │   ├── provider-handler.ts # Provider key management
│   │   │   └── index.ts
│   │   │
│   │   ├── actions/               # Action executors (reuse CLI commands)
│   │   │   ├── update-coinbase.ts
│   │   │   ├── create-provider.ts
│   │   │   ├── add-keys.ts
│   │   │   └── index.ts
│   │   │
│   │   └── state/                 # Persistent state management
│   │       ├── checkpoint.ts      # Last processed block tracking
│   │       └── pending-actions.ts # Action queue with retry logic
│   │
│   ├── core/                      # Shared core functionality
│   │   ├── components/            # External service clients
│   │   │   ├── aztec-client.ts
│   │   │   ├── ethereum-client.ts
│   │   │   └── index.ts
│   │   ├── config/                # Configuration management
│   │   │   ├── schema.ts          # Config validation schemas
│   │   │   ├── loader.ts          # Config loading & persistence
│   │   │   └── index.ts
│   │   ├── utils/                 # Shared utilities
│   │   │   ├── file-operations.ts
│   │   │   ├── logger.ts          # Structured logging
│   │   │   └── errors.ts          # Custom error types
│   │   └── types.ts               # Shared type definitions
│   │
│   ├── index.ts                   # Main entry point - mode selection
│   └── types.ts                   # Top-level types
│
├── config/                        # Config file templates & examples
│   ├── example.env
│   └── prometheus.yml             # Example Prometheus config
│
├── docs/                          # Documentation
│   ├── architecture.md
│   ├── cli-usage.md
│   └── server-setup.md
│
├── scripts/                       # Build & deployment scripts
│   └── build.sh
│
├── test/                          # Tests (mirror src structure)
│   ├── cli/
│   ├── server/
│   └── core/
│
├── .editorconfig
├── .gitignore
├── eslint.config.js
├── package.json
├── tsconfig.json
├── LICENSE
├── README.md
└── PLAN.md
```

---

## Key Design Principles

### 1. Separation of Concerns

- **CLI**: Thin wrapper around core functionality, one-shot execution
- **Server/Scrapers**: Fetch data from sources (files, RPC, contracts)
- **Server/Metrics**: Expose scraped data as Prometheus metrics
- **Server/Watchers**: Monitor for changes and trigger handlers
- **Server/Handlers**: Orchestrate actions based on events
- **Server/Actions**: Execute business logic (reuse CLI commands where possible)
- **Core**: Pure business logic, no I/O assumptions

### 2. Shared Core & Code Reuse

- Both CLI and server modes use the same `core/` functions
- Server actions should reuse CLI command implementations where applicable
- Scrapers can be used by both metrics and watchers
- Single source of truth for business logic ensures consistency

### 3. Single Server Process with Multiple Responsibilities

The server mode orchestrates multiple concurrent activities:

- HTTP server for `/metrics` endpoint (Prometheus scraping)
- HTTP server for `/health` endpoint (health checks)
- Periodic scrapers to refresh metrics
- Event listeners for on-chain changes
- File watchers for local state changes
- Action executor with retry logic

### 4. Configuration Strategy

```typescript
// Base config used by all modes
interface BaseConfig {
  aztecNodeUrl: string;
  ethereumNodeUrl: string;
  aztecDockerDir: string;
  providerAdminAddress?: string;
}

// CLI uses only base config
interface CliConfig extends BaseConfig {}

// Server mode combines all monitoring & metrics config
interface ServerConfig extends BaseConfig {
  // HTTP server
  port: number;

  // Scraping/metrics
  scrapeInterval: number;

  // Event watching
  pollInterval: number;
  startBlock?: number;

  // State persistence
  stateDir: string;

  // Action execution
  autoExecuteActions: boolean;
  maxRetries: number;
}
```

---

## Migration Path

### Phase 1: Restructure Existing Code ✅ COMPLETE

1. ✅ Move current commands to `cli/commands/`
2. ✅ Extract clients to `core/components/`
3. ✅ Move config logic to `core/config/`
4. ✅ Update imports

### Phase 2: Implement Server Infrastructure

1. Create `server/` directory structure
2. Implement base scraper interface
3. Setup HTTP server with `/metrics` and `/health` endpoints
4. Add structured logging (pino)
5. Implement graceful shutdown handling

### Phase 3: Implement Scrapers & Metrics

1. Implement node scraper (files + RPC)
2. Implement L1 contract scraper
3. Define Prometheus metrics (node-metrics.ts, l1-metrics.ts)
4. Wire scrapers to metrics registry
5. Add periodic scraper execution

### Phase 4: Implement Event Watching

1. Implement on-chain event listener (viem)
2. Add file system watcher for local changes
3. Implement state management (checkpoint tracking)
4. Create event handlers (stake, provider changes)
5. Wire handlers to action executors

### Phase 5: Action Execution & State

1. Implement action executors (reuse CLI commands)
2. Add action queue with retry logic
3. Implement state persistence (checkpoint + pending actions)
4. Add dry-run mode for testing
5. Implement action execution safeguards

### Phase 6: Testing & Documentation

1. Write unit tests for core components
2. Write integration tests (mock external services)
3. Test against local devnet if available
4. Document server configuration
5. Document deployment strategies
6. Add example docker-compose setup

---

## Technology Recommendations

### CLI Parsing

- **commander** or **yargs** for argument parsing
- Better than manual argv parsing as complexity grows

### Logging

- **pino** - fast, structured logging
- Different log levels per mode
- JSON output for production

### Prometheus Client

- **prom-client** - standard Node.js Prometheus client
- Built-in collectors for node metrics

### Event Listening

- Use **viem** public client (already a dependency)
- `watchEvent()` for real-time listening
- `getLogs()` with checkpoint for catch-up

### State Persistence (Watcher)

- Start simple: JSON file for checkpoint
- Consider SQLite if state grows complex
- Store: last processed block, pending actions

---

## Server Mode Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      SERVER PROCESS                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐          ┌──────────────┐                 │
│  │   Scrapers   │          │   Watchers   │                 │
│  │              │          │              │                 │
│  │ • Node RPC   │          │ • On-chain   │                 │
│  │ • Node files │          │   events     │                 │
│  │ • L1 state   │          │ • File       │                 │
│  └──────┬───────┘          │   changes    │                 │
│         │                  └──────┬───────┘                 │
│         │                         │                          │
│         ▼                         ▼                          │
│  ┌──────────────┐          ┌──────────────┐                 │
│  │   Metrics    │          │   Handlers   │                 │
│  │   Registry   │          │              │                 │
│  │              │          │ Detect if    │                 │
│  │ Store latest │          │ action needed│                 │
│  │ values       │          └──────┬───────┘                 │
│  └──────┬───────┘                 │                          │
│         │                         ▼                          │
│         │                  ┌──────────────┐                 │
│         │                  │   Actions    │                 │
│         │                  │              │                 │
│         │                  │ Execute CLI  │                 │
│         │                  │ commands     │                 │
│         │                  └──────┬───────┘                 │
│         │                         │                          │
│         │                         ▼                          │
│         │                  ┌──────────────┐                 │
│         │                  │    State     │                 │
│         │                  │              │                 │
│         │                  │ Checkpoint + │                 │
│         │                  │ Pending queue│                 │
│         │                  └──────────────┘                 │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────┐                                           │
│  │ HTTP Server  │                                           │
│  │              │                                           │
│  │ /metrics     │ ◄──── Prometheus scrapes                 │
│  │ /health      │ ◄──── Health checks                      │
│  └──────────────┘                                           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Open Questions to Consider

1. **Action execution policy** 🤔
   - Start with automatic execution + dry-run flag
   - Add approval mechanism later if needed
   - Implement retry with exponential backoff
   - Max 3 retries, then alert and pause

2. **Multi-node support** 🤔
   - Phase 1: One instance per node (simpler)
   - Phase 2: Could support multiple nodes in single instance
   - Config would specify multiple node endpoints

3. **Alert mechanisms** 🤔
   - Primary: Rely on Prometheus alerting (standard practice)
   - Optional: Direct alerts for critical failures
   - Log errors prominently for monitoring tools

4. **Security** 🔒
   - Store private keys in environment variables
   - Support keystore files with password
   - Consider hardware wallet integration for production
   - Actions should be signed locally, not via RPC

5. **Metrics to expose** 📊
   - Node health (is synced, current block, peer count)
   - Validator status (is active, stake amount)
   - Provider status (key count, coinbase address)
   - L1 contract state (total stake, provider count)
   - Action metrics (success/failure count, retry count)

---

## Next Steps

1. ✅ Review and finalize architecture (combined server mode)
2. Decide on CLI framework (commander/yargs)
3. ✅ Phase 1 restructuring complete
4. Start Phase 2: Server infrastructure
5. Implement incrementally, testing each component

---

## Benefits of Combined Server Approach

✅ **Single Process**: Simpler deployment and monitoring
✅ **Resource Efficient**: Shared connections and in-memory state
✅ **Code Reuse**: Scrapers serve both metrics and watchers
✅ **Unified Configuration**: One config file for all server functionality
✅ **Graceful Degradation**: If one component fails, restart handles all
✅ **Appropriate Scale**: Perfect for single-node management use case
✅ **Future Flexibility**: Can split later if requirements change (YAGNI)

## Example Usage

```bash
# CLI mode - one-shot commands
aztec-butler deposit-calldata --amount 1000
aztec-butler get-publisher-eth
aztec-butler get-create-provider-calldata

# Server mode - long-running daemon
aztec-butler serve

# Server with custom config
aztec-butler serve --config /path/to/config.json

# Server with dry-run (no actions executed)
aztec-butler serve --dry-run
```
