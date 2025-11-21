#!/bin/bash
set -e

SERVICE_NAME="aztec-butler"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [ "$EUID" -ne 0 ]; then 
   echo "Please run with sudo"
   exit 1
fi

echo "Uninstalling Aztec Butler daemon..."

# Stop and disable service
echo "Stopping service..."
systemctl stop "$SERVICE_NAME" || true
systemctl disable "$SERVICE_NAME" || true

# Remove service file
echo "Removing service file..."
rm -f "$SERVICE_FILE"

# Reload systemd
echo "Reloading systemd..."
systemctl daemon-reload

echo ""
echo "✅ Aztec Butler uninstalled"
echo ""
echo "Note: Project files were not removed. Delete them manually if needed."
