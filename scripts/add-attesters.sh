#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TARGET_FILES=()
COUNT=""
REGISTRY=""
NETWORK=""
STATE_FOLDER=""
GOOGLE_SECRETS=false
SAFE_PROPOSAL=true

usage() {
  cat <<'EOF'
Usage: ./scripts/add-attesters.sh \
  --count <number> \
  --registry <native|olla> \
  --network <mainnet|testnet> \
  --state-folder <path> \
  [--google-secrets] \
  [--no-safe-proposal] \
  <keys-file> [<keys-file> ...]

Backward-compatible form: --keys-file <path> may be used one or more times
instead of positional key files.

This script is resumable. Without --google-secrets it stops after generating
new private keys so you can review before uploading secrets.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keys-file)
      TARGET_FILES+=("$2")
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
      TARGET_FILES+=("$1")
      shift
      ;;
  esac
done

if [[ ${#TARGET_FILES[@]} -eq 0 || -z "$COUNT" || -z "$REGISTRY" || -z "$NETWORK" || -z "$STATE_FOLDER" ]]; then
  echo "Error: at least one keys file plus --count, --registry, --network, and --state-folder are required" >&2
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

STATE_FOLDER_ABS="$(mkdir -p "$STATE_FOLDER" && realpath "$STATE_FOLDER")"

TARGET_FILES_ABS=()
for target_file in "${TARGET_FILES[@]}"; do
  if [[ ! -f "$target_file" ]]; then
    echo "Error: keys file not found: $target_file" >&2
    exit 1
  fi
  target_file_abs="$(realpath "$target_file")"
  TARGET_FILES_ABS+=("$target_file_abs")
done

RUN_DIR="$STATE_FOLDER_ABS/$NETWORK/$REGISTRY"
BACKUP_DIR="$RUN_DIR/backups"
PREPARED_DIR="$RUN_DIR/prepared"
PUBLISHERS_DIR="$RUN_DIR/publishers"
REPLACED_DIR="$RUN_DIR/replaced"

NEW_PRIVATE_KEYS="$RUN_DIR/new-private-keys.json"
PUBLIC_KEYS="$RUN_DIR/public-new-private-keys.json"
AVAILABLE_PUBLISHERS="$RUN_DIR/available_publisher_addresses.json"
ADD_KEYS_LOG="$RUN_DIR/add-keys.log"
TARGET_STATE_FILE="$RUN_DIR/targets.txt"
COUNT_STATE_FILE="$RUN_DIR/count.txt"
RUN_COMPLETE_MARKER="$RUN_DIR/run-complete.done"

mkdir -p "$RUN_DIR" "$BACKUP_DIR" "$PREPARED_DIR" "$PUBLISHERS_DIR" "$REPLACED_DIR"

CURRENT_TARGETS_FILE="$RUN_DIR/current-targets.txt"
printf '%s\n' "${TARGET_FILES_ABS[@]}" > "$CURRENT_TARGETS_FILE"

if [[ -f "$TARGET_STATE_FILE" ]]; then
  if ! cmp -s "$TARGET_STATE_FILE" "$CURRENT_TARGETS_FILE"; then
    echo "Error: state folder is already tied to a different target file set." >&2
    echo "Existing targets:" >&2
    sed 's/^/  /' "$TARGET_STATE_FILE" >&2
    echo "Current targets:" >&2
    sed 's/^/  /' "$CURRENT_TARGETS_FILE" >&2
    echo "Remove state folder to start a new run: $RUN_DIR" >&2
    exit 1
  fi
else
  cp "$CURRENT_TARGETS_FILE" "$TARGET_STATE_FILE"
fi

if [[ -f "$COUNT_STATE_FILE" ]]; then
  STORED_COUNT="$(<"$COUNT_STATE_FILE")"
  if [[ "$STORED_COUNT" != "$COUNT" ]]; then
    echo "Error: state folder is already tied to count=$STORED_COUNT, but current count=$COUNT" >&2
    echo "Remove state folder to start a new run: $RUN_DIR" >&2
    exit 1
  fi
else
  printf '%s\n' "$COUNT" > "$COUNT_STATE_FILE"
fi

if [[ -f "$RUN_COMPLETE_MARKER" ]]; then
  echo "This run is already complete for the current target file set." >&2
  echo "Remove state folder to start a new run:" >&2
  echo "  $RUN_DIR" >&2
  exit 1
fi

for i in "${!TARGET_FILES_ABS[@]}"; do
  target_file="${TARGET_FILES_ABS[$i]}"
  backup_file="$BACKUP_DIR/target-$i-$(basename "$target_file")"
  if [[ ! -f "$backup_file" ]]; then
    cp "$target_file" "$backup_file"
  fi
done

node - "$BACKUP_DIR" "${#TARGET_FILES_ABS[@]}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const backupDir = process.argv[2];
const count = Number(process.argv[3]);
const attestersFor = (file) => {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return (data.validators || []).map((validator) => validator.attester?.eth?.toLowerCase()).filter(Boolean).sort();
};
let reference = null;
for (let i = 0; i < count; i += 1) {
  const file = fs.readdirSync(backupDir).find((entry) => entry.startsWith(`target-${i}-`));
  if (!file) {
    console.error(`Missing backup for target ${i}`);
    process.exit(1);
  }
  const attesters = attestersFor(path.join(backupDir, file));
  if (!reference) {
    reference = attesters;
    continue;
  }
  if (attesters.length !== reference.length || attesters.some((value, index) => value !== reference[index])) {
    console.error(`Target ${i} does not have the same attester set as target 0`);
    process.exit(1);
  }
}
NODE

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
  .filter((file) => file.endsWith(".json") && !file.startsWith("prepared-") && !excluded.has(file))
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

  local backup_count prepared_count replaced_count
  backup_count="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'target-*' | wc -l | tr -d ' ')"
  prepared_count="$(find "$PREPARED_DIR" -maxdepth 1 -type f -name 'target-*' | wc -l | tr -d ' ')"
  replaced_count="$(find "$REPLACED_DIR" -maxdepth 1 -type f -name 'target-*.done' | wc -l | tr -d ' ')"

  if [[ "$backup_count" == "${#TARGET_FILES_ABS[@]}" ]]; then
    echo "✅ Step 0: original keys files backed up ($backup_count/${#TARGET_FILES_ABS[@]})"
    echo "   $BACKUP_DIR"
  else
    echo "❌ Step 0 TODO: back up original keys files ($backup_count/${#TARGET_FILES_ABS[@]})"
  fi

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

  if [[ "$prepared_count" == "${#TARGET_FILES_ABS[@]}" ]]; then
    echo "✅ Step 4: replacement keys files prepared in state directory ($prepared_count/${#TARGET_FILES_ABS[@]})"
    echo "   $PREPARED_DIR"
  else
    echo "❌ Step 4 TODO: prepare replacement keys files in state directory ($prepared_count/${#TARGET_FILES_ABS[@]})"
  fi

  if [[ "$replaced_count" == "${#TARGET_FILES_ABS[@]}" ]]; then
    echo "✅ Step 5: production keys files replaced in place ($replaced_count/${#TARGET_FILES_ABS[@]})"
  else
    echo "❌ Step 5 TODO: replace production keys files before Safe proposal ($replaced_count/${#TARGET_FILES_ABS[@]})"
  fi

  if [[ -f "$ADD_KEYS_LOG" ]]; then
    echo "✅ Step 6: add-keys calldata generated"
    echo "   $ADD_KEYS_LOG"
  else
    echo "❌ Step 6 TODO: generate add-keys calldata from new private keys"
  fi

  if [[ -f "$ADD_KEYS_LOG" ]]; then
    local add_keys_output
    add_keys_output="$(<"$ADD_KEYS_LOG")"
    if [[ "$add_keys_output" == *"All transactions successfully proposed to Safe multisig"* ]]; then
      echo "✅ Step 7: Safe proposal submitted"
    elif [[ "$add_keys_output" == *"Failed to propose transaction to Safe"* ]]; then
      echo "❌ Step 7 TODO: Safe proposal failed; fix proposer owner/delegate config and rerun"
    elif [[ "$SAFE_PROPOSAL" == true ]]; then
      echo "❌ Step 7 TODO: Safe proposal not submitted; enable SAFE_PROPOSALS_ENABLED=true and rerun"
    else
      echo "❌ Step 7 TODO: Safe proposal skipped by --no-safe-proposal"
    fi
  else
    echo "❌ Step 7 TODO: propose add-keys transaction to Safe"
  fi
}

CLI=(npx tsx cli.ts)

echo "=== Add Attesters ==="
echo "Keys files: ${#TARGET_FILES_ABS[@]}"
for target_file in "${TARGET_FILES_ABS[@]}"; do
  echo "  - $target_file"
done
echo "Backups: $BACKUP_DIR"
echo "Prepared outputs: $PREPARED_DIR"
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
  $0 --count "$COUNT" --registry "$REGISTRY" --network "$NETWORK" --state-folder "$STATE_FOLDER_ABS" --google-secrets ${TARGET_FILES_ABS[*]}

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
  echo "Step 3: reusing existing publisher address files: $PUBLISHERS_DIR"
else
  echo "Step 3: extracting existing publishers from each target backup"
  node - "$BACKUP_DIR" "$PUBLISHERS_DIR" "$AVAILABLE_PUBLISHERS" "${#TARGET_FILES_ABS[@]}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [backupDir, publishersDir, aggregateOutput, countRaw] = process.argv.slice(2);
const count = Number(countRaw);
const aggregate = {};
for (let i = 0; i < count; i += 1) {
  const backupName = fs.readdirSync(backupDir).find((entry) => entry.startsWith(`target-${i}-`));
  if (!backupName) {
    console.error(`Missing backup for target ${i}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(path.join(backupDir, backupName), "utf8"));
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
    console.error(`No publishers found in backup ${backupName}`);
    process.exit(1);
  }
  const group = `target-${i}`;
  const output = path.join(publishersDir, `${group}.json`);
  fs.writeFileSync(output, JSON.stringify({ [group]: publishers }, null, 2) + "\n");
  aggregate[group] = publishers;
}
fs.writeFileSync(aggregateOutput, JSON.stringify(aggregate, null, 2) + "\n");
NODE
fi

echo "Step 4: preparing replacement keys files in state directory"
for i in "${!TARGET_FILES_ABS[@]}"; do
  target_file="${TARGET_FILES_ABS[$i]}"
  backup_file="$BACKUP_DIR/target-$i-$(basename "$target_file")"
  publisher_file="$PUBLISHERS_DIR/target-$i.json"
  prepared_file="$PREPARED_DIR/target-$i-$(basename "$target_file")"
  if [[ -f "$prepared_file" ]]; then
    echo "  target-$i: already prepared: $prepared_file"
    continue
  fi
  echo "  target-$i: preparing $prepared_file"
  "${CLI[@]}" --network "$NETWORK" prepare-deployment \
    --production-keys "$backup_file" \
    --new-public-keys "$PUBLIC_KEYS" \
    --available-publishers "$publisher_file" \
    --registry "$REGISTRY" \
    --output "$prepared_file"
done

echo "Step 5: replacing production keys files before Safe proposal"
for i in "${!TARGET_FILES_ABS[@]}"; do
  target_file="${TARGET_FILES_ABS[$i]}"
  prepared_file="$PREPARED_DIR/target-$i-$(basename "$target_file")"
  replaced_marker="$REPLACED_DIR/target-$i.done"
  if [[ -f "$replaced_marker" ]]; then
    echo "  target-$i: already replaced: $target_file"
    continue
  fi
  echo "  target-$i: replacing $target_file"
  cp "$prepared_file" "$target_file"
  printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$replaced_marker"
done

echo "Step 6: generating add-keys calldata from new private keys"
if [[ "$SAFE_PROPOSAL" == true ]]; then
  "${CLI[@]}" --network "$NETWORK" add-keys "$NEW_PRIVATE_KEYS" --registry "$REGISTRY" | tee "$ADD_KEYS_LOG"
else
  SAFE_PROPOSALS_ENABLED=false "${CLI[@]}" --network "$NETWORK" add-keys "$NEW_PRIVATE_KEYS" --registry "$REGISTRY" | tee "$ADD_KEYS_LOG"
fi

if [[ "$SAFE_PROPOSAL" != true ]] || [[ "$(<"$ADD_KEYS_LOG")" == *"All transactions successfully proposed to Safe multisig"* ]]; then
  printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RUN_COMPLETE_MARKER"
fi

echo ""
echo "Done. Add-keys output saved to: $ADD_KEYS_LOG"
print_progress_summary
