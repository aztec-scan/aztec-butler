# Aztec Butler - Architecture & Implementation Plan

## Current State

Single CLI tool with manual commands for Aztec node admin operations.

## Target State

Three execution modes:

1. **CLI mode** - Individual commands (current functionality)
2. **Prometheus exporter** - Continuous metrics scraping
3. **Event watcher** - Monitor on-chain events and trigger actions

---

## Architecture Feedback

### ✅ Two Separate Processes - GOOD IDEA

**Yes, having separate processes is recommended because:**

1. **Different lifecycle patterns**
   - Prometheus exporter: HTTP server with periodic scraping
   - Watcher: Event-driven with persistent state tracking
   - CLI: One-shot execution

2. **Different resource profiles**
   - Prometheus needs predictable, periodic execution
   - Watcher needs persistent connections and state management
   - Mixing them would complicate restart/recovery logic

3. **Deployment flexibility**
   - Can scale independently (multiple watchers, single exporter)
   - Can restart one without affecting the other
   - Easier to containerize separately if needed

4. **Different failure modes**
   - Prometheus exporter should never exit (restarts on error)
   - Watcher may need sophisticated retry/replay logic
   - CLI commands should fail fast

### Alternative to Consider

Instead of "two processes", think of it as **one binary with three modes**:

```bash
aztec-butler <command>              # CLI mode
aztec-butler serve --prometheus     # Prometheus mode
aztec-butler serve --watcher        # Watcher mode
```

This gives you:

- Single build artifact
- Shared code/config between modes
- Flexibility to add more modes later (e.g., combined mode for small deployments)

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
│   ├── prometheus/                # Prometheus exporter mode
│   │   ├── server.ts              # HTTP server setup
│   │   ├── metrics/               # Metric definitions & collectors
│   │   │   ├── node-metrics.ts    # Aztec node metrics
│   │   │   ├── l1-metrics.ts      # L1 contract metrics
│   │   │   └── registry.ts        # Central metrics registry
│   │   ├── scrapers/              # Data collection logic
│   │   │   ├── base-scraper.ts    # Abstract scraper class
│   │   │   ├── node-scraper.ts
│   │   │   └── contract-scraper.ts
│   │   └── index.ts               # Prometheus mode entry point
│   │
│   ├── watcher/                   # Event watcher mode
│   │   ├── index.ts               # Watcher entry point
│   │   ├── event-handlers/        # On-chain event handlers
│   │   │   ├── stake-handler.ts   # Handle delegated stake changes
│   │   │   ├── provider-handler.ts # Provider key management
│   │   │   └── index.ts
│   │   ├── actions/               # Required actions triggered by events
│   │   │   ├── update-coinbase.ts
│   │   │   ├── create-provider.ts
│   │   │   └── add-keys.ts
│   │   ├── state/                 # State management for event tracking
│   │   │   ├── checkpoint.ts      # Last processed block tracking
│   │   │   └── pending-actions.ts # Queue of actions to execute
│   │   └── listener.ts            # Core event listener logic
│   │
│   ├── core/                      # Shared core functionality
│   │   ├── clients/               # External service clients
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
│   └── version.ts                 # Version info
│
├── config/                        # Config file templates & examples
│   ├── example.env
│   └── prometheus.yml             # Example Prometheus config
│
├── docs/                          # Documentation
│   ├── architecture.md
│   ├── cli-usage.md
│   ├── prometheus-setup.md
│   └── watcher-setup.md
│
├── scripts/                       # Build & deployment scripts
│   └── build.sh
│
├── test/                          # Tests (mirror src structure)
│   ├── cli/
│   ├── prometheus/
│   ├── watcher/
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

- **CLI**: Thin wrapper around core functionality
- **Prometheus**: Expose metrics, don't implement business logic
- **Watcher**: Orchestrate actions, don't implement execution
- **Core**: Pure business logic, no I/O assumptions

### 2. Shared Core

All three modes should use the same `core/` functions. This ensures:

- Consistency across modes
- Easier testing
- Single source of truth for business logic

### 3. Mode-Specific Entry Points

Each mode has its own `index.ts` with:

- Mode-specific initialization
- Error handling strategy
- Lifecycle management

### 4. Configuration Strategy

```typescript
// Base config used by all modes
interface BaseConfig {
  aztecNodeUrl: string;
  ethereumNodeUrl: string;
  aztecDockerDir: string;
  providerAdminAddress?: string;
}

// Mode-specific config extensions
interface PrometheusConfig extends BaseConfig {
  port: number;
  scrapeInterval: number;
}

interface WatcherConfig extends BaseConfig {
  pollInterval: number;
  startBlock?: number;
  stateDir: string;
}
```

---

## Migration Path

### Phase 1: Restructure Existing Code

1. Move current commands to `cli/commands/`
2. Extract clients to `core/clients/`
3. Move config logic to `core/config/`
4. Update imports

### Phase 2: Implement Prometheus Mode

1. Create `prometheus/` structure
2. Implement base scraper interface
3. Add node metrics scraper
4. Add L1 contract metrics scraper
5. Setup HTTP server with `/metrics` endpoint

### Phase 3: Implement Watcher Mode

1. Create `watcher/` structure
2. Implement event listener
3. Add state management (checkpoint tracking)
4. Implement event handlers
5. Wire up action triggers

### Phase 4: Unified Entry Point

1. Create main `src/index.ts` with mode selection
2. Add CLI argument parsing (consider using `commander` or `yargs`)
3. Update npm scripts for each mode
4. Update documentation

### Phase 5: Polish

1. Add structured logging
2. Implement graceful shutdown
3. Add health check endpoints
4. Write tests
5. Document deployment strategies

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

## Open Questions to Consider

1. **Watcher action execution**
   - Should actions be automatic or require approval?
   - How to handle failed actions (retry logic)?
   - Should there be a dry-run mode?

2. **Multi-node support**
   - Will one instance monitor multiple nodes?
   - Or deploy one instance per node?

3. **Alert mechanisms**
   - Should watcher send alerts (email, Discord, etc.)?
   - Or rely on Prometheus alerting?

4. **Security**
   - How to handle private keys in watcher mode?
   - Should actions be signed locally or submitted to multisig?

5. **Testing strategy**
   - Integration tests against local devnet?
   - Mock external services?

---

## Next Steps

1. Review and adjust this plan based on your needs
2. Decide on CLI framework (commander/yargs)
3. Start Phase 1 restructuring
4. Implement one mode fully before moving to next
5. Test each mode in isolation

---

## Benefits of This Approach

✅ Clear separation of concerns
✅ Shared business logic across modes
✅ Easy to test individual components
✅ Flexible deployment options
✅ Can add new modes easily (e.g., API server, Discord bot)
✅ Standard patterns for each mode type
✅ Scalable architecture as complexity grows
