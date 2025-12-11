#!/bin/bash
# Scrape attester on-chain status from Rollup contract
# Usage: 
#   ./scripts/scrape-attester-status.sh                           # Show all attesters from scraper-config (default)
#   ./scripts/scrape-attester-status.sh --active                  # Show active attesters from scraper-config
#   ./scripts/scrape-attester-status.sh --queued                  # Show queued attesters from scraper-config
#   ./scripts/scrape-attester-status.sh --active --queued         # Show all attesters from scraper-config (same as default)
#   ./scripts/scrape-attester-status.sh --all-active              # Show ALL active attesters on-chain
#   ./scripts/scrape-attester-status.sh --all-queued              # Show ALL queued attesters on-chain
#   ./scripts/scrape-attester-status.sh --all-active --all-queued # Show ALL attesters on-chain
#   ./scripts/scrape-attester-status.sh --address 0x123...        # Check specific attester(s)
#
# This will:
# - Query the Rollup contract for attester status
# - Show on-chain state (NONE, VALIDATING, ZOMBIE, EXITING)
# - Display effective balance and exit information
# - List active and/or queued attesters
#
# Flags:
# --active      : Filter to active attesters from scraper-config
# --queued      : Filter to queued attesters from scraper-config
# --all-active  : Show ALL active attesters on-chain (not limited to config)
# --all-queued  : Show ALL queued attesters on-chain (not limited to config)
# --address     : Check specific attester address(es)
#
# Use cases:
# - Monitor attester state transitions
# - Check if attesters are active vs queued
# - Debug attester issues
# - Validate attester configuration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "==================================="
echo "Scrape Attester On-Chain Status"
echo "==================================="
echo ""

# Check flags and show info
if [[ "$*" == *"--all-active"* ]]; then
  echo "🔍 Querying ALL active attesters from Rollup contract"
  echo ""
elif [[ "$*" == *"--active"* ]]; then
  echo "🔍 Querying active attesters from scraper-config"
  echo ""
fi

if [[ "$*" == *"--all-queued"* ]]; then
  echo "⏳ Querying ALL queued attesters from Rollup contract"
  echo ""
elif [[ "$*" == *"--queued"* ]]; then
  echo "⏳ Querying queued attesters from scraper-config"
  echo ""
fi

if [[ "$*" == *"--address"* ]]; then
  echo "🎯 Querying specific attester(s)"
  echo ""
fi

if [[ $# -eq 0 ]]; then
  echo "📋 Querying attesters from scraper-config (default)"
  echo ""
fi

# Pass all arguments to the CLI
npm run cli -- scrape-attester-status "$@"
