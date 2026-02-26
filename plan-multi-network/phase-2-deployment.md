# Phase 2: aztlan-ops Deployment Changes

## Overview

Add testnet and devnet env configs, hosts config, and switch the daemon install from mainnet-only to all-networks mode.

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

# Staking Provider Configuration (not configured yet for testnet)
# AZTEC_STAKING_PROVIDER_ID=
# AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS=

# Safe Multisig Configuration (not configured for testnet)
# SAFE_ADDRESS=

# Publisher Configuration
MIN_ETH_PER_ATTESTER=0.1

# Metrics (shared bearer token across all networks)
METRICS_BEARER_TOKEN={{ monitoring_server_butler_metrics_bearer_token }}
```

**Notes:**

- No staking provider, Safe, or Google Sheets config. Butler gracefully skips those scrapers when unconfigured.
- Same bearer token as mainnet (single process, single metrics endpoint).

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

# Staking Provider Configuration (not configured yet for devnet)
# AZTEC_STAKING_PROVIDER_ID=
# AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS=

# Safe Multisig Configuration (not configured for devnet)
# SAFE_ADDRESS=

# Publisher Configuration
MIN_ETH_PER_ATTESTER=0.1

# Metrics (shared bearer token across all networks)
METRICS_BEARER_TOKEN={{ monitoring_server_butler_metrics_bearer_token }}
```

## Change 3: Add variables to `defaults/main.yml`

**File**: `roles/monitoring_server/defaults/main.yml` (edit)

Add after the existing mainnet butler variables:

```yaml
# Aztec Butler Testnet Configuration
monitoring_server_butler_testnet_ethereum_node_url: "https://rpc.sepolia.eth.beast-5.aztlanlabs.xyz"
monitoring_server_butler_testnet_ethereum_archive_node_url: "https://ethereum-sepolia-rpc.publicnode.com"
monitoring_server_butler_testnet_aztec_node_url: "http://51.89.11.124:8087"

# Aztec Butler Devnet Configuration
monitoring_server_butler_devnet_ethereum_node_url: "https://rpc.sepolia.eth.beast-5.aztlanlabs.xyz"
monitoring_server_butler_devnet_ethereum_archive_node_url: "https://ethereum-sepolia-rpc.publicnode.com"
monitoring_server_butler_devnet_aztec_node_url: "http://51.89.11.124:8086"
```

## Change 4: Update `aztec-butler.yml` tasks

**File**: `roles/monitoring_server/tasks/aztec-butler.yml` (edit)

### 4a: Add testnet env templating task

After the existing "Template mainnet-base.env" task, add:

```yaml
- name: Template testnet-base.env for butler
  tags: ["aztec_butler"]
  ansible.builtin.template:
    src: testnet-base.env.j2
    dest: "{{ monitoring_server_butler_config_dir }}/testnet-base.env"
    mode: "0644"

- name: Template devnet-base.env for butler
  tags: ["aztec_butler"]
  ansible.builtin.template:
    src: devnet-base.env.j2
    dest: "{{ monitoring_server_butler_config_dir }}/devnet-base.env"
    mode: "0644"
```

### 4b: Add devnet hosts templating task

After the existing "Template testnet-hosts.json" task, add:

```yaml
- name: Template devnet-hosts.json for butler
  tags: ["aztec_butler"]
  ansible.builtin.template:
    src: aztec-butler-hosts.json.j2
    dest: "{{ monitoring_server_butler_config_dir }}/devnet-hosts.json"
    mode: "0644"
  vars:
    butler_network: devnet
```

### 4c: Switch from mainnet-only to all-networks daemon install

Change the install task:

**Before:**

```yaml
- name: Install butler daemon for mainnet (on git changes or if service not found)
  tags: ["aztec_butler"]
  ansible.builtin.command:
    cmd: "./daemon/install-mainnet.sh"
    chdir: "{{ monitoring_server_butler_repo_dir }}"
  become: true
  when: >-
    monitoring_server_butler_git_clone.changed or
    monitoring_server_butler_service_status.status is not defined or
    monitoring_server_butler_service_status.status.LoadState == "not-found"
  changed_when: true
```

**After:**

```yaml
- name: Install butler daemon for all networks (on git changes or if service not found)
  tags: ["aztec_butler"]
  ansible.builtin.command:
    cmd: "./daemon/install.sh"
    chdir: "{{ monitoring_server_butler_repo_dir }}"
  become: true
  when: >-
    monitoring_server_butler_git_clone.changed or
    monitoring_server_butler_service_status.status is not defined or
    monitoring_server_butler_service_status.status.LoadState == "not-found"
  changed_when: true
```

The only difference is `install.sh` vs `install-mainnet.sh`. The `install.sh` script uses `npm run start:serve` (no `--network` flag), which causes butler to auto-discover and load ALL `*-base.env` files.

## Change 5 (optional): Restart service on env file changes

Consider adding a handler or task to restart the butler service when any env template changes (not just keys files). Currently only keys file changes trigger a restart.

Add after the keys copy/restart block:

```yaml
- name: Restart aztec-butler service when config files change
  tags: ["aztec_butler"]
  ansible.builtin.systemd:
    name: aztec-butler
    state: restarted
  when:
    - monitoring_server_butler_env_template.changed | default(false)
    - monitoring_server_butler_service_status.status is defined
    - monitoring_server_butler_service_status.status.LoadState != "not-found"
```

This requires `register: monitoring_server_butler_env_template` on the template tasks. Alternatively, use Ansible handlers with `notify`.

## No Prometheus Config Changes Needed

The existing Prometheus scrape config already points to `localhost:9464` and scrapes all metrics. The `network` label on each metric differentiates the data. No changes needed in `prometheus.yml.j2`.

## Deployment Sequence

1. Merge Phase 1 fix in aztec-butler (dotenv isolation)
2. Apply aztlan-ops changes
3. Run Ansible playbook targeting gremlin-3:
   ```bash
   ansible-playbook site.yml -l gremlin-3 --tags aztec_butler
   ```
4. This will:
   - Template the new env files (testnet-base.env, devnet-base.env)
   - Template devnet-hosts.json
   - Pull latest butler code (with Phase 1 fix)
   - Run `./daemon/install.sh` (rebuild + restart with all networks)
5. Verify: `curl -H "Authorization: Bearer <token>" http://localhost:9464/metrics | grep network=`

## Rollback

If something breaks:

1. SSH to gremlin-3
2. Edit systemd service to add `--network mainnet` back:
   ```bash
   sudo systemctl edit aztec-butler
   # Add override: ExecStart=... serve --network mainnet
   sudo systemctl restart aztec-butler
   ```
3. Or re-run Ansible with `install-mainnet.sh` reverted

## File Summary

| File                            | Action                                                | Repo       |
| ------------------------------- | ----------------------------------------------------- | ---------- |
| `templates/testnet-base.env.j2` | **Create**                                            | aztlan-ops |
| `templates/devnet-base.env.j2`  | **Create**                                            | aztlan-ops |
| `defaults/main.yml`             | **Edit** -- add testnet/devnet variables              | aztlan-ops |
| `tasks/aztec-butler.yml`        | **Edit** -- add template tasks, change install script | aztlan-ops |
