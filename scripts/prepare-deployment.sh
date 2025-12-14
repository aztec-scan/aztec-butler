#!/bin/bash
# Prepare deployment by merging production keys with new public keys
# Usage: ./scripts/prepare-deployment.sh <production-keys> <new-public-keys> <available-publishers> [options]
#
# The number of output files is automatically determined by the number of server keys
# in the available-publishers JSON file.
#
# This will:
# - Load production keyfile with remoteSigner
# - Load new public keys file (from process-private-keys)
# - Load available publisher addresses
# - Check for duplicate attesters
# - Validate coinbase addresses (fail on explicit zero-address)
# - Check publisher ETH balances
# - Generate merged output file(s) with round-robin publisher assignment
# - Update scraper config with new attesters
#
# Arguments:
#   production-keys: Path to existing production keyfile (required)
#   new-public-keys: Path to new public keys file (required)
#   available-publishers: Path to JSON object with server IDs as keys and publisher arrays as values (required)
#
# Options:
#   --output <path>: Custom output file path base (default: <production-keys>)
#
# Examples:
#   # Automatically generates one file per server in available_publishers
#   ./scripts/prepare-deployment.sh \
#     prod-testnet-keyfile.json \
#     new-public-keys.json \
#     testnet_available_publisher_addresses.json
#
#   # Output: prod-testnet-keyfile_server1_v1.json, prod-testnet-keyfile_server2_v1.json, etc.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
  echo "❌ Error: Missing required arguments"
  echo ""
  echo "Usage: $0 <production-keys> <new-public-keys> <available-publishers> [options]"
  echo ""
  echo "The number of output files is automatically determined by server keys in available-publishers."
  echo ""
  echo "Options:"
  echo "  --output <path>                Custom output file path base"
  echo ""
  echo "Examples:"
  echo "  $0 prod-testnet-keyfile.json new-public-keys.json publishers.json"
  echo "  $0 prod.json new.json pubs.json --output custom-output.json"
  exit 1
fi

PRODUCTION_KEYS="$1"
NEW_PUBLIC_KEYS="$2"
AVAILABLE_PUBLISHERS="$3"
shift 3

if [ ! -f "$PROJECT_DIR/$PRODUCTION_KEYS" ]; then
  echo "❌ Error: Production keys file not found: $PRODUCTION_KEYS"
  exit 1
fi

if [ ! -f "$PROJECT_DIR/$NEW_PUBLIC_KEYS" ]; then
  echo "❌ Error: New public keys file not found: $NEW_PUBLIC_KEYS"
  exit 1
fi

if [ ! -f "$PROJECT_DIR/$AVAILABLE_PUBLISHERS" ]; then
  echo "❌ Error: Available publishers file not found: $AVAILABLE_PUBLISHERS"
  exit 1
fi

cd "$PROJECT_DIR"

echo "==================================="
echo "Prepare Deployment"
echo "==================================="
echo ""
echo "Production keys: $PRODUCTION_KEYS"
echo "New public keys: $NEW_PUBLIC_KEYS"
echo "Available publishers: $AVAILABLE_PUBLISHERS"
echo ""

npm run cli -- prepare-deployment \
  --production-keys "$PRODUCTION_KEYS" \
  --new-public-keys "$NEW_PUBLIC_KEYS" \
  --available-publishers "$AVAILABLE_PUBLISHERS" \
  "$@"
