# Knowledge Base: Current Deployment (aztlan-ops)

## Deployment Topology

aztec-butler runs as a **single centralized systemd service on gremlin-3** (141.95.86.53), the monitoring server. It does NOT run on the beast servers. It reaches out to the beast servers' Aztec/Ethereum RPCs over the network.

```
gremlin-3 (141.95.86.53) -- monitoring server
├── Prometheus (port 9090)
├── Grafana (port 3333, proxied via nginx on 443)
├── Blackbox Exporter (port 9115)
├── Nginx + SSL (m.aztlanlabs.xyz)
└── aztec-butler systemd service (port 9464)
    └── currently: --network mainnet only
```

## Server Inventory

| Server    | IP              | Aztec Networks  | Eth Networks   | Aztec Ports                   | P2P Ports                       |
| --------- | --------------- | --------------- | -------------- | ----------------------------- | ------------------------------- |
| beast-3   | 146.59.108.112  | mainnet         | (uses beast-4) | 8085                          | 40404                           |
| beast-4   | 135.125.170.191 | mainnet         | mainnet        | 8085                          | 40404                           |
| beast-5   | 51.89.11.124    | devnet, testnet | sepolia        | 8086 (devnet), 8087 (testnet) | 40402 (devnet), 40403 (testnet) |
| gremlin-3 | 141.95.86.53    | -               | -              | -                             | -                               |
| gremlin-4 | 51.38.133.66    | -               | -              | -                             | -                               |

### beast-5 Aztec Node Details

```yaml
# devnet
- network: devnet
  p2p_port: 40402
  aztec_port: 8086
  aztec_admin_port: 8886
  aztec_version: "4.0.0-devnet.2-patch.1"
  ethereum_hosts: "https://rpc.sepolia.eth.beast-5.aztlanlabs.xyz,https://ethereum-sepolia-rpc.publicnode.com"
  registry_contract_address: "0x52945c29d2788ccb076e910509c0449bfcbe29e6"
  sequencing_enabled: false

# testnet
- network: testnet
  p2p_port: 40403
  aztec_port: 8087
  aztec_admin_port: 8887
  aztec_version: "3.0.2"
  ethereum_hosts: "https://rpc.sepolia.eth.beast-5.aztlanlabs.xyz,https://ethereum-sepolia-rpc.publicnode.com"
  sequencing_enabled: false
```

## Ansible Role: monitoring_server

### File map

```
roles/monitoring_server/
├── tasks/
│   ├── main.yml                    # Orchestrator, computes aztec_hosts_computed
│   ├── aztec-butler.yml            # Butler deployment tasks
│   ├── grafana.yml                 # Grafana setup
│   ├── prometheus.yml              # Prometheus setup
│   ├── blackbox-exporter.yml
│   ├── nginx.yml
│   ├── firewall.yml
│   └── users.yml
├── templates/
│   ├── mainnet-base.env.j2         # Butler mainnet env config
│   ├── aztec-butler-hosts.json.j2  # Butler hosts config (parameterized by butler_network)
│   ├── prometheus.yml.j2           # Prometheus scrape config
│   ├── grafana-alertrules.yml.j2   # Grafana alert rules
│   └── dashboards/aztec-butler/
│       ├── dashboard.json.j2
│       ├── panels/
│       │   ├── attester-states.json.j2
│       │   ├── publisher-metrics.json.j2
│       │   ├── entry-queue.json.j2
│       │   ├── host-connectivity.json.j2
│       │   └── data-freshness.json.j2
│       └── variables/              # empty
├── defaults/main.yml               # Default variables
├── files/
│   ├── mainnet-keys-beast-3-v1.json
│   ├── mainnet-keys-beast-4-v1.json
│   └── mainnet-staking-rewards-history.json
├── handlers/main.yml
└── meta/main.yml                   # Dependencies (gcp_service_account_key)
```

### Current aztec-butler.yml Task Flow

1. Install build tools (build-essential, python3-dev)
2. Create config dir (`~/.config/aztec-butler/`)
3. Create data dir (`~/.local/share/aztec-butler/`)
4. Check GCP SA key exists (for Google Sheets)
5. **Template `mainnet-base.env`** (only mainnet)
6. Template `mainnet-hosts.json` (butler_network: mainnet)
7. Template `testnet-hosts.json` (butler_network: testnet) -- exists but unused
8. Copy mainnet keys files to data dir (beast-3, beast-4, rewards history)
9. Clone aztec-butler repo (shallow, main branch)
10. Check if service exists
11. **Run `./daemon/install-mainnet.sh`** (mainnet-only mode)
12. Restart service on keys file change

### Key Ansible Variables (defaults/main.yml)

```yaml
# Directories
monitoring_server_butler_config_dir: "/home/{{ ansible_user }}/.config/aztec-butler"
monitoring_server_butler_data_dir: "/home/{{ ansible_user }}/.local/share/aztec-butler"
monitoring_server_butler_repo_dir: "/home/{{ ansible_user }}/aztec-butler"

# Mainnet config (the only network currently configured)
monitoring_server_butler_ethereum_node_url: "https://rpc.mainnet.eth.beast-4.aztlanlabs.xyz"
monitoring_server_butler_ethereum_archive_node_url: "https://ethereum-rpc.publicnode.com"
monitoring_server_butler_aztec_node_url: "http://135.125.170.191:8085"
monitoring_server_butler_staking_provider_id: "4"
monitoring_server_butler_metrics_bearer_token: "monitoring_server_butler_metrics_token_change_me"

# Staking rewards
monitoring_server_butler_staking_rewards_split_from_block: "23083526"
monitoring_server_butler_staking_rewards_scrape_interval_ms: "3600000"

# Google Sheets
monitoring_server_butler_google_sheets_spreadsheet_id: "1WRn8BVUe_Cb3gROUrXzXLRvzbDBQh-eA9-CZJ7Fmk3I"
monitoring_server_butler_gcp_project_id: "sequencermanagement"
```

### mainnet-base.env.j2 (current, only env template)

```env
NETWORK=mainnet
ETHEREUM_CHAIN_ID=1
ETHEREUM_NODE_URL={{ monitoring_server_butler_ethereum_node_url }}
ETHEREUM_ARCHIVE_NODE_URL={{ monitoring_server_butler_ethereum_archive_node_url }}
AZTEC_NODE_URL={{ monitoring_server_butler_aztec_node_url }}
AZTEC_STAKING_PROVIDER_ID={{ monitoring_server_butler_staking_provider_id }}
AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS={{ aztlan_labs_treasury_address }}
SAFE_ADDRESS={{ aztlan_labs_treasury_address }}
SAFE_API_KEY={{ aztec_butler_safe_api_key }}
MULTISIG_PROPOSER_PRIVATE_KEY={{ monitoring_server_butler_multisig_proposer_private_key }}
MIN_ETH_PER_ATTESTER={{ aztec_butler_min_eth_per_attester }}
METRICS_BEARER_TOKEN={{ monitoring_server_butler_metrics_bearer_token }}
GOOGLE_SERVICE_ACCOUNT_KEY_FILE={{ monitoring_server_butler_gcp_sa_key_path }}
GOOGLE_SHEETS_SPREADSHEET_ID={{ monitoring_server_butler_google_sheets_spreadsheet_id }}
GCP_PROJECT_ID={{ monitoring_server_butler_gcp_project_id }}
STAKING_REWARDS_SPLIT_FROM_BLOCK={{ ... }}
STAKING_REWARDS_SCRAPE_INTERVAL_MS={{ ... }}
GOOGLE_SHEETS_RANGE={{ ... }}
GOOGLE_SHEETS_COINBASES_RANGE={{ ... }}
GOOGLE_SHEETS_DAILY_PER_COINBASE_RANGE={{ ... }}
GOOGLE_SHEETS_DAILY_EARNED_RANGE={{ ... }}
```

### aztec-butler-hosts.json.j2 (host config template)

Parameterized by `butler_network`. Iterates all inventory hosts, filters aztec_nodes by `node.network == butler_network`, outputs JSON map:

```json
{
  "beast-3": {
    "ip": "146.59.108.112",
    "services": {
      "p2p": { "port": 40404 },
      "aztec_rpc": { "port": 8085 }
    },
    "base_domain": "beast-3.aztlanlabs.xyz"
  }
}
```

### Prometheus Scrape Config

Butler is scraped as a single job:

```yaml
- job_name: "aztec-butler-monitoring-server"
  static_configs:
    - targets: ["localhost:9464"]
  scrape_interval: 30s
  authorization:
    type: Bearer
    credentials: "{{ monitoring_server_butler_metrics_bearer_token }}"
```

No changes needed here for multi-network -- it's a single endpoint, network differentiation happens via metric labels.

### Grafana Dashboard

- UID: `aztec-butler-v1`
- 5 panel groups: Attester States, Publisher Metrics, Entry Queue, Host Connectivity, Data Freshness
- **14 queries hardcode `network="mainnet"`** across all panels
- Single template variable: `host_filter` (regex `/beast-.*/`)
- No `network` template variable exists

### Grafana Alerts

Alert group `aztec-node-monitoring-butler` dynamically generates per-host P2P alerts using `monitoring_server_aztec_hosts_computed` (computed in `tasks/main.yml`). This already iterates ALL hosts across ALL networks, so alerts for testnet/devnet hosts will be auto-generated once butler reports metrics for them.

### Daemon Scripts

**install-mainnet.sh** (currently used):

- Builds project (`npm ci && npm run build`)
- Creates systemd service with `ExecStart=node dist/index.js serve --network mainnet`

**install.sh** (exists, not currently used):

- Same build process
- Creates systemd service with `ExecStart=npm run start:serve` (loads ALL `*-base.env` files)
