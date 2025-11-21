#!/bin/bash
set -e

SERVICE_NAME="aztec-butler"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "Installing Aztec Butler daemon..."

# Check if running as root/sudo
if [ "$EUID" -ne 0 ]; then
  echo "Please run with sudo"
  exit 1
fi

# Detect the actual user who invoked sudo
ACTUAL_USER="${SUDO_USER:-$(whoami)}"
if [ "$ACTUAL_USER" = "root" ]; then
  echo "Error: Cannot determine the actual user. Please run with sudo as a regular user."
  exit 1
fi

# Detect the installation directory (current directory)
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Detected user: $ACTUAL_USER"
echo "Installation directory: $INSTALL_DIR"

# Get the user's primary group
USER_GROUP=$(id -gn "$ACTUAL_USER")

# Install Node.js 22 if not present
if ! command -v node &>/dev/null || [ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 22 ]; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Build the project
echo "Building project..."
sudo -u "$ACTUAL_USER" npm ci
sudo -u "$ACTUAL_USER" npm run build

# Generate service file dynamically
echo "Generating service file..."
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Aztec Butler - Prometheus monitoring and automation for Aztec nodes
After=network.target
Wants=network.target

[Service]
Type=simple
User=$ACTUAL_USER
Group=$USER_GROUP
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/npm run start:serve
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PATH=/usr/bin:/usr/local/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

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
echo "  Check status:     sudo systemctl status ${SERVICE_NAME}"
echo "  Stop service:     sudo systemctl stop ${SERVICE_NAME}"
echo "  Start service:    sudo systemctl start ${SERVICE_NAME}"
echo "  Restart service:  sudo systemctl restart ${SERVICE_NAME}"
echo ""
echo "View logs:"
echo "  Follow logs:      sudo journalctl -u ${SERVICE_NAME} -f"
echo "  Last 100 lines:   sudo journalctl -u ${SERVICE_NAME} -n 100"
echo "  All logs:         sudo journalctl -u ${SERVICE_NAME} --no-pager"
echo "  Logs since time:  sudo journalctl -u ${SERVICE_NAME} --since '1 hour ago'"
echo ""
echo "Or use helper scripts:"
echo "  ./daemon/status.sh"
echo "  ./daemon/logs.sh"
