# Phase 1: Generate Private Keys

Generate new validator private keys using the Aztec CLI.

## Overview

```mermaid
flowchart LR
    A[Aztec CLI] -->|generates| B[Private Keys File]
    B --> C[new-private-keys.json]

    style A fill:#4CAF50
    style B fill:#fff4e1
    style C fill:#2196F3
```

**Location:** Dev machine (secure environment)  
**Tool:** Aztec CLI  
**Duration:** < 1 minute

## Steps

### 1. Generate Private Keys

Use the Aztec CLI to generate new validator keys:

```bash
aztec validator-keys generate \
  --num-validators 2 \
  --output new-private-keys.json
```

**Parameters:**

- `--num-validators`: Number of new validators to create
- `--output`: Output filename (default: generates random name)

### 2. Verify Generated File

Check the generated file structure:

```bash
cat new-private-keys.json | jq '.'
```

**Expected structure:**

```json
{
  "schemaVersion": 1,
  "validators": [
    {
      "attester": {
        "eth": "0x...", // 64 hex characters (private key)
        "bls": "0x..." // 64 hex characters (private key)
      },
      "publisher": "0x...", // 64 hex characters (private key)
      "feeRecipient": "0x0000000000000000000000000000000000000000",
      "coinbase": "0x0000000000000000000000000000000000000000"
    }
  ]
}
```

### 3. Secure the Private Keys

**🔴 CRITICAL SECURITY STEP**

- [ ] Set restrictive file permissions:

  ```bash
  chmod 600 new-private-keys.json
  ```

- [ ] Verify file contains private keys (64 hex chars each)

- [ ] Do NOT commit to version control

- [ ] Consider encrypting the file at rest:
  ```bash
  gpg -c new-private-keys.json
  # Creates new-private-keys.json.gpg
  ```

## Checklist

- [ ] Generated `new-private-keys.json` with desired number of validators
- [ ] Verified file structure is correct
- [ ] Set file permissions to 600
- [ ] File contains private keys (not public addresses)
- [ ] File is NOT in git repository
- [ ] Created backup in secure location

## File Locations After Phase 1

```
Dev Machine:
  ~/validator-keys-deployment/
  ├── prod-testnet-keyfile.json                # Existing
  ├── available_publisher_addresses.json       # Existing
  └── new-private-keys.json                    # ✅ New

Validator Nodes:
  /path/to/aztec/
  └── prod-testnet-keyfile.json                # Unchanged
```

## Common Issues

### Issue: Command not found - aztec

**Solution:** Install Aztec CLI:

```bash
npm install -g @aztec/cli
# or
yarn global add @aztec/cli
```

### Issue: Need specific fee recipient

**Solution:** Edit the generated file to set custom fee recipients:

```bash
jq '.validators[].feeRecipient = "0xYourAddress"' \
  new-private-keys.json > temp.json && mv temp.json new-private-keys.json
```

### Issue: Generated file has public keys instead of private keys

**Solution:** The Aztec CLI should generate private keys by default. Verify:

- `attester.eth` should be 64 hex chars (32 bytes) = private key
- If it's 40 hex chars (20 bytes) = public address (wrong!)

## Security Reminders

- **Never share private keys via email, Slack, or other insecure channels**
- **Never commit private keys to Git**
- **Always verify file permissions (600 or more restrictive)**
- **Create encrypted backups immediately**

## Next Steps

Proceed to **[Phase 2: Process Private Keys](phase-2.md)** to derive public keys and validate.
