#!/bin/bash
# Prepare deployment by merging production keys with new public keys
# Usage: ./scripts/prepare-deployment.sh <production-keys> <new-public-keys> <available-publishers> [options]
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
#   available-publishers: Path to JSON array of publisher addresses (required)
#
# Options:
#   --high-availability-count <n>: Create N files with non-overlapping publishers
#   --output <path>: Custom output file path (default: <production-keys>.new)
#
# Examples:
#   # Basic usage
#   ./scripts/prepare-deployment.sh \
#     prod-testnet-keyfile.json \
#     new-public-keys.json \
#     testnet_available_publisher_addresses.json
#
#   # High availability mode (3-way split)
#   ./scripts/prepare-deployment.sh \
#     prod-testnet-keyfile.json \
#     new-public-keys.json \
#     testnet_available_publisher_addresses.json \
#     --high-availability-count 3
#
#   # Custom output path
#   ./scripts/prepare-deployment.sh \
#     prod-testnet-keyfile.json \
#     new-public-keys.json \
#     testnet_available_publisher_addresses.json \
#     --output /path/to/output.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
  echo "❌ Error: Missing required arguments"
  echo ""
  echo "Usage: $0 <production-keys> <new-public-keys> <available-publishers> [options]"
  echo ""
  echo "Options:"
  echo "  --high-availability-count <n>  Create N files with non-overlapping publishers"
  echo "  --output <path>                Custom output file path"
  echo ""
  echo "Examples:"
  echo "  $0 prod-testnet-keyfile.json new-public-keys.json publishers.json"
  echo "  $0 prod.json new.json pubs.json --high-availability-count 3"
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
