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

# Detect the actual node and npm paths for the user
echo "Detecting Node.js and npm paths for user $ACTUAL_USER..."

# Try multiple methods to find node/npm
# Method 1: Using bash -l -c (login shell) - get only lines starting with /
NODE_PATH=$(sudo -u "$ACTUAL_USER" bash -l -c 'which node 2>/dev/null' 2>/dev/null | grep '^/' | head -n1)
NPM_PATH=$(sudo -u "$ACTUAL_USER" bash -l -c 'which npm 2>/dev/null' 2>/dev/null | grep '^/' | head -n1)

# Method 2: If method 1 fails, try with explicit PATH from common locations
if [ -z "$NODE_PATH" ]; then
  echo "Method 1 failed, trying common paths..."
  for node_dir in /usr/local/bin /usr/bin ~/.nvm/versions/node/*/bin /home/$ACTUAL_USER/.nvm/versions/node/*/bin; do
    if [ -x "$node_dir/node" ]; then
      NODE_PATH="$node_dir/node"
      NPM_PATH="$node_dir/npm"
      echo "Found in $node_dir"
      break
    fi
  done
fi

if [ -z "$NODE_PATH" ] || [ -z "$NPM_PATH" ]; then
  echo "Error: Could not detect node or npm paths for user $ACTUAL_USER"
  echo "NODE_PATH: '$NODE_PATH'"
  echo "NPM_PATH: '$NPM_PATH'"
  echo ""
  echo "Please ensure Node.js 22+ is installed and accessible to user $ACTUAL_USER"
  echo "Try running: sudo -u $ACTUAL_USER which node"
  exit 1
fi

# Verify node works and check version
NODE_VERSION=$(sudo -u "$ACTUAL_USER" "$NODE_PATH" --version 2>/dev/null)
if [ -z "$NODE_VERSION" ]; then
  echo "Error: Detected node at $NODE_PATH but it doesn't work"
  exit 1
fi

NODE_MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_MAJOR_VERSION" -lt 22 ]; then
  echo "Error: Node.js version 22+ required, found $NODE_VERSION at $NODE_PATH"
  exit 1
fi

echo "✓ Detected Node.js: $NODE_PATH ($NODE_VERSION)"
echo "✓ Detected npm: $NPM_PATH"

# Extract directory paths for PATH environment variable
NODE_BIN_DIR=$(dirname "$NODE_PATH")
NPM_BIN_DIR=$(dirname "$NPM_PATH")

# Build the project
echo "Building project..."
sudo -u "$ACTUAL_USER" npm ci
sudo -u "$ACTUAL_USER" npm run build

# Generate service file dynamically
echo "Generating service file..."
cat > "$SERVICE_FILE" <<'EOF_HEADER'
[Unit]
Description=Aztec Butler - Prometheus monitoring and automation for Aztec nodes
After=network.target
Wants=network.target

[Service]
Type=simple
EOF_HEADER

cat >> "$SERVICE_FILE" <<EOF
User=$ACTUAL_USER
Group=$USER_GROUP
WorkingDirectory=$INSTALL_DIR
ExecStart=$NPM_PATH run start:serve
Restart=always
RestartSec=5
Environment="NODE_ENV=production"
Environment="PATH=$NODE_BIN_DIR:/usr/bin:/usr/local/bin:/bin"

[Install]
WantedBy=multi-user.target
EOF

echo ""
echo "Generated service file:"
cat "$SERVICE_FILE"
echo ""

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
