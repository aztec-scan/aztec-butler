# Aztec Butler

A tool for helping out with chores on an aztec-node server.

## Requirements

- **Node.js v22.0.0 or higher**

## TODO

1. Prometheus scraper for aztec-node metrics
1. Prometheus scraper for l1-contracts
1. Watcher for on-chain events with required actions
   - create and add keys to provider (and propose to multisig to fund proposer-address)

IMPORTANT!!! Implement logic to avoid adding same attester-key multiple times!
