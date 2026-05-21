#!/usr/bin/env bash
#
# Local test harness for `aztec-butler agent`.
#
# Lets you exercise the agent end-to-end on your workstation BEFORE deploying
# to beast-3 / beast-4. Nothing here touches production: all reads are
# read-only L1/L2 calls and metrics go to a throwaway local collector.
#
# Usage:
#   scripts/agent-local-test.sh dry-run [network]   # no collector, prints metrics to stdout
#   scripts/agent-local-test.sh up                  # start the local OTLP collector
#   scripts/agent-local-test.sh once [network]      # one scrape+export into the local collector
#   scripts/agent-local-test.sh run [network]       # run the agent continuously (Ctrl+C to stop)
#   scripts/agent-local-test.sh logs                # tail the collector logs (metrics appear here)
#   scripts/agent-local-test.sh down                # stop + remove the local collector
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/tests/local-otel/docker-compose.yml"
ACTION="${1:-help}"
NETWORK="${2:-mainnet}"

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  else
    docker-compose -f "$COMPOSE_FILE" "$@"
  fi
}

case "$ACTION" in
  up)
    echo "Starting local OTLP collector (otel-collector-contrib:0.107.0)..."
    compose up -d
    echo "Collector listening on 127.0.0.1:4318 (HTTP) and 127.0.0.1:4317 (gRPC)."
    echo "Tail metrics with: scripts/agent-local-test.sh logs"
    ;;

  down)
    echo "Stopping local OTLP collector..."
    compose down
    ;;

  logs)
    echo "Tailing collector logs — exported metrics appear here (Ctrl+C to stop)..."
    compose logs -f
    ;;

  dry-run)
    echo "Running agent for '$NETWORK' in --dry-run mode (metrics printed to stdout, no collector)..."
    cd "$REPO_ROOT"
    npm run dev:agent -- --network "$NETWORK" --mode all --once --dry-run
    ;;

  once)
    echo "Ensuring local collector is up..."
    compose up -d
    sleep 2
    echo "Running a single agent scrape+export for '$NETWORK' into the local collector..."
    cd "$REPO_ROOT"
    npm run dev:agent -- --network "$NETWORK" --mode all --once
    echo
    echo "Exported. Inspect what arrived with: scripts/agent-local-test.sh logs"
    ;;

  run)
    echo "Ensuring local collector is up..."
    compose up -d
    sleep 2
    echo "Running agent continuously for '$NETWORK' (Ctrl+C to stop)..."
    cd "$REPO_ROOT"
    npm run dev:agent -- --network "$NETWORK" --mode all
    ;;

  *)
    sed -n '3,18p' "${BASH_SOURCE[0]}"
    exit 1
    ;;
esac
