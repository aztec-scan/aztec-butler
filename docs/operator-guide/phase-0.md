# Phase 0: Prerequisites

Ensure your environment is properly configured before beginning the key management process.

## Prerequisites Checklist

### Environment Setup

- [ ] **Node.js v22.0.0 or higher** installed
- [ ] **Aztec CLI** installed and configured
- [ ] **Aztec Butler** installed and built
- [ ] Access to your **Ethereum node** (for on-chain queries)
- [ ] Access to your **Aztec node** (for validator operations)

### Configuration Files

- [ ] **Production keyfile** exists (e.g., `prod-testnet-keyfile.json`)
  - Contains existing validators with public keys
  - Includes `remoteSigner` URL (web3signer)
  - Already deployed to production nodes

- [ ] **Publisher addresses file** created with server-specific structure:

  ```json
  {
    "server1": ["0x1111...", "0x2222...", "0x3333..."],
    "server2": ["0x4444...", "0x5555..."],
    "server3": ["0x6666..."]
  }
  ```

- [ ] **Environment variables** configured:
  ```bash
  ETHEREUM_NODE_URL=https://...
  AZTEC_NODE_URL=https://...
  AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS=0x...
  MIN_ETH_PER_ATTESTER=0.1
  ```

### Network Access

- [ ] SSH access to validator nodes
- [ ] Ability to restart validator services
- [ ] Access to multisig wallet (for on-chain registration)

### Security Setup

- [ ] Secure storage system ready (GCP Secret Manager, HSM, etc.)
- [ ] Backup procedures in place
- [ ] Secure workspace on dev machine (encrypted disk recommended)

## File Structure

Create a working directory for this process:

```bash
mkdir -p ~/validator-keys-deployment
cd ~/validator-keys-deployment
```

Your working directory structure will look like:

```
~/validator-keys-deployment/
├── prod-testnet-keyfile.json          # Existing production file
├── available_publisher_addresses.json  # Publisher addresses per server
└── [files generated in subsequent phases]
```

## Verification

### Verify Aztec Butler Installation

```bash
aztec-butler --version
```

Expected output: Version number (e.g., `2.0.0`)

### Verify Production Keyfile

```bash
cat prod-testnet-keyfile.json | jq '.validators | length'
```

This shows how many validators are currently configured.

### Verify Publisher Funding

```bash
aztec-butler get-publisher-eth \
  --publishers available_publisher_addresses.json
```

Ensure all publishers have sufficient ETH balance (at least `MIN_ETH_PER_ATTESTER` per attester).

## High Availability Planning

If deploying with HA:

- [ ] Determine HA count (number of servers)
- [ ] Ensure sufficient publishers per server
  - **Minimum**: 1 publisher per server
  - **Recommended**: At least as many publishers as attesters per server
- [ ] Verify no publisher address appears in multiple server arrays

**Example for 3-way HA with 15 validators:**

```json
{
  "server1": ["0x111...", "0x222...", "0x333...", "0x444...", "0x555..."],
  "server2": ["0x666...", "0x777...", "0x888...", "0x999...", "0xAAA..."],
  "server3": ["0xBBB...", "0xCCC...", "0xDDD...", "0xEEE...", "0xFFF..."]
}
```

Each file will get all 15 validators but different publishers.

## Common Issues

### Issue: Cannot find aztec-butler command

**Solution:**

```bash
cd /path/to/aztec-butler
npm install
npm run build
npm link
```

### Issue: Production keyfile missing remoteSigner

**Solution:** Add the remoteSigner field:

```json
{
  "schemaVersion": 1,
  "remoteSigner": "http://your-web3signer:9000",
  "validators": [...]
}
```

### Issue: Publisher addresses in old format

**Solution:** Convert from array to server-keyed object:

```bash
# Old format: ["0x111...", "0x222..."]
# Format: {"server1": ["0x111...", "0x222..."], "server2": ["0x333..."]}
```

## Next Steps

Once all prerequisites are satisfied, proceed to **[Phase 1: Generate Keys](phase-1.md)**.
