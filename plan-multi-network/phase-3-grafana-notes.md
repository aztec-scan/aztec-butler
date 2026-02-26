# Phase 3: Grafana & Alerting Notes

> This phase is for your reference when updating dashboards later. No code changes required for butler itself.

## Dashboard: Add `network` Template Variable

The dashboard at `templates/dashboards/aztec-butler/dashboard.json.j2` currently has one template variable (`host_filter`). Add a `network` variable:

```json
{
  "current": {
    "selected": true,
    "text": "mainnet",
    "value": "mainnet"
  },
  "datasource": {
    "type": "prometheus",
    "uid": "{{ monitoring_server_ds_prometheus_uid }}"
  },
  "definition": "label_values(aztec_butler_config_info, network)",
  "hide": 0,
  "includeAll": true,
  "allValue": ".*",
  "label": "Network",
  "multi": true,
  "name": "network_filter",
  "query": {
    "query": "label_values(aztec_butler_config_info, network)",
    "refId": "StandardVariableQuery"
  },
  "refresh": 1,
  "regex": "",
  "skipUrlSync": false,
  "sort": 0,
  "type": "query"
}
```

Place this BEFORE the `host_filter` variable so network is selected first.

## Dashboard: Update `host_filter` to Scope by Network

Change the host_filter query to only show hosts for the selected network:

**Before:**

```
label_values(aztec_butler_host_info, host)
```

**After:**

```
label_values(aztec_butler_host_info{network=~"$network_filter"}, host)
```

## Dashboard: Replace Hardcoded `network="mainnet"` in Panel Queries

14 queries across 4 panel files hardcode `network="mainnet"`. Replace all with `network=~"$network_filter"`.

### Files and counts:

| Panel File                         | Occurrences                  |
| ---------------------------------- | ---------------------------- |
| `panels/attester-states.json.j2`   | 3                            |
| `panels/publisher-metrics.json.j2` | 1                            |
| `panels/entry-queue.json.j2`       | 7                            |
| `panels/data-freshness.json.j2`    | 3                            |
| `panels/host-connectivity.json.j2` | 0 (already uses host_filter) |

**Find and replace:**

```
network=\"mainnet\"  ->  network=~\"$network_filter\"
```

### Example:

**Before:**

```promql
aztec_butler_nbrof_attesters_in_state{network="mainnet"}
```

**After:**

```promql
aztec_butler_nbrof_attesters_in_state{network=~"$network_filter"}
```

## Dashboard: Update Tags

Change tags from `["aztec", "butler", "mainnet"]` to `["aztec", "butler"]`.

## Alerts: Already Multi-Network

The alert rules in `grafana-alertrules.yml.j2` already iterate dynamically over `monitoring_server_aztec_hosts_computed`, which includes ALL hosts across ALL networks from inventory. The alerts include `network` as a label. No changes needed -- once butler starts reporting testnet/devnet metrics, the alerts will fire for those hosts too.

Current alert generation:

```jinja2
{% for aztec_host in monitoring_server_aztec_hosts_computed %}
  - uid: aztec_butler_p2p_down_{{ aztec_host.alert_uid_suffix }}
    title: Aztec Node P2P Connection Down - {{ aztec_host.inventory_hostname }} ({{ aztec_host.network }})
    ...
    expr: aztec_butler_host_p2p_status{host="{{ aztec_host.inventory_hostname }}", ip="{{ aztec_host.ansible_host }}", port="{{ aztec_host.p2p_port }}"}
{% endfor %}
```

This will produce alerts for:

- beast-3 (mainnet)
- beast-4 (mainnet)
- beast-5 (devnet, p2p:40402)
- beast-5 (testnet, p2p:40403)

## Prometheus: No Changes Needed

Single scrape target `localhost:9464`, all networks differentiated by `network` label on each metric. The Prometheus config doesn't need to know about individual networks.

## Metric Labels Reference

After multi-network is live, key labels for filtering:

| Label         | Values                                                       | Used In             |
| ------------- | ------------------------------------------------------------ | ------------------- |
| `network`     | `mainnet`, `testnet`, `devnet`                               | All metrics         |
| `host`        | `beast-3`, `beast-4`, `beast-5`                              | Host metrics        |
| `state`       | `NEW`, `PROVIDER_QUEUE`, `ENTRY_QUEUE`, `ACTIVE`, `INACTIVE` | Attester metrics    |
| `publisher`   | `0x...`                                                      | Publisher metrics   |
| `provider_id` | `4`, etc.                                                    | Entry queue metrics |
