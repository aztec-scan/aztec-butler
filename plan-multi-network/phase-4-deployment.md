# Phase 4: aztlan-ops Deployment (3 Systemd Services)

## Overview

Replace the single `aztec-butler` service with three independent services, one per network.

## Change 1: Create `testnet-base.env.j2`

**File**: `roles/monitoring_server/templates/testnet-base.env.j2` (new)

```jinja2
# Network identification
NETWORK=testnet

# Ethereum Configuration (Sepolia)
ETHEREUM_CHAIN_ID=11155111
ETHEREUM_NODE_URL={{ monitoring_server_butler_testnet_ethereum_node_url }}
ETHEREUM_ARCHIVE_NODE_URL={{ monitoring_server_butler_testnet_ethereum_archive_node_url }}

# Aztec Configuration
AZTEC_NODE_URL={{ monitoring_server_butler_testnet_aztec_node_url }}

# Publisher Configuration
MIN_ETH_PER_ATTESTER=0.1

# Metrics
METRICS_BEARER_TOKEN={{ monitoring_server_butler_metrics_bearer_token }}
METRICS_PORT={{ monitoring_server_butler_testnet_metrics_port }}
```

## Change 2: Create `devnet-base.env.j2`

**File**: `roles/monitoring_server/templates/devnet-base.env.j2` (new)

```jinja2
# Network identification
NETWORK=devnet

# Ethereum Configuration (Sepolia)
ETHEREUM_CHAIN_ID=11155111
ETHEREUM_NODE_URL={{ monitoring_server_butler_devnet_ethereum_node_url }}
ETHEREUM_ARCHIVE_NODE_URL={{ monitoring_server_butler_devnet_ethereum_archive_node_url }}

# Aztec Configuration
AZTEC_NODE_URL={{ monitoring_server_butler_devnet_aztec_node_url }}

# Publisher Configuration
MIN_ETH_PER_ATTESTER=0.1

# Metrics
METRICS_BEARER_TOKEN={{ monitoring_server_butler_metrics_bearer_token }}
METRICS_PORT={{ monitoring_server_butler_devnet_metrics_port }}
```

## Change 3: Add `METRICS_PORT` to `mainnet-base.env.j2`

**File**: `roles/monitoring_server/templates/mainnet-base.env.j2` (edit)

Add at the bottom (or near `METRICS_BEARER_TOKEN`):

```jinja2
METRICS_PORT={{ monitoring_server_butler_mainnet_metrics_port | default('9464') }}
```

## Change 4: Add variables to `defaults/main.yml`

**File**: `roles/monitoring_server/defaults/main.yml` (edit)

```yaml
# Aztec Butler per-network metrics ports
monitoring_server_butler_mainnet_metrics_port: 9464
monitoring_server_butler_testnet_metrics_port: 9465
monitoring_server_butler_devnet_metrics_port: 9466

# Aztec Butler Testnet Configuration
monitoring_server_butler_testnet_ethereum_node_url: "https://rpc.sepolia.eth.beast-5.aztlanlabs.xyz"
monitoring_server_butler_testnet_ethereum_archive_node_url: "https://ethereum-sepolia-rpc.publicnode.com"
monitoring_server_butler_testnet_aztec_node_url: "http://51.89.11.124:8087"

# Aztec Butler Devnet Configuration
monitoring_server_butler_devnet_ethereum_node_url: "https://rpc.sepolia.eth.beast-5.aztlanlabs.xyz"
monitoring_server_butler_devnet_ethereum_archive_node_url: "https://ethereum-sepolia-rpc.publicnode.com"
monitoring_server_butler_devnet_aztec_node_url: "http://51.89.11.124:8086"
```

## Change 5: Rewrite `aztec-butler.yml` tasks

**File**: `roles/monitoring_server/tasks/aztec-butler.yml` (edit)

Key changes:

1. Template all three env files (mainnet, testnet, devnet)
2. Template all three hosts files (mainnet, testnet, devnet)
3. Still clone ONE repo (shared)
4. Run `install.sh` BUT override to create THREE systemd services

### Service creation approach

The simplest approach: keep using one `install.sh` invocation for the initial build (`npm ci && npm run build`), but create three systemd services manually via Ansible templates instead of relying on the shell script.

Create a systemd service template `aztec-butler@.service.j2`:

```ini
[Unit]
Description=Aztec Butler - %i network monitoring
After=network.target
Wants=network.target

[Service]
Type=simple
User={{ ansible_user }}
Group={{ ansible_user }}
WorkingDirectory={{ monitoring_server_butler_repo_dir }}
ExecStart={{ node_path }} {{ monitoring_server_butler_repo_dir }}/dist/index.js serve --network %i
Restart=always
RestartSec=5
Environment="NODE_ENV=production"
Environment="PATH={{ node_bin_dir }}:/usr/bin:/usr/local/bin:/bin"

[Install]
WantedBy=multi-user.target
```

Then in tasks:

```yaml
- name: Build butler
  command: "npm ci && npm run build"
  args:
    chdir: "{{ monitoring_server_butler_repo_dir }}"

- name: Create systemd services for each network
  template:
    src: aztec-butler@.service.j2
    dest: "/etc/systemd/system/aztec-butler-{{ item }}.service"
  loop:
    - mainnet
    - testnet
    - devnet
  notify: reload systemd

- name: Enable and start butler services
  systemd:
    name: "aztec-butler-{{ item }}"
    state: started
    enabled: true
  loop:
    - mainnet
    - testnet
    - devnet
```

**Important**: Disable/remove the old `aztec-butler` (without network suffix) service if it exists:

```yaml
- name: Stop and disable legacy aztec-butler service
  systemd:
    name: aztec-butler
    state: stopped
    enabled: false
  ignore_errors: true
```

## Change 6: Update Prometheus scrape config

**File**: `roles/monitoring_server/templates/prometheus.yml.j2` (edit)

Replace the single butler scrape job with three targets:

```yaml
- job_name: "aztec-butler"
  static_configs:
    - targets: ["localhost:{{ monitoring_server_butler_mainnet_metrics_port }}"]
      labels:
        hostname: "{{ inventory_hostname }}"
        network: "mainnet"
    - targets: ["localhost:{{ monitoring_server_butler_testnet_metrics_port }}"]
      labels:
        hostname: "{{ inventory_hostname }}"
        network: "testnet"
    - targets: ["localhost:{{ monitoring_server_butler_devnet_metrics_port }}"]
      labels:
        hostname: "{{ inventory_hostname }}"
        network: "devnet"
  scrape_interval: 30s
  metrics_path: /metrics
  scheme: http
  authorization:
    type: Bearer
    credentials: "{{ monitoring_server_butler_metrics_bearer_token }}"
```

## Deployment Sequence

1. Merge Phase 1+2 changes in aztec-butler, push to main
2. Apply all aztlan-ops changes
3. Run:
   ```bash
   ansible-playbook site.yml -l gremlin-3 --tags aztec_butler
   ```
4. Verify:
   ```bash
   # On gremlin-3
   systemctl status aztec-butler-mainnet
   systemctl status aztec-butler-testnet
   systemctl status aztec-butler-devnet
   curl -H "Authorization: Bearer <token>" localhost:9464/metrics | head
   curl -H "Authorization: Bearer <token>" localhost:9465/metrics | head
   curl -H "Authorization: Bearer <token>" localhost:9466/metrics | head
   ```

## Rollback

Each service is independent. If testnet/devnet cause issues:

```bash
sudo systemctl stop aztec-butler-testnet
sudo systemctl stop aztec-butler-devnet
```

Mainnet is completely unaffected.
