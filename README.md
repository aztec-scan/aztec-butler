# Aztec Butler

A tool for helping out with chores on an aztec-node server.

## Requirements

- **Node.js v22.0.0 or higher**

## Running as a Service

To run aztec-butler as a systemd service, see the [daemon setup guide](./daemon/README.md). The daemon runs the butler in server mode, providing Prometheus metrics and automated monitoring for your Aztec nodes.

## TODO

1. available_publisher_addresses.json should already have separated on which servers they are used. To prevent deploying same address to two different servers.
1. scraperConfig should have publishers in a separate array
   - because with HA one attester has different publishers for each server
1. there should be one command checking no duplicates of attester addresses across all positions on-chain
   - stakingProviderRegistryQueue
   - rollup entryQueue
   - rollup active validators

### Roadmap

1. replace need for aztecmonitor
   - P2P connection status
   - chain tips
1. scrape Aztec's OTEL-instance
