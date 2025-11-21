# Aztec Butler

A tool for helping out with chores on an aztec-node server.

## Requirements

- **Node.js v22.0.0 or higher**

## Running as a Service

To run aztec-butler as a systemd service, see the [daemon setup guide](./daemon/README.md). The daemon runs the butler in server mode, providing Prometheus metrics and automated monitoring for your Aztec nodes.

## TODO

### features

1. Prometheus scraper for aztec-node metrics
1. Watcher for on-chain events with required actions
   - create and add keys to provider (and propose to multisig to fund proposer-address)

### gotchas

addresses and privkey should probably be forced to lower-case by zod

### potential bugs

IMPORTANT!!! Implement logic to avoid adding same attester-key multiple times!
