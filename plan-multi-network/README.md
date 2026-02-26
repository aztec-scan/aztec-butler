# Multi-Network Support Plan

Deploy aztec-butler as one process per network on gremlin-3, monitoring mainnet, testnet, and devnet independently.

## Architecture Decision

**One process per network** (not single process for all). Rationale:

- Mainnet stability is the top priority -- devnet/testnet crashes cannot affect mainnet monitoring
- Independent restarts for config changes per network
- Clean per-service logs and resource visibility
- Avoids `@aztec/aztec.js` version conflicts across networks (solved fully by Phase 1)

## Target State

```
gremlin-3: 3 systemd services
  ├── aztec-butler-mainnet  (:9464) -> beast-3, beast-4  (L1: Ethereum mainnet)
  ├── aztec-butler-testnet  (:9465) -> beast-5 :8087     (L1: Sepolia)
  └── aztec-butler-devnet   (:9466) -> beast-5 :8086     (L1: Sepolia)
```

Prometheus scrapes all three ports. Grafana unifies via `network` label.

## Plan Structure

### Knowledge Base (reference docs, unchanged)

- [kb-butler-architecture.md](./kb-butler-architecture.md) -- Butler codebase structure, config system, metrics
- [kb-current-deployment.md](./kb-current-deployment.md) -- aztlan-ops Ansible role, inventory, current config
- [kb-target-topology.md](./kb-target-topology.md) -- Target node mapping, per-network config values

### Implementation Phases

- [Phase 1: Replace @aztec/aztec.js with HTTP+Zod](./phase-1-remove-aztec-js.md) -- Remove SDK dependency, use direct RPC call
- [Phase 2: Make metrics port configurable](./phase-2-configurable-port.md) -- Add METRICS_PORT env var
- [Phase 3: Local testing against testnet/devnet](./phase-3-local-testing.md) -- Create configs, verify all 3 networks work
- [Phase 4: aztlan-ops deployment](./phase-4-deployment.md) -- 3 systemd services, env templates, Prometheus scrape config
- [Phase 5: Grafana dashboard](./phase-5-grafana.md) -- Add network variable, unify panels

## Summary of All Changes

### aztec-butler repo

| File                                   | Change                                                        |
| -------------------------------------- | ------------------------------------------------------------- |
| `src/core/components/AztecClient.ts`   | Rewrite: remove `@aztec/aztec.js`, use `fetch()` + Zod schema |
| `src/types/aztec-node.ts`              | **New** -- Zod schema for `/node-info` response               |
| `src/core/config/index.ts`             | Add `METRICS_PORT` config field                               |
| `src/server/index.ts`                  | Read metrics port from config                                 |
| `src/cli/commands/deposit-calldata.ts` | Remove `@aztec/aztec.js` import (use local type)              |
| `package.json`                         | Remove `@aztec/aztec.js` dependency                           |

### aztlan-ops repo

| File                                        | Change                                                        |
| ------------------------------------------- | ------------------------------------------------------------- |
| `templates/testnet-base.env.j2`             | **New**                                                       |
| `templates/devnet-base.env.j2`              | **New**                                                       |
| `defaults/main.yml`                         | Add testnet/devnet variables, per-network ports               |
| `tasks/aztec-butler.yml`                    | 3 services instead of 1, template all env files               |
| `templates/prometheus.yml.j2`               | 3 scrape targets (ports 9464, 9465, 9466)                     |
| `dashboards/aztec-butler/dashboard.json.j2` | Add `network_filter` variable                                 |
| `dashboards/aztec-butler/panels/*.json.j2`  | Replace `network="mainnet"` with `network=~"$network_filter"` |
