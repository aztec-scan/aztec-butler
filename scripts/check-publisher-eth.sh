#!/bin/bash
# Check publisher ETH balances and generate funding calldata
# Usage: ./scripts/check-publisher-eth.sh
#
# This will:
# - Find all keystores in ./keystores/
# - Extract publisher addresses and calculate load
# - Check on-chain ETH balances
# - Generate funding calldata for publishers needing top-ups
#
# Recommended ETH per attester: 0.1 ETH

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "==================================="
echo "Check Publisher ETH Balances"
echo "==================================="
echo ""
echo "Using keystores from: ./keystores/"
echo ""

npm run cli -- check-publisher-eth
