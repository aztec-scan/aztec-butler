#!/bin/bash
# Process private keys to generate public keys and check provider queue
# Usage: ./scripts/process-private-keys.sh <private-key-file> [--output <output-file>]
#
# This will:
# - Load private keys from the specified file
# - Derive public keys (ETH address and BLS public key)
# - Log keys for GCP storage (placeholder)
# - Check provider queue for duplicate attesters
# - Generate output file with public keys only
#
# Arguments:
#   private-key-file: Path to private keys JSON file (required)
#   --output: Custom output file path (optional, default: public-<input-file>)
#
# Examples:
#   ./scripts/process-private-keys.sh new-private-keys.json
#   ./scripts/process-private-keys.sh new-private-keys.json --output public-keys.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$1" ]; then
  echo "❌ Error: Private key file required"
  echo ""
  echo "Usage: $0 <private-key-file> [--output <output-file>]"
  echo ""
  echo "Examples:"
  echo "  $0 new-private-keys.json"
  echo "  $0 new-private-keys.json --output public-keys.json"
  exit 1
fi

PRIVATE_KEY_FILE="$1"
shift

if [ ! -f "$PROJECT_DIR/$PRIVATE_KEY_FILE" ]; then
  echo "❌ Error: Private key file not found: $PRIVATE_KEY_FILE"
  exit 1
fi

cd "$PROJECT_DIR"

echo "==================================="
echo "Process Private Keys"
echo "==================================="
echo ""
echo "Input: $PRIVATE_KEY_FILE"
echo ""

npx tsx cli.ts process-private-keys "$PRIVATE_KEY_FILE" "$@"
