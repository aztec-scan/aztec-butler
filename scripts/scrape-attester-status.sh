#!/bin/bash
# Scrape attester on-chain status from Rollup contract
# Usage: 
#   ./scripts/scrape-attester-status.sh                           # Update cache and show all attesters (default)
#   ./scripts/scrape-attester-status.sh --active                  # Show active attesters from cache
#   ./scripts/scrape-attester-status.sh --queued                  # Show queued attesters from cache
#   ./scripts/scrape-attester-status.sh --provider-queue          # Show provider queue attesters from cache
#   ./scripts/scrape-attester-status.sh --active --queued         # Show all attesters from cache (same as default)
#   ./scripts/scrape-attester-status.sh --all-active              # Show ALL active attesters on-chain and update cache
#   ./scripts/scrape-attester-status.sh --all-queued              # Show ALL queued attesters on-chain
#   ./scripts/scrape-attester-status.sh --all-active --all-queued # Show ALL attesters on-chain
#   ./scripts/scrape-attester-status.sh --address 0x123...        # Check specific attester(s)
#
# This will:
# - Query the Rollup contract for attester status
# - Show on-chain state (NONE, VALIDATING, ZOMBIE, EXITING)
# - Display effective balance and exit information
# - List active and/or queued attesters
# - List provider queue attesters (requires AZTEC_STAKING_PROVIDER_ID in config)
# - AUTOMATICALLY update attester cache with current on-chain states
#
# Flags:
# --active      : Filter to active attesters from cache
# --queued      : Filter to queued attesters from cache
# --provider-queue : Filter to provider queue attesters from cache (requires AZTEC_STAKING_PROVIDER_ID)
# --all-active  : Show ALL active attesters on-chain (not limited to cache) and update cache
# --all-queued  : Show ALL queued attesters on-chain (not limited to cache)
# --address     : Check specific attester address(es)
#
# Use cases:
# - Monitor attester state transitions
# - Check if attesters are active vs queued
# - Check if attesters are in provider queue waiting to be added
# - Debug attester issues
# - Validate attester configuration
# - Automatically refresh attester cache with current states (happens on every run)

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
  echo "📝 Will update cache with discovered attesters"
  echo ""
elif [[ "$*" == *"--active"* ]]; then
  echo "🔍 Querying active attesters from cache"
  echo ""
fi

if [[ "$*" == *"--all-queued"* ]]; then
  echo "⏳ Querying ALL queued attesters from Rollup contract"
  echo ""
elif [[ "$*" == *"--queued"* ]]; then
  echo "⏳ Querying queued attesters from cache"
  echo ""
fi

if [[ "$*" == *"--provider-queue"* ]]; then
  echo "📦 Querying provider queue attesters from cache"
  echo ""
fi

if [[ "$*" == *"--address"* ]]; then
  echo "🎯 Querying specific attester(s)"
  echo ""
fi

if [[ $# -eq 0 ]]; then
  echo "📋 Automatically updating cache and showing attesters"
  echo ""
fi

# Pass all arguments to the CLI
npm run cli -- scrape-attester-status "$@"
