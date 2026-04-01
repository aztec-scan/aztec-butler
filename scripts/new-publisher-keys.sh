#!/bin/bash
# Generate new publisher private keys and upload to GCP Secret Manager
# Usage: ./scripts/new-publisher-keys.sh -n <count> [--output-addresses <file>]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "==================================="
echo "New Publisher Keys"
echo "==================================="
echo ""

npx tsx cli.ts new-publisher-keys "$@"
