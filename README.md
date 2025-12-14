# Aztec Butler

A tool for helping out with chores on an aztec-node server.

## Requirements

- **Node.js v22.0.0 or higher**

## Documentation

- **[Operator Guide](./operator-guide/README.md)** - Complete guide for validator key management (generate, deploy, register)
- **[Daemon Setup](./daemon/README.md)** - Run aztec-butler as a systemd service with Prometheus metrics

## Running as a Service

To run aztec-butler as a systemd service, see the [daemon setup guide](./daemon/README.md). The daemon runs the butler in server mode, providing Prometheus metrics and automated monitoring for your Aztec nodes.

## TODO

1. there should be one command checking no duplicates of attester addresses across all positions on-chain
   - stakingProviderRegistryQueue
   - rollup entryQueue
   - rollup active validators

### Roadmap

1. separate scrape-config-files
   - config i.e. off-chain-data like URLs
   - cached state scraped from operator-machine
     - publishers
     - attester-keys
     - coinbases
1. EntryQueue time stats - to simplify when to update coinbases
   - Time per attester entry
   - Total attesters in queue
   - Last attester in total queue estimated date for entry
   - ProviderIDs total attesters in queue
   - ProviderIDs next attesters arrival (date)
   - ProviderIDs next attesters, missing coinbase, arrival (date)
   - ProviderIDs last attesters arrival (date)
1. replace need for aztecmonitor
   - P2P connection status
   - chain tips
