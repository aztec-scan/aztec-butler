#!/bin/bash

# dev runs this on their local machine to create new validator keys

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

aztec validator-keys new \
  --count 2 \
  --coinbase 0x0000000000000000000000000000000000000000 \
  --fee-recipient 0x0000000000000000000000000000000000000000000000000000000000000000 \
  --publisher-count 1 \
  --data-dir "$SCRIPT_DIR/on-dev-machine/" \
  --file testnet-aztec-private-keys.json
