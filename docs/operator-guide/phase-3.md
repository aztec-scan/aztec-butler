# Phase 3: Prepare Deployment

Create deployment-ready keyfiles with publisher assignments and update monitoring configuration.

## Overview

```mermaid
flowchart TD
    A[prod-testnet-keyfile.json] --> D[aztec-butler<br/>prepare-deployment]
    B[public-new-private-keys.json] --> D
    C[available_publisher_addresses.json] --> D

    D --> E{Validation}
    E -->|Valid| F[Deployment Files]
    E -->|Duplicate| G[Error: Duplicate attesters]
    E -->|Zero Coinbase| H[Error: Invalid coinbase]
    E -->|No ETH| I[Error: Publisher unfunded]

    F --> J[prod-testnet-keyfile.json.new]
    F --> K[Scraper Config Updated]

    style A fill:#fff4e1
    style B fill:#fff4e1
    style C fill:#fff4e1
    style D fill:#4CAF50
    style F fill:#2196F3
    style J fill:#2196F3
    style K fill:#2196F3
```

**Location:** Dev machine  
**Tool:** `aztec-butler prepare-deployment`  
**Duration:** 1-2 minutes

## Steps

### 1. Prepare Deployment Files

The command automatically detects the number of servers from your `available_publisher_addresses.json` file.

**Example available_publisher_addresses.json:**

```json
{
  "server1": ["0x111...", "0x222...", "0x333..."],
  "server2": ["0x444...", "0x555...", "0x666..."],
  "server3": ["0x777...", "0x888...", "0x999..."]
}
```

**Run the command:**

```bash
aztec-butler prepare-deployment \
  --production-keys prod-testnet-keyfile.json \
  --new-public-keys public-new-private-keys.json \
  --available-publishers available_publisher_addresses.json
```

**This automatically creates one file per server:**

- `prod-testnet-keyfile_server1_v1.json` (uses publishers from server1)
- `prod-testnet-keyfile_server2_v1.json` (uses publishers from server2)
- `prod-testnet-keyfile_server3_v1.json` (uses publishers from server3)

All files contain **the same validators** but **different publishers**.

**For single server:** Use a file with just one key:

```json
{
  "server1": ["0x111...", "0x222..."]
}
```

Output: `prod-testnet-keyfile_server1_v1.json`

### 2. Verify Output Files

#### Check a single file:

```bash
# Check validator count
jq '.validators | length' prod-testnet-keyfile_server1_v1.json

# Verify all validators have publishers
jq '.validators[] | select(.publisher == null)' prod-testnet-keyfile_server1_v1.json
# Should output nothing
```

#### Multiple Servers:

```bash
# Verify all files have same validators
diff <(jq '.validators[].attester.eth' prod-testnet-keyfile_server1_v1.json | sort) \
     <(jq '.validators[].attester.eth' prod-testnet-keyfile_server2_v1.json | sort)
# Should show no differences

# Verify different publishers
diff <(jq '.validators[].publisher' prod-testnet-keyfile_server1_v1.json | sort) \
     <(jq '.validators[].publisher' prod-testnet-keyfile_server2_v1.json | sort)
# Should show differences
```

### 3. Review Scraper Config

The command automatically updates the scraper config:

```bash
# Check config location (shown in command output)
cat ~/.local/share/aztec-butler/<network>-scrape-config.json | jq '.'
```

**Verify:**

- All attesters present (old + new)
- Publishers array contains unique addresses
- New attesters have `lastSeenState: "NEW"`
- Version is `"1.1"`

## Command Validations

The command performs these checks automatically:

### ✅ Duplicate Detection

- Checks for duplicate attesters across existing and new keys
- **Fails if duplicates found**

### ✅ Coinbase Validation

- Ensures no explicit zero-address coinbases in existing validators
- **Fails if any existing validator has explicit `0x0000...` coinbase**
- Missing coinbase (undefined) is OK for new validators

### ✅ Publisher Funding

- Queries ETH balance for all publishers
- **Fails if any publisher has 0 ETH**
- **Warns if any publisher has < `MIN_ETH_PER_ATTESTER` ETH**

### ✅ High Availability Validation

- Ensures no publisher address appears in multiple server arrays
- Ensures sufficient servers configured for requested HA count
- **Fails if conflicts detected**

## Checklist

- [ ] Ran prepare-deployment command successfully
- [ ] No validation errors or warnings
- [ ] Deployment file(s) created:
  - [ ] `prod-testnet-keyfile_<serverId>_v1.json` for each server
- [ ] Verified validator count matches expected (old + new)
- [ ] Verified all validators have publisher addresses assigned
- [ ] Verified publishers have sufficient ETH balance
- [ ] Scraper config updated successfully
- [ ] Reviewed scraper config contains all attesters

## File Locations After Phase 3

### Single Server:

```
Dev Machine:
  ~/validator-keys-deployment/
  ├── prod-testnet-keyfile.json                # Existing
  ├── available_publisher_addresses.json       # Existing
  ├── new-private-keys.json                    # Phase 1 (can delete after secure storage)
  ├── public-new-private-keys.json             # Phase 2
  └── prod-testnet-keyfile_server1_v1.json     # ✅ New - Ready to deploy

Scraper Config:
  ~/.local/share/aztec-butler/
  └── <network>-scrape-config.json             # ✅ Updated

Validator Node:
  /path/to/aztec/
  └── prod-testnet-keyfile.json                # Unchanged (will update in Phase 4)
```

### High Availability:

```
Dev Machine:
  ~/validator-keys-deployment/
  ├── prod-testnet-keyfile.json                # Existing
  ├── available_publisher_addresses.json       # Existing
  ├── public-new-private-keys.json             # Phase 2
  ├── prod-testnet-keyfile_server1_v1.json     # ✅ New - Deploy to Server 1
  ├── prod-testnet-keyfile_server2_v1.json     # ✅ New - Deploy to Server 2
  └── prod-testnet-keyfile_server3_v1.json     # ✅ New - Deploy to Server 3
```

## Common Issues

### Issue: "Duplicate attester addresses found"

**Cause:** Attester already exists in production keyfile.

**Solution:**

1. Check which attesters are duplicates (shown in error)
2. Remove from `public-new-private-keys.json`
3. Re-run prepare-deployment

### Issue: "Zero-address coinbase found"

**Cause:** Existing validator has explicit `"coinbase": "0x0000..."`

**Solution:** This is a safety check. Options:

1. Set proper coinbase in production keyfile first
2. Or remove the validator if it's no longer active

### Issue: "Publisher has 0 ETH balance"

**Cause:** Publisher address not funded.

**Solution:**

```bash
# Fund the publisher address
# Then re-run prepare-deployment
```

### Issue: "No servers with publishers found"

**Cause:** Publisher file has no keys or all server arrays are empty.

**Solution:** Ensure publisher file has correct structure with at least one server:

```json
{
  "server1": ["0x111...", "0x222..."]
}
```

### Issue: "No output files generated"

**Cause:** All server entries in the publisher file have empty arrays.

**Solution:**

- Ensure at least one server has publisher addresses

### Issue: "Publisher addresses shared between servers"

**Cause:** Same address appears in multiple server arrays.

**Solution:** Ensure each publisher address appears in only one server array:

```json
{
  "server1": ["0x111..."],
  "server2": ["0x222..."] // ✅ Different from server1
}
```

## Publisher Distribution

Publishers are assigned round-robin across validators:

**Example with 5 validators and 3 publishers:**

```
Validator 0: Publisher 0
Validator 1: Publisher 1
Validator 2: Publisher 2
Validator 3: Publisher 0  (wraps around)
Validator 4: Publisher 1
```

This ensures even distribution of publishing load.

## Next Steps

Proceed to **[Phase 4: Deploy to Servers](phase-4.md)** to distribute files to validator nodes.
