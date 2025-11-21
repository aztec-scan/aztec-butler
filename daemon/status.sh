#!/bin/bash

SERVICE_NAME="aztec-butler"

echo "=== Aztec Butler Service Status ==="
echo ""
sudo systemctl status "$SERVICE_NAME" --no-pager
