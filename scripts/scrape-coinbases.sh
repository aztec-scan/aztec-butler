#!/bin/bash
# Scrape coinbase addresses from StakingRegistry events
# Usage: ./scripts/scrape-coinbases.sh
#
# This will:
# - Find all keystores in ./keystores/
# - Extract attester addresses
# - Query staking provider ID
# - Scrape StakedWithProvider events from chain
# - Map attesters to their coinbase addresses
#
# Output: ~/.local/share/aztec-butler/{network}-mapped-coinbases.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "==================================="
echo "Scrape Coinbase Addresses"
echo "==================================="
echo ""
echo "Using keystores from: ./keystores/"
echo ""
echo "⚠️  This will scrape blockchain events and may take several minutes"
echo ""

npm run cli -- scrape-coinbases
