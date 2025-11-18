# Aztec Butler

A tool for helping out with chores on an aztec-node server.

## Requirements

- **Node.js v22.0.0 or higher** (required for modern JavaScript features like Iterator.prototype.toArray)

Check your version:

```bash
node --version
```

If you need to upgrade:

- Using nvm: `nvm install 22 && nvm use 22`
- Ubuntu/Debian: https://github.com/nodesource/distributions
- Other systems: https://nodejs.org/

## TODO

1. Prometheus scraper for aztec-node metrics
1. Prometheus scraper for l1-contracts
1. Watcher for on-chain events with required actions
   - update coinbase if new delegated stake
   - create and add keys to provider (and propose to multisig to fund proposer-address)

IMPORTANT!!! Implement logic to avoid adding same attester-key multiple times!
