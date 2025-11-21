#!/bin/bash
set -e

SERVICE_NAME="aztec-butler"
INSTALL_DIR="/home/ubuntu/aztec-butler"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "Installing Aztec Butler daemon..."

# Check if running as root/sudo
if [ "$EUID" -ne 0 ]; then 
   echo "Please run with sudo"
   exit 1
fi

# Install Node.js 22 if not present
if ! command -v node &> /dev/null || [ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 22 ]; then
    echo "Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
fi

# Create install directory if it doesn't exist
mkdir -p "$INSTALL_DIR"

# Copy service file
echo "Copying service file..."
cp daemon/aztec-butler.service "$SERVICE_FILE"

# Build the project
echo "Building project..."
npm install
npm run build

# Reload systemd
echo "Reloading systemd..."
systemctl daemon-reload

# Enable and start service
echo "Enabling and starting service..."
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo ""
echo "✅ Aztec Butler installed and started"
echo ""
echo "Useful commands:"
echo "  Check status: sudo systemctl status ${SERVICE_NAME}"
echo "  View logs:    sudo journalctl -u ${SERVICE_NAME} -f"
echo "  Or use:       ./daemon/status.sh"
echo "  Or use:       ./daemon/logs.sh"
