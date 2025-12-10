#!/bin/bash
# Scrape coinbase addresses from StakingRegistry events
# Usage: 
#   ./scripts/scrape-coinbases.sh              # Incremental scrape (default)
#   ./scripts/scrape-coinbases.sh --full       # Full rescrape from deployment block
#   ./scripts/scrape-coinbases.sh --from-block 12345678  # Custom start block
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

# Check if --full flag is provided
if [[ "$*" == *"--full"* ]]; then
  echo "⚠️  Full rescrape mode - will scrape all historical events"
  echo ""
elif [[ "$*" == *"--from-block"* ]]; then
  echo "⚠️  Custom block range scrape"
  echo ""
else
  echo "📦 Incremental scrape mode (use --full for full rescrape)"
  echo ""
fi

# Pass all arguments to the CLI
npm run cli -- scrape-coinbases "$@"
