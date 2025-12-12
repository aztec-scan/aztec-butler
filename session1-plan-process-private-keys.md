# Session 1 Plan: Implement process-private-keys Command

## Goal

Implement Phase 2 of the key flow: `aztec-butler process-private-keys` command

## Requirements from overview.md

1. **Derive public keys from private keys file**
   - Take privateKeyFile as argument
   - Derive attester.eth using viem (getAddressFromPrivateKey)
   - Derive attester.bls using `computeBn254G1PublicKeyCompressed` from @aztec/foundation/crypto
   - Fail if any private key is malformed

2. **Store in GCP (placeholder)**
   - Console log all privateKeys and their publicKeys
   - Add TODO comment for GCP implementation

3. **Create public keys file**
   - Output file: `public-[privateKeyFile].json` (or custom via argument)
   - Include only: attester.eth, attester.bls, feeRecipient
   - Skip: coinbase and publisher fields

4. **Check provider queue**
   - Verify public eth addresses are not already in provider queue
   - Use logic from `get-add-keys-to-staking-provider-calldata.ts` as reference

## Testing

Compare output against: `plan-full-key-flow/key-files-and-phases/after_phase2/`

- Input: `new-private-keys.json`
- Expected output: `new-public-keys.json`

## Implementation Steps

1. **Research phase** ✅
   - Review existing code in keystoreOperations.ts
   - Review provider queue check logic in get-add-keys-to-staking-provider-calldata.ts
   - Check @aztec/foundation availability (confirmed available)
   - Review input/output file formats

2. **Create command file**
   - Create `src/cli/commands/process-private-keys.ts`
   - Import necessary dependencies (@aztec/foundation/crypto, viem, etc.)
   - Define command interface and options

3. **Implement key derivation**
   - Load private keys file
   - Validate JSON structure
   - Derive attester.eth using viem's getAddressFromPrivateKey
   - Derive attester.bls using computeBn254G1PublicKeyCompressed
   - Handle malformed keys with clear error messages

4. **Implement GCP storage placeholder**
   - Console log all keys (private + derived public)
   - Add TODO comment for actual GCP implementation

5. **Implement provider queue check**
   - Initialize EthereumClient
   - Get provider ID from config
   - Check queue for duplicates
   - Fail with clear error if duplicates found

6. **Generate output file**
   - Create public keys JSON with proper structure
   - Include: attester.eth, attester.bls, feeRecipient
   - Exclude: coinbase, publisher
   - Write to output file (default or specified)

7. **Add to CLI entry point**
   - Register command in `cli.ts`
   - Add proper error handling
   - Export from `src/cli/commands/index.ts`

8. **Test**
   - Run command with `new-private-keys.json` input
   - Compare output with expected `new-public-keys.json`
   - Verify all fields match
   - Test error cases (malformed keys, duplicates)

9. **Document**
   - Create `session1-summary-process-private-keys.md`
   - Include test results and comparison

## Key Files to Modify/Create

**Create:**

- `src/cli/commands/process-private-keys.ts` (new command)
- `session1-plan-process-private-keys.md` (this file)
- `session1-summary-process-private-keys.md` (test results)

**Modify:**

- `src/cli/commands/index.ts` (export new command)
- `cli.ts` (register new command)

## Dependencies

- @aztec/foundation/crypto (available as transitive dependency)
- viem (already in package.json)
- Existing utilities in keystoreOperations.ts

## Notes

- Input schema: validators array with attester.eth (private key), attester.bls (private key), publisher, feeRecipient, coinbase
- Output schema: validators array with attester.eth (address), attester.bls (public key), feeRecipient
- The command should be defensive: validate input, check for duplicates, fail fast on errors
