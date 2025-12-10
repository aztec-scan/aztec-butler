#!/bin/bash
# Generate scraper configuration from keystores
# Usage: ./scripts/generate-scraper-config.sh
#
# This will:
# - Find all keystores in ./keystores/
# - Extract attesters and publishers
# - Query staking provider from chain
# - Generate scraper config with coinbase mappings
#
# Output: ~/.local/share/aztec-butler/{network}-scrape-config.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "==================================="
echo "Generate Scraper Configuration"
echo "==================================="
echo ""
echo "Using keystores from: ./keystores/"
echo ""

npm run cli -- generate-scraper-config
