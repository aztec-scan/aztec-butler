#!/bin/bash
# Generate calldata to add keys to staking provider
# Usage: ./scripts/add-keys.sh <keystore-file> [--update-config]
#
# This will:
# - Load the specified keystore file
# - Check for duplicate attesters in provider queue
# - Generate BLS registration data
# - Generate addKeysToProvider calldata
# - Optionally update scraper config with new attesters
#
# Arguments:
#   keystore-file: Path to keystore JSON file (required)
#   --update-config: Also update scraper config with new keys (optional)
#
# Examples:
#   ./scripts/add-keys.sh keystores/examples/key1.json
#   ./scripts/add-keys.sh keystores/production/testnet/key1.json --update-config

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$1" ]; then
  echo "❌ Error: Keystore file required"
  echo ""
  echo "Usage: $0 <keystore-file> [--update-config]"
  echo ""
  echo "Examples:"
  echo "  $0 keystores/examples/key1.json"
  echo "  $0 keystores/production/testnet/key1.json --update-config"
  exit 1
fi

KEYSTORE_FILE="$1"
UPDATE_CONFIG_FLAG="$2"

if [ ! -f "$PROJECT_DIR/$KEYSTORE_FILE" ]; then
  echo "❌ Error: Keystore file not found: $KEYSTORE_FILE"
  exit 1
fi

cd "$PROJECT_DIR"

echo "==================================="
echo "Add Keys to Staking Provider"
echo "==================================="
echo ""
echo "Keystore: $KEYSTORE_FILE"
if [ "$UPDATE_CONFIG_FLAG" = "--update-config" ]; then
  echo "Update config: YES"
  npm run cli -- add-keys "$KEYSTORE_FILE" --update-config
else
  echo "Update config: NO (use --update-config to enable)"
  npm run cli -- add-keys "$KEYSTORE_FILE"
fi
