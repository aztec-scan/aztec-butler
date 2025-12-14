#!/bin/bash
set -e

# Get entry queue statistics and timing estimates
# Usage: ./scripts/get-queue-stats.sh [--json] [--network <network>]

# Parse arguments
JSON_FLAG=""
NETWORK_FLAG=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --json)
      JSON_FLAG="--json"
      shift
      ;;
    --network)
      NETWORK_FLAG="--network $2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--json] [--network <network>]"
      exit 1
      ;;
  esac
done

# Run the command
npm run cli -- get-queue-stats $NETWORK_FLAG $JSON_FLAG
