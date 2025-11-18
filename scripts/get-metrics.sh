#!/bin/bash

# Get metrics from Aztec Butler with Bearer token authentication
# Usage: ./scripts/get-metrics.sh [bearer-token] [url]
# Default token: default-api-key
# Default URL: http://localhost:9464/metrics

TOKEN="${1:-default-api-key}"
URL="${2:-http://localhost:9464/metrics}"

echo "Fetching metrics from Aztec Butler..."
echo "URL: $URL"
echo "Using Bearer token: $TOKEN"
echo ""

curl -s -w "\nHTTP Status: %{http_code}\n" \
     -H "Authorization: Bearer $TOKEN" \
     "$URL" | head -30
