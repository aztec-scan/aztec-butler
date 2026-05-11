#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

KEYS_FILE=""
COUNT=""
REGISTRY=""
NETWORK=""
STATE_FOLDER=""
GOOGLE_SECRETS=false
SAFE_PROPOSAL=true

usage() {
  cat <<'EOF'
Usage: ./scripts/add-attesters.sh \
  --keys-file <path> \
  --count <number> \
  --registry <native|olla> \
  --network <mainnet|testnet> \
  --state-folder <path> \
  [--google-secrets] \
  [--no-safe-proposal]

This script is resumable. Without --google-secrets it stops after generating
new private keys so you can review before uploading secrets.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keys-file)
      KEYS_FILE="$2"
      shift 2
      ;;
    --count)
      COUNT="$2"
      shift 2
      ;;
    --registry)
      REGISTRY="$2"
      shift 2
      ;;
    --network)
      NETWORK="$2"
      shift 2
      ;;
    --state-folder)
      STATE_FOLDER="$2"
      shift 2
      ;;
    --google-secrets)
      GOOGLE_SECRETS=true
      shift
      ;;
    --no-safe-proposal)
      SAFE_PROPOSAL=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$KEYS_FILE" || -z "$COUNT" || -z "$REGISTRY" || -z "$NETWORK" || -z "$STATE_FOLDER" ]]; then
  echo "Error: --keys-file, --count, --registry, --network, and --state-folder are required" >&2
  usage >&2
  exit 1
fi

if [[ ! "$COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: --count must be a positive integer" >&2
  exit 1
fi

if [[ "$REGISTRY" != "native" && "$REGISTRY" != "olla" ]]; then
  echo "Error: --registry must be native or olla" >&2
  exit 1
fi

if [[ "$NETWORK" != "mainnet" && "$NETWORK" != "testnet" ]]; then
  echo "Error: --network must be mainnet or testnet" >&2
  exit 1
fi

KEYS_FILE_ABS="$(realpath "$KEYS_FILE")"
STATE_FOLDER_ABS="$(mkdir -p "$STATE_FOLDER" && realpath "$STATE_FOLDER")"

if [[ ! -f "$KEYS_FILE_ABS" ]]; then
  echo "Error: keys file not found: $KEYS_FILE" >&2
  exit 1
fi

readarray -t METADATA < <(node - "$KEYS_FILE_ABS" "$NETWORK" "$COUNT" <<'NODE'
const path = require("node:path");
const file = process.argv[2];
const network = process.argv[3];
const count = process.argv[4];
const base = path.basename(file);
const match = base.match(/^(.+)-keys-(.+)-v(\d+)\.json$/);
if (!match) {
  console.error(`Invalid keys filename format: ${base}. Expected <network>-keys-<server>-v<N>.json`);
  process.exit(1);
}
const fileNetwork = match[1];
const serverId = match[2];
if (fileNetwork !== network) {
  console.error(`Keys file network '${fileNetwork}' does not match --network '${network}'`);
  process.exit(1);
}
const stem = `${network}-${serverId}-${count}`.replace(/[^a-zA-Z0-9._-]/g, "-");
console.log(serverId);
console.log(stem);
NODE
)

SERVER_ID="${METADATA[0]}"
RUN_STEM="${METADATA[1]}"
RUN_DIR="$STATE_FOLDER_ABS/add-attesters-$REGISTRY-$RUN_STEM"

NEW_PRIVATE_KEYS="$RUN_DIR/new-private-keys.json"
PUBLIC_KEYS="$RUN_DIR/public-new-private-keys.json"
AVAILABLE_PUBLISHERS="$RUN_DIR/available_publisher_addresses.json"
ADD_KEYS_LOG="$RUN_DIR/add-keys.log"

mkdir -p "$RUN_DIR"

PREPARED_KEYS_FILE_STATE="$RUN_DIR/prepared-output-path.txt"
if [[ -f "$PREPARED_KEYS_FILE_STATE" ]]; then
  PREPARED_KEYS_FILE="$(<"$PREPARED_KEYS_FILE_STATE")"
else
  PREPARED_KEYS_FILE="$(node - "$KEYS_FILE_ABS" "$NETWORK" "$SERVER_ID" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [file, network, serverId] = process.argv.slice(2);
const dir = path.dirname(file);
const escapedNetwork = network.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapedServer = serverId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const regex = new RegExp(`^${escapedNetwork}-keys-${escapedServer}-v(\\d+)\\.json$`);
let highest = 0;
for (const entry of fs.readdirSync(dir)) {
  const match = entry.match(regex);
  if (!match) continue;
  highest = Math.max(highest, Number(match[1]));
}
console.log(path.join(dir, `${network}-keys-${serverId}-v${highest + 1}.json`));
NODE
)"
  printf '%s\n' "$PREPARED_KEYS_FILE" > "$PREPARED_KEYS_FILE_STATE"
fi

adopt_generated_private_keys() {
  if [[ -f "$NEW_PRIVATE_KEYS" ]]; then
    return 0
  fi

  local generated_file
  generated_file="$(node - "$RUN_DIR" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
const excluded = new Set([
  "available_publisher_addresses.json",
  "public-new-private-keys.json",
  "new-private-keys.json",
]);
const candidates = fs.readdirSync(dir)
  .filter((file) => file.endsWith(".json") && !excluded.has(file))
  .map((file) => path.join(dir, file));
if (candidates.length === 1) {
  console.log(candidates[0]);
}
NODE
)"

  if [[ -n "$generated_file" && -f "$generated_file" ]]; then
    mv "$generated_file" "$NEW_PRIVATE_KEYS"
    chmod 600 "$NEW_PRIVATE_KEYS"
  fi
}

print_progress_summary() {
  echo ""
  echo "=== Progress Summary ==="

  if [[ -f "$NEW_PRIVATE_KEYS" ]]; then
    echo "✅ Step 1: private attester keys generated"
    echo "   $NEW_PRIVATE_KEYS"
  else
    echo "❌ Step 1 TODO: generate private attester keys"
  fi

  if [[ -f "$PUBLIC_KEYS" ]]; then
    echo "✅ Step 2: private keys processed and Google Secret Manager upload completed"
    echo "   $PUBLIC_KEYS"
  elif [[ "$GOOGLE_SECRETS" == true ]]; then
    echo "❌ Step 2 TODO: process keys and upload to Google Secret Manager"
  else
    echo "❌ Step 2 TODO: rerun with --google-secrets to upload and create public keys"
  fi

  if [[ -f "$AVAILABLE_PUBLISHERS" ]]; then
    echo "✅ Step 3: existing publisher addresses extracted"
    echo "   $AVAILABLE_PUBLISHERS"
  else
    echo "❌ Step 3 TODO: extract existing publisher addresses"
  fi

  if [[ -f "$PREPARED_KEYS_FILE" ]]; then
    echo "✅ Step 4: bumped keys file created"
    echo "   $PREPARED_KEYS_FILE"
  else
    echo "❌ Step 4 TODO: create bumped keys file"
    echo "   Target: $PREPARED_KEYS_FILE"
  fi

  if [[ -f "$ADD_KEYS_LOG" ]]; then
    echo "✅ Step 5: add-keys calldata generated"
    echo "   $ADD_KEYS_LOG"
  else
    echo "❌ Step 5 TODO: generate add-keys calldata from new private keys"
  fi

  if [[ -f "$ADD_KEYS_LOG" ]]; then
    local add_keys_output
    add_keys_output="$(<"$ADD_KEYS_LOG")"
    if [[ "$add_keys_output" == *"All transactions successfully proposed to Safe multisig"* ]]; then
      echo "✅ Step 6: Safe proposal submitted"
    elif [[ "$add_keys_output" == *"Failed to propose transaction to Safe"* ]]; then
      echo "❌ Step 6 TODO: Safe proposal failed; fix proposer owner/delegate config and rerun"
    elif [[ "$SAFE_PROPOSAL" == true ]]; then
      echo "❌ Step 6 TODO: Safe proposal not submitted; enable SAFE_PROPOSALS_ENABLED=true and rerun"
    else
      echo "❌ Step 6 TODO: Safe proposal skipped by --no-safe-proposal"
    fi
  else
    echo "❌ Step 6 TODO: propose add-keys transaction to Safe"
  fi
}

CLI=(node --import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("ts-node/esm", pathToFileURL("./"));' cli.ts)

echo "=== Add Attesters ==="
echo "Keys file: $KEYS_FILE_ABS"
echo "Prepared output: $PREPARED_KEYS_FILE"
echo "Count: $COUNT"
echo "Registry: $REGISTRY"
echo "Network: $NETWORK"
echo "State: $RUN_DIR"
echo "Google secrets: $GOOGLE_SECRETS"
echo "Safe proposal: $SAFE_PROPOSAL"
echo ""

cd "$PROJECT_DIR"

adopt_generated_private_keys

if [[ -f "$NEW_PRIVATE_KEYS" ]]; then
  echo "Step 1: reusing existing private keys: $NEW_PRIVATE_KEYS"
else
  echo "Step 1: generating $COUNT private attester key(s)"
  aztec validator-keys new \
    --fee-recipient 0x0000000000000000000000000000000000000000000000000000000000000000 \
    --publisher-count 1 \
    --count "$COUNT" \
    --coinbase 0x0000000000000000000000000000000000000000 \
    --data-dir "$RUN_DIR"
  adopt_generated_private_keys
  if [[ ! -f "$NEW_PRIVATE_KEYS" ]]; then
    echo "Error: aztec generated keys, but no single JSON keystore could be adopted from $RUN_DIR" >&2
    exit 1
  fi
  chmod 600 "$NEW_PRIVATE_KEYS"
fi

if [[ "$GOOGLE_SECRETS" != true ]]; then
  cat <<EOF

Stopped before Google Secret Manager upload.

Review the generated private keys, then rerun the same command with --google-secrets to continue:
  $0 --keys-file "$KEYS_FILE_ABS" --count "$COUNT" --registry "$REGISTRY" --network "$NETWORK" --state-folder "$STATE_FOLDER_ABS" --google-secrets

Private keys file:
  $NEW_PRIVATE_KEYS
EOF
  print_progress_summary
  exit 0
fi

if [[ -f "$PUBLIC_KEYS" ]]; then
  echo "Step 2: reusing existing public keys: $PUBLIC_KEYS"
else
  echo "Step 2: processing private keys and uploading to Google Secret Manager"
  "${CLI[@]}" --network "$NETWORK" process-private-keys "$NEW_PRIVATE_KEYS" --registry "$REGISTRY" --output "$PUBLIC_KEYS"
fi

if [[ -f "$AVAILABLE_PUBLISHERS" ]]; then
  echo "Step 3: reusing existing publisher address file: $AVAILABLE_PUBLISHERS"
else
  echo "Step 3: extracting existing publishers for server $SERVER_ID"
  node - "$KEYS_FILE_ABS" "$SERVER_ID" "$AVAILABLE_PUBLISHERS" <<'NODE'
const fs = require("node:fs");
const [file, serverId, output] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const seen = new Set();
const publishers = [];
for (const validator of data.validators || []) {
  const values = Array.isArray(validator.publisher) ? validator.publisher : [validator.publisher];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    publishers.push(value);
  }
}
if (publishers.length === 0) {
  console.error("No publishers found in production keys file");
  process.exit(1);
}
fs.writeFileSync(output, JSON.stringify({ [serverId]: publishers }, null, 2) + "\n");
NODE
fi

if [[ -f "$PREPARED_KEYS_FILE" ]]; then
  echo "Step 4: prepared keys file already exists: $PREPARED_KEYS_FILE"
else
  echo "Step 4: creating bumped keys file: $PREPARED_KEYS_FILE"
  "${CLI[@]}" --network "$NETWORK" prepare-deployment \
    --production-keys "$KEYS_FILE_ABS" \
    --new-public-keys "$PUBLIC_KEYS" \
    --available-publishers "$AVAILABLE_PUBLISHERS" \
    --registry "$REGISTRY" \
    --output "$PREPARED_KEYS_FILE"
fi

echo "Step 5: generating add-keys calldata from new private keys"
if [[ "$SAFE_PROPOSAL" == true ]]; then
  "${CLI[@]}" --network "$NETWORK" add-keys "$NEW_PRIVATE_KEYS" --registry "$REGISTRY" | tee "$ADD_KEYS_LOG"
else
  SAFE_PROPOSALS_ENABLED=false "${CLI[@]}" --network "$NETWORK" add-keys "$NEW_PRIVATE_KEYS" --registry "$REGISTRY" | tee "$ADD_KEYS_LOG"
fi

echo ""
echo "Done. Add-keys output saved to: $ADD_KEYS_LOG"
print_progress_summary
