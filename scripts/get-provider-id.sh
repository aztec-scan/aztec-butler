#!/bin/bash
# Get staking provider ID for an admin address
# Usage: ./scripts/get-provider-id.sh <admin-address>
#
# This will:
# - Query the staking registry for provider information
# - Return provider ID, admin address, take rate, and rewards recipient
#
# Example:
#   ./scripts/get-provider-id.sh 0x1234567890abcdef1234567890abcdef12345678

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

if [ -z "$1" ]; then
  echo "❌ Error: Admin address required"
  echo ""
  echo "Usage: ./scripts/get-provider-id.sh <admin-address>"
  echo ""
  echo "Example:"
  echo "  ./scripts/get-provider-id.sh 0x1234567890abcdef1234567890abcdef12345678"
  exit 1
fi

echo "==================================="
echo "Get Staking Provider ID"
echo "==================================="
echo ""

npx tsx cli.ts get-provider-id "$1"
