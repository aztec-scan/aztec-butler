#!/bin/bash
# Generate scraper configuration from keystores
# Usage: 
#   ./scripts/generate-scraper-config.sh                                  # Query provider from admin address
#   ./scripts/generate-scraper-config.sh --provider-id 123                # Use provider ID directly (faster)
#   ./scripts/generate-scraper-config.sh --input ./keystores/key1.json    # Use specific keystore file
#   ./scripts/generate-scraper-config.sh --output ./configs/testnet.json  # Custom output path
#
# This will:
# - Find all keystores in ./keystores/ (or use --input for custom path)
# - Extract attesters (publishers are derived from attesters)
# - Query staking provider from chain (or use provided ID)
# - Generate scraper config with coinbase mappings
#
# Output: ~/.local/share/aztec-butler/{network}-scrape-config.json (or custom path with --output)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "==================================="
echo "Generate Scraper Configuration"
echo "==================================="
echo ""
echo "Using keystores from: ./keystores/ (or custom with --input)"
echo ""

# Check if --provider-id flag is provided
if [[ "$*" == *"--provider-id"* ]]; then
  echo "🚀 Using provided provider ID (skipping chain query)"
  echo ""
fi

# Pass all arguments to the CLI
npm run cli -- generate-scraper-config "$@"
