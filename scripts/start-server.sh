#!/bin/bash

# Start Aztec Butler in server (scraper) mode
# Requires scraper config to be generated first via generate-scraper-config.sh
#
# Usage: ./scripts/start-server.sh
#
# Prerequisites:
# - Scraper config exists: ~/.local/share/aztec-butler/{network}-scrape-config.json
# - Environment config: ~/.config/aztec-butler/{network}-base.env
#
# The server will:
# - Load scraper config (public keys only)
# - Start Prometheus metrics exporter on port 9464
# - Run periodic scrapers for on-chain data
# - Track attester states and publisher balances

set -e

cd "$(dirname "$0")/.."

echo "Starting Aztec Butler server..."
echo "Press Ctrl+C to stop"
echo ""

npm start -- serve
