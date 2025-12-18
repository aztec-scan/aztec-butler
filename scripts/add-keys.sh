#!/bin/bash
# Generate calldata to add keys to staking provider
# Usage: ./scripts/add-keys.sh <keystore-file> [--network <network>] [--update-config]
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
#   --network: Network to use (mainnet, testnet, etc.) (optional)
#   --update-config: Also update scraper config with new keys (optional)
#
# Examples:
#   ./scripts/add-keys.sh keystores/examples/key1.json
#   ./scripts/add-keys.sh keystores/production/testnet/key1.json --update-config
#   ./scripts/add-keys.sh keystores/production/mainnet/key1.json --network mainnet

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$1" ]; then
  echo "❌ Error: Keystore file required"
  echo ""
  echo "Usage: $0 <keystore-file> [--network <network>] [--update-config]"
  echo ""
  echo "Examples:"
  echo "  $0 keystores/examples/key1.json"
  echo "  $0 keystores/production/testnet/key1.json --update-config"
  echo "  $0 keystores/production/mainnet/key1.json --network mainnet"
  exit 1
fi

KEYSTORE_FILE="$1"
shift

# Parse optional flags
NETWORK_FLAG=""
UPDATE_CONFIG_FLAG=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --network)
      NETWORK_FLAG="--network $2"
      shift 2
      ;;
    --update-config)
      UPDATE_CONFIG_FLAG="--update-config"
      shift
      ;;
    *)
      echo "❌ Error: Unknown option: $1"
      exit 1
      ;;
  esac
done

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
if [ -n "$NETWORK_FLAG" ]; then
  echo "Network: ${NETWORK_FLAG#--network }"
fi
if [ -n "$UPDATE_CONFIG_FLAG" ]; then
  echo "Update config: YES"
else
  echo "Update config: NO (use --update-config to enable)"
fi

# Build the CLI command
CLI_CMD="npm run cli -- $NETWORK_FLAG add-keys \"$KEYSTORE_FILE\" $UPDATE_CONFIG_FLAG"
eval $CLI_CMD
