#!/bin/bash

SERVICE_NAME="aztec-butler"

# Check if we should follow logs (default) or show last N lines
if [ "$1" == "--lines" ] || [ "$1" == "-n" ]; then
    LINES="${2:-50}"
    echo "=== Last ${LINES} lines of Aztec Butler logs ==="
    echo ""
    sudo journalctl -u "$SERVICE_NAME" -n "$LINES" --no-pager
else
    echo "=== Following Aztec Butler logs (Ctrl+C to exit) ==="
    echo ""
    sudo journalctl -u "$SERVICE_NAME" -f
fi
