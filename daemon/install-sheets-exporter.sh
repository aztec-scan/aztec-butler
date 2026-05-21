#!/bin/bash
#
# Install the aztec-butler staking-rewards SHEETS-EXPORTER as a systemd service.
#
# Usage: sudo ./daemon/install-sheets-exporter.sh [network]
#   network — defaults to mainnet
#
# The sheets-exporter is the event-sourced rewards accounting ledger (Part 2
# Phase B). It runs on the monitoring server, reads chain state, and writes the
# daily ledger to Google Sheets. The service is self-healing: on first start it
# reconstructs the full history, and after downtime it catches up automatically.
#
set -e

SERVICE_NAME="aztec-butler-sheets-exporter"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NETWORK="${1:-mainnet}"

echo "Installing Aztec Butler sheets-exporter daemon (network: ${NETWORK})..."

if [ "$EUID" -ne 0 ]; then
  echo "Please run with sudo"
  exit 1
fi

ACTUAL_USER="${SUDO_USER:-$(whoami)}"
if [ "$ACTUAL_USER" = "root" ]; then
  echo "Error: Cannot determine the actual user. Please run with sudo as a regular user."
  exit 1
fi

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_GROUP=$(id -gn "$ACTUAL_USER")
echo "Detected user: $ACTUAL_USER"
echo "Installation directory: $INSTALL_DIR"

# Data directory (env-paths) — the sheets-exporter writes the rewards cursor and
# the coinbase-mapping cache here. Must be pre-created and made writable under
# the read-only systemd hardening below.
DATA_DIR="/home/$ACTUAL_USER/.local/share/aztec-butler"
sudo -u "$ACTUAL_USER" mkdir -p "$DATA_DIR"
echo "Data directory: $DATA_DIR"

if ! command -v node &>/dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 22 ]; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

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
echo "✓ Node.js: $NODE_PATH ($(sudo -u "$ACTUAL_USER" "$NODE_PATH" --version 2>/dev/null))"
NODE_BIN_DIR=$(dirname "$NODE_PATH")

echo "Building project..."
cd "$INSTALL_DIR"
sudo -u "$ACTUAL_USER" npm ci
sudo -u "$ACTUAL_USER" npm run build

echo "Generating service file..."
cat > "$SERVICE_FILE" <<EOF_HEADER
[Unit]
Description=Aztec Butler sheets-exporter - staking-rewards accounting ledger for ${NETWORK}
After=network.target
Wants=network.target
# Never give up restarting — a throttled cold-start backfill may crash-resume
# many times before it completes.
StartLimitIntervalSec=0

[Service]
Type=simple
EOF_HEADER

cat >> "$SERVICE_FILE" <<EOF
User=$ACTUAL_USER
Group=$USER_GROUP
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_PATH $INSTALL_DIR/dist/index.js sheets-exporter --network ${NETWORK}
Restart=always
RestartSec=30
Environment="NODE_ENV=production"
Environment="PATH=$NODE_BIN_DIR:/usr/bin:/usr/local/bin:/bin"
# Hardening: read-only against the chain. The only writable path is the
# env-paths data dir (rewards cursor + coinbase-mapping cache).
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$DATA_DIR
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
echo "✅ Aztec Butler sheets-exporter installed and started (${NETWORK})"
echo ""
echo "Useful commands:"
echo "  Check status:  sudo systemctl status ${SERVICE_NAME}"
echo "  Follow logs:   sudo journalctl -u ${SERVICE_NAME} -f"
echo ""
echo "On first start the service does a cold-start catch-up (reconstructs the full"
echo "history) — follow the logs for 'catch-up progress' lines."
echo "Optionally pre-fill faster in tmux before/instead:"
echo "  $NODE_PATH $INSTALL_DIR/dist/index.js sheets-exporter --network ${NETWORK} --backfill"
echo "See docs/sheets-exporter.md."
