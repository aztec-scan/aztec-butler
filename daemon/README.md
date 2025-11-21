# Aztec Butler Daemon Setup

Scripts for manually setting up aztec-butler as a systemd service.

## Prerequisites

- Node.js v22.0.0 or higher (install script handles this)
- Ubuntu/Debian system with systemd
- Sudo/root access

## Quick Start

1. **Clone the project to the server:**
   ```bash
   cd /home/ubuntu
   git clone <repository-url> aztec-butler
   cd aztec-butler
   ```

2. **Install as a service:**
   ```bash
   sudo ./daemon/install.sh
   ```

3. **Check that it's running:**
   ```bash
   ./daemon/status.sh
   ```

## Service Management

### Using convenience scripts:

- **Status:** `./daemon/status.sh`
- **Logs (follow):** `./daemon/logs.sh`
- **Logs (last 50):** `./daemon/logs.sh --lines 50`

### Using systemctl directly:

- **Start:** `sudo systemctl start aztec-butler`
- **Stop:** `sudo systemctl stop aztec-butler`
- **Restart:** `sudo systemctl restart aztec-butler`
- **Status:** `sudo systemctl status aztec-butler`
- **Enable on boot:** `sudo systemctl enable aztec-butler`
- **Disable on boot:** `sudo systemctl disable aztec-butler`

### Using journalctl directly:

- **Follow logs:** `sudo journalctl -u aztec-butler -f`
- **Last 100 lines:** `sudo journalctl -u aztec-butler -n 100`
- **Since today:** `sudo journalctl -u aztec-butler --since today`
- **Since time:** `sudo journalctl -u aztec-butler --since "2025-11-21 10:00:00"`

## Configuration

The service runs with these settings:

- **User:** `ubuntu`
- **Working Directory:** `/home/ubuntu/aztec-butler`
- **Command:** `node dist/index.js serve`
- **Environment:** `NODE_ENV=production`
- **Auto-restart:** Enabled (5 second delay)

### Configuration Files

Make sure any required configuration files are present in `/home/ubuntu/aztec-butler/`:
- `.env` (if needed)
- Any other config files your application requires

## Updating the Service

To update the code and restart the service:

```bash
cd /home/ubuntu/aztec-butler
git pull
npm install
npm run build
sudo systemctl restart aztec-butler
./daemon/status.sh
```

## Uninstallation

To remove the service (keeps project files):

```bash
sudo ./daemon/uninstall.sh
```

To completely remove everything:

```bash
sudo ./daemon/uninstall.sh
cd /home/ubuntu
rm -rf aztec-butler
```

## Troubleshooting

### Service won't start

1. **Check the logs:**
   ```bash
   ./daemon/logs.sh --lines 100
   ```

2. **Verify Node.js version:**
   ```bash
   node -v  # Should be >= 22.0.0
   ```

3. **Check build output exists:**
   ```bash
   ls -la dist/index.js
   ```

4. **Verify file permissions:**
   ```bash
   ls -la /home/ubuntu/aztec-butler
   # Should be owned by ubuntu:ubuntu
   ```

### Port conflicts

If the service fails due to port conflicts, check what's using the port:

```bash
sudo lsof -i :9090  # Replace with your port
```

### Permission issues

If you see permission errors:

```bash
sudo chown -R ubuntu:ubuntu /home/ubuntu/aztec-butler
```

## Files Included

- `aztec-butler.service` - Systemd service configuration
- `install.sh` - Installation script (requires sudo)
- `uninstall.sh` - Uninstallation script (requires sudo)
- `status.sh` - Check service status
- `logs.sh` - View service logs
- `README.md` - This file

## Service Details

The systemd service file configures:

- Automatic restart on failure
- Starts after network is available
- Runs in production mode
- Logs to systemd journal (viewable with journalctl)
