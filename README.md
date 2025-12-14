# Aztec Butler

An tool for helping out with managing multiple aztec nodes with an opinionated workflow and set-up.

## Requirements

- **Node.js v22.0.0 or higher**

## Documentation

- **[Operator Guide](./operator-guide/README.md)** - Complete guide for validator key management (generate, deploy, register)
- **[Daemon Setup](./daemon/README.md)** - Run aztec-butler as a systemd service with Prometheus metrics

## Running as a Service

To run aztec-butler as a systemd service, see the [daemon setup guide](./daemon/README.md). The daemon runs the butler in server mode, providing Prometheus metrics and automated monitoring for your Aztec nodes.

## TODO

1. double-check: there should be one command checking no duplicates of attester addresses across all positions on-chain
   - stakingProviderRegistryQueue
   - rollup entryQueue
   - rollup active validators

### Roadmap

1. replace need for aztecmonitor
   - P2P connection status
   - chain tips
1. merge attester-scraper and entry-queue stats scraper. (they both scrape from the same resource and can be done in one go)
