#!/bin/bash
# Generate or update scraper configuration
# Usage: 
#   ./scripts/generate-scraper-config.sh --network mainnet                  # Update existing config with cached coinbases
#   ./scripts/generate-scraper-config.sh --network mainnet --provider-id 4  # Create new config with provider ID
#   ./scripts/generate-scraper-config.sh --network mainnet --prod-keyfile prod-keyfile.json  # Merge attesters from prod keyfile
#   ./scripts/generate-scraper-config.sh --network mainnet --output custom-path.json         # Custom output path
#
# This command:
# - Loads existing scraper config (or creates new one)
# - Updates attesters with cached coinbase mappings (if available)
# - Merges attesters from prod-keyfile (if provided, no duplicates)
# - Sets lastSeenState: NEW for new attesters without coinbase
# - Sets lastSeenState: IN_STAKING_QUEUE for attesters with coinbase
# - Preserves existing lastSeenState if already set
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

# Check if --prod-keyfile flag is provided
if [[ "$*" == *"--prod-keyfile"* ]]; then
  echo "Mode: Merge attesters from production keyfile"
  echo ""
elif [[ "$*" == *"--provider-id"* ]]; then
  echo "Mode: Create/update config with provider ID"
  echo ""
else
  echo "Mode: Update existing config with cached coinbases"
  echo ""
fi

# Pass all arguments to the CLI
npm run cli -- generate-scraper-config "$@"
