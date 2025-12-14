#!/bin/bash

# Start Aztec Butler in server (scraper) mode
#
# Usage: 
#   ./scripts/start-server.sh                    # Run all networks
#   ./scripts/start-server.sh --network mainnet  # Run specific network
#
# Prerequisites:
# - Environment config: ~/.config/aztec-butler/{network}-base.env
# - Optional: Cached attesters: ~/.local/share/aztec-butler/{network}-cached-attesters.json
# - Optional: Available publishers: ~/.local/share/aztec-butler/{network}-available-publishers.json
#
# The server will:
# - Load cached attesters and publishers if available (will be populated on first scrape if missing)
# - Start Prometheus metrics exporter on port 9464
# - Run periodic scrapers for on-chain data
# - Track attester states and publisher balances

set -e

cd "$(dirname "$0")/.."

echo "Starting Aztec Butler server..."
echo "Press Ctrl+C to stop"
echo ""

npm start -- serve "$@"
