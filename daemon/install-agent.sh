#!/bin/bash
#
# Install the aztec-butler AGENT as a systemd service.
#
# Usage: sudo ./daemon/install-agent.sh <mode> [network]
#   mode    — node | global | all
#   network — defaults to mainnet
#
# The agent is the local, read-only telemetry process. It exports metrics over
# OTLP to an OpenTelemetry collector and runs no HTTP server. Run `node` on each
# sequencer host and `global` on the monitoring server — see
# docs/agent-deployment.md.
#
set -e

SERVICE_NAME="aztec-butler-agent"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
MODE="${1:-}"
NETWORK="${2:-mainnet}"

case "$MODE" in
  node | global | all) ;;
  *)
    echo "Error: first argument must be the run mode: node | global | all"
    echo "Usage: sudo ./daemon/install-agent.sh <mode> [network]"
    exit 1
    ;;
esac

echo "Installing Aztec Butler AGENT daemon (mode: ${MODE}, network: ${NETWORK})..."

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
USER_GROUP=$(id -gn "$ACTUAL_USER")

echo "Detected user: $ACTUAL_USER"
echo "Installation directory: $INSTALL_DIR"

# Install Node.js 22 if not present
if ! command -v node &>/dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 22 ]; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Detect node/npm paths for the user
NODE_PATH=$(sudo -u "$ACTUAL_USER" bash -l -c 'which node 2>/dev/null' 2>/dev/null | grep '^/' | head -n1)
NPM_PATH=$(sudo -u "$ACTUAL_USER" bash -l -c 'which npm 2>/dev/null' 2>/dev/null | grep '^/' | head -n1)
if [ -z "$NODE_PATH" ]; then
  for node_dir in /usr/local/bin /usr/bin /home/$ACTUAL_USER/.nvm/versions/node/*/bin; do
    if [ -x "$node_dir/node" ]; then
      NODE_PATH="$node_dir/node"
      NPM_PATH="$node_dir/npm"
      break
    fi
  done
fi
if [ -z "$NODE_PATH" ] || [ -z "$NPM_PATH" ]; then
  echo "Error: Could not detect node/npm for user $ACTUAL_USER"
  exit 1
fi

NODE_VERSION=$(sudo -u "$ACTUAL_USER" "$NODE_PATH" --version 2>/dev/null)
NODE_MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_MAJOR_VERSION" -lt 22 ]; then
  echo "Error: Node.js 22+ required, found $NODE_VERSION at $NODE_PATH"
  exit 1
fi
echo "✓ Node.js: $NODE_PATH ($NODE_VERSION)"

NODE_BIN_DIR=$(dirname "$NODE_PATH")

# Build the project
echo "Building project..."
cd "$INSTALL_DIR"
sudo -u "$ACTUAL_USER" npm ci
sudo -u "$ACTUAL_USER" npm run build

# Generate service file
echo "Generating service file..."
cat > "$SERVICE_FILE" <<EOF_HEADER
[Unit]
Description=Aztec Butler Agent (${MODE}) - read-only telemetry (OTLP) for ${NETWORK}
After=network.target
Wants=network.target

[Service]
Type=simple
EOF_HEADER

cat >> "$SERVICE_FILE" <<EOF
User=$ACTUAL_USER
Group=$USER_GROUP
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_PATH $INSTALL_DIR/dist/index.js agent --mode ${MODE} --network ${NETWORK}
Restart=always
RestartSec=5
Environment="NODE_ENV=production"
Environment="PATH=$NODE_BIN_DIR:/usr/bin:/usr/local/bin:/bin"
# Hardening: agent mode is read-only.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

echo ""
echo "Generated service file:"
cat "$SERVICE_FILE"
echo ""

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo ""
echo "✅ Aztec Butler AGENT installed and started (mode: ${MODE}, network: ${NETWORK})"
echo ""
echo "Useful commands:"
echo "  Check status:  sudo systemctl status ${SERVICE_NAME}"
echo "  Follow logs:   sudo journalctl -u ${SERVICE_NAME} -f"
echo "  Stop service:  sudo systemctl stop ${SERVICE_NAME}"
echo ""
echo "Reminder: chain/RPC settings come from the ${NETWORK}-base.env file."
echo "See docs/agent-deployment.md."
