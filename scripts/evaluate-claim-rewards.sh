#!/bin/bash
# Evaluate whether pending sequencer rewards are worth claiming per coinbase.
# Usage:
#   ./scripts/evaluate-claim-rewards.sh --network mainnet --rollup 0xae2001f7e21d5ecabf6234e9fdd1e76f50f74962

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

npm run cli -- evaluate-claim-rewards "$@"
