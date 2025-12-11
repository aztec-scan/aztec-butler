#!/bin/bash
# Scrape coinbase addresses from StakingRegistry events
# Usage: 
#   ./scripts/scrape-coinbases.sh                                  # Incremental scrape (default)
#   ./scripts/scrape-coinbases.sh --full                           # Full rescrape from deployment block
#   ./scripts/scrape-coinbases.sh --from-block 12345678            # Custom start block
#   ./scripts/scrape-coinbases.sh --provider-id 123                # Use provider ID directly (faster)
#   ./scripts/scrape-coinbases.sh --input ./keystores/key1.json    # Use specific keystore file
#   ./scripts/scrape-coinbases.sh --output ./cache/coinbases.json  # Custom output path
#   ./scripts/scrape-coinbases.sh --full --provider-id 123         # Combine flags
#
# This will:
# - Find all keystores in ./keystores/ (or use --input for custom path)
# - Extract attester addresses
# - Query staking provider ID (or use provided ID)
# - Scrape StakedWithProvider events from chain
# - Map attesters to their coinbase addresses
#
# Output: ~/.local/share/aztec-butler/{network}-mapped-coinbases.json (or custom path with --output)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "==================================="
echo "Scrape Coinbase Addresses"
echo "==================================="
echo ""
echo "Using keystores from: ./keystores/ (or custom with --input)"
echo ""

# Check flags
if [[ "$*" == *"--provider-id"* ]]; then
  echo "🚀 Using provided provider ID (skipping chain query)"
  echo ""
fi

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
