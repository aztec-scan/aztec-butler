# Metrics Scraping Fix - Solution 1 Implementation

## Problem
Prometheus metrics for attester states were not updating even though scrapers were running and updating internal state correctly. The `aztec_butler_entry_queue_length` metric was updating, but `aztec_butler_nbrof_attesters_in_state` remained static.

## Root Cause Analysis
The issue was related to how OpenTelemetry's ObservableGauge callbacks work with the Prometheus exporter. The callbacks are invoked when Prometheus scrapes the `/metrics` endpoint, but there was no visibility into:
1. Whether callbacks were being invoked
2. What data they were reading
3. Whether the data was stale

## Changes Implemented

### 1. Added Debug Logging to Metrics Callbacks

**Files Modified:**
- `src/server/metrics/attester-metrics.ts`
- `src/server/metrics/entry-queue-metrics.ts`
- `src/server/metrics/staking-provider-metrics.ts`

**Changes:**
- Added timestamp logging when each ObservableGauge callback is invoked
- Added logging of the actual metric values being observed
- Added network-specific logging to track multi-network setups

**Example:**
```typescript
nbrofAttestersInStateGauge.addCallback((observableResult) => {
  const now = new Date().toISOString();
  console.log(`[Metrics/Callback] nbrofAttestersInStateGauge invoked at ${now}`);
  
  const networkStates = getAllNetworkStates();
  console.log(`[Metrics/Callback] Found ${networkStates.size} network(s)`);

  for (const [network, _state] of networkStates.entries()) {
    const stateCounts = countAttestersByState(network);
    console.log(`[Metrics/Callback/${network}] State counts:`, Object.fromEntries(stateCounts));
    // ... observe metrics
  }
});
```

### 2. Added Staleness Detection Metrics

**New Metrics Added:**
- `aztec_butler_attester_states_last_updated_timestamp` - Unix timestamp of most recent attester state update
- `aztec_butler_entry_queue_last_scraped_timestamp` - Unix timestamp when entry queue was last scraped
- `aztec_butler_staking_provider_last_scraped_timestamp` - Unix timestamp when staking provider was last scraped

**Purpose:**
These metrics allow you to:
1. Detect when scrapers stop updating data
2. Calculate data freshness/staleness
3. Set up Prometheus alerts for stale data

**Example PromQL query:**
```promql
# Time since last attester state update (in seconds)
time() - aztec_butler_attester_states_last_updated_timestamp{network="mainnet"}

# Alert if data is stale (>5 minutes)
time() - aztec_butler_attester_states_last_updated_timestamp{network="mainnet"} > 300
```

### 3. Added State Access Logging

**Files Modified:**
- `src/server/state/index.ts`

**Changes:**
- Added logging to `countAttestersByState()` to show what's being read
- Added logging to `getEntryQueueStats()` to show what's being returned

**Purpose:**
This helps diagnose if the state itself is stale or if the metrics callbacks are reading stale/cached data.

### 4. Added Scrape Request Logging

**Files Modified:**
- `src/server/metrics/registry.ts`

**Changes:**
- Added logging when Prometheus requests the `/metrics` endpoint
- Logs timestamp and source IP of scrape requests

**Purpose:**
Confirms that Prometheus is actually scraping the endpoint and helps correlate scrape times with callback invocations.

## How to Use These Changes

### 1. Monitoring Logs
When Prometheus scrapes your metrics, you should now see logs like:

```
[Metrics/Scrape] Prometheus scrape requested at 2025-12-15T19:30:00.000Z
[Metrics/Scrape] Request from: 51.91.56.205
[Metrics/Callback] nbrofAttestersInStateGauge invoked at 2025-12-15T19:30:00.001Z
[Metrics/Callback] Found 1 network(s)
[State/mainnet] countAttestersByState called - total attesters: 130, counts: { NEW: 0, IN_STAKING_PROVIDER_QUEUE: 30, ROLLUP_ENTRY_QUEUE: 82, ACTIVE: 18, NO_LONGER_ACTIVE: 0 }
[Metrics/Callback/mainnet] State counts: { NEW: 0, IN_STAKING_PROVIDER_QUEUE: 30, ROLLUP_ENTRY_QUEUE: 82, ACTIVE: 18, NO_LONGER_ACTIVE: 0 }
```

### 2. Debugging Workflow

If attester states are still not updating:

1. **Check if Prometheus is scraping:**
   - Look for `[Metrics/Scrape]` logs
   - If missing, Prometheus isn't reaching your endpoint

2. **Check if callbacks are invoked:**
   - Look for `[Metrics/Callback]` logs immediately after scrape logs
   - If missing, OpenTelemetry exporter has an issue

3. **Check if state is updating:**
   - Look for `[staking-provider] Attester States:` logs every 30s
   - Compare timestamps in scraper logs vs callback logs

4. **Check staleness metrics:**
   - Query `aztec_butler_attester_states_last_updated_timestamp`
   - Compare to current time to see data freshness

### 3. Setting Up Prometheus Alerts

Add to your Prometheus alert rules:

```yaml
groups:
  - name: aztec_butler_staleness
    interval: 1m
    rules:
      - alert: AttesterStatesStale
        expr: (time() - aztec_butler_attester_states_last_updated_timestamp) > 300
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Attester states haven't updated in {{ $value }} seconds"
          
      - alert: EntryQueueStale
        expr: (time() - aztec_butler_entry_queue_last_scraped_timestamp) > 900
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Entry queue hasn't been scraped in {{ $value }} seconds"
```

## Testing the Fix

### Local Testing
```bash
# Build the project
npm run build

# Run the server (or use your existing daemon)
npm start

# In another terminal, scrape metrics manually
curl -H "Authorization: Bearer your_token" http://localhost:9464/metrics

# Check logs for callback invocations
journalctl -u aztec-butler -f | grep -E "(Metrics/Callback|Metrics/Scrape)"
```

### Production Deployment
```bash
# On your server (gremlin-1)
cd /path/to/aztec-butler
git pull  # or copy updated files

# Rebuild
npm run build

# Restart the service
sudo systemctl restart aztec-butler

# Monitor logs
sudo journalctl -u aztec-butler -f
```

## Expected Outcome

After deployment:
1. Every Prometheus scrape will produce verbose logs
2. You'll see exactly what data is being read from state
3. Staleness metrics will help identify if scrapers are stuck
4. If the issue persists, logs will show WHERE it's failing:
   - Prometheus not scraping → Network/config issue
   - Callbacks not invoked → OpenTelemetry issue
   - State not updating → Scraper issue
   - State updating but metrics wrong → Callback logic issue

## Next Steps (If Issue Persists)

If after deploying these changes the metrics still don't update:

1. **Check the logs** - The new logging will show exactly where the problem is
2. **Consider OpenTelemetry upgrade** - Version 0.208.0 is old; latest is 0.53.x
3. **Consider alternative metric types** - Switch from ObservableGauge to regular Gauge
4. **Implement Solution 2** - Add inter-scraper coordination (event-driven updates)

## Files Changed

- `src/server/metrics/attester-metrics.ts` - Added logging and staleness metric
- `src/server/metrics/entry-queue-metrics.ts` - Added logging and staleness metric
- `src/server/metrics/staking-provider-metrics.ts` - Added logging and staleness metric
- `src/server/metrics/registry.ts` - Added scrape request logging
- `src/server/state/index.ts` - Added state access logging

## Rollback Plan

If these changes cause issues:
```bash
git revert HEAD
npm run build
sudo systemctl restart aztec-butler
```

The changes are purely additive (logging + new metrics) and shouldn't break existing functionality.
