# Implement flow for operator to generate, register, store and deploy

## goal

The purpose of this document is to describe how an entire flow looks like for the operator getting new keys to the server.
The goal for this project is to implement all functionality required of aztec-butler

### scope

The scope is only to develop the functionality for the CLI which the operator uses. Some adaptations for the server is fine, although not required. If possible add todo-server.md

- if it's not stated where files should be written to use CWD (except for scrape-config, use default)
- if the command is very similar to an existing CLI-command, then change the existing command. Otherwise, create new commands.

What this project should _not_ do:

- write scripts for how to use aztec cli (including aztec validator-keys)
- optimize the workflow, e.g. it's not needed to take rollback into account.
  - identified improvements can be written to todo-workflow-improvements.md (although not needed)

## plan

The plan is to, using this document as reference, implement functionality in aztec-butler. One reference-phase at the time.

### testing

Each phase should be tested by checking if the existing files looks like the after phase reference.

## reference: phases

There are folders of how the directory/filestates are after each phase in `./key-files-and-phases/`

### phase 0

- some keys are already done (`prod-testnet-keyfile.json` in our example)
  - the operator has a production file containing only public keys with a web3signer url
  - that file is already deployed to the servers

### phase 1

operator uses aztec-cli to generate key files with private keys

### phase 2

`aztec-butler process-private-keys`

operator uses aztec-butler to, with a single command...

1. derive public keys from private keys file
   - privateKeyFile as argument
   - derive attester.eth (using viem)
   - derive attester.bls (using computeBn254G1PublicKeyCompressed)
   - if any private key is malformed => command fails
1. and store in GCP...
   - for now only do console log with all privateKeys and their publicKeys
   - add TODO-comment for GCP impl
1. and create a new file with the public keys (skipping) coinbase and publisher
   - argument of filename, or default to `public-[privateKeyFile].json` (this is called `new-public-keys.json` in example dir)
   - after command, each new validator will have
     - attester.eth
     - attester.bls
     - feeRecipient
1. check that public eth addresses are not already in provider queue (check `src/cli/commands/get-add-keys-to-staking-provider-calldata.ts` for inspiration/synergies)

```typescript
import { computeBn254G1PublicKeyCompressed } from "@aztec/foundation/crypto/bn254";
const publicKey = await computeBn254G1PublicKeyCompressed(privateKey);
console.log(publicKey); // 0x...
/// Note: You'll need to add @aztec/foundation to your dependencies if it's not already there. Check if it's available as a transitive dependency from your other @aztec/* packages first.
```

### phase 3

`aztec-butler prepare-deployment`

operator uses aztec-butler to, with a single command...

1. create a new file "[oldProductionFilename].new" containing...
   - content of the existing production file (oldProductionFilename)
     - the existing file path is provided as an argument
     - this includes preserving the web3signer-url
   - append the newly created public keys to the validators array
     - if duplicates are discovered => command fails
     - note that the new attesters do not have a coinbase-field. This is correct.
     - feeRecipient should still be there, even if it's zero-address
   - overwrites publisher-addresses with the available publisher-addresses
     - the available publisher addresses json-file is provided as an argument
     - publisher-addresses should be spread as evenly as possible (round-robin is fine)
     - multiple attesters can share the same publisher _within the same file_ (see note below)
   - if file exist create "[oldProductionFilename].new2"
   - JSON object should still follow the same structure/schema
1. double-check all validators that there are no zero-address coinbase if there are any => command fails
1. checks if the all publisher-addresses are funded.
   - if they have low ETH (using MIN_ETH_PER_ATTESTER) => console.warn
   - if they have _no_ ETH => throw and abort
1. updates the scrape-config with the latest state
   - keys should be in the state NEW, `/home/filip/c/aztec-butler/src/types/scraper-config.ts`
   - ref: `/home/filip/c/aztec-butler/src/core/utils/scraperConfigOperations.ts`
   - there should not be any changes in config, but to clarify: the new config should be a merge of all attesters. Duplicates should be merged, prefering non-zero-address-values.

#### High Availability option

_NOTE!_ This is not shown in the showcase-files. But this command should also take an argument `--high-availability-count [nbr]`.
Then the command should create `nbr` files `A_[oldProductionFilename].new`, `B_[oldProductionFilename].new`, etc...

- _THE FILES SHOULD NOT HAVE ANY PUBLISHER ADDRESSES IN COMMON!_.
  - This also means that if `publishers.length<nbr` it should THROW an error.
- The publishers do not have to be evenly distributed
- It is fine if the normal command produces a single file with prefix `A_`.

For clarity, with --high-availability-count 3 and 10 publishers and 15 validators:
File A, B and C all have the 15 validators.

- File A: should have publisher 1-3
- File B: should have publisher 4-6
- File C: should have publisher 7-10

### phase 4

_NOTE: this is out of scope for implementation plan in aztec-butler_

operator does, manually or with external script (ansible)...

1. deletes the old public keys file
1. deletes newly generated public keys
1. distributes the public keys `.new`-file to the server
   - renaming both locally and on node removing the `.new`
1. restarts node to register keys

### phase 5

_This step can be done earlier, but should not. The keys should only become available once the node has them_

1. operator uses existing script `src/cli/commands/get-add-keys-to-staking-provider-calldata.ts` to get calldata and register keys to provider
   - it's fine that the double-check keys happens one more time here
   - we should not implement the proposal to multisig as part of this project
1. operator manually checks that keys are in provider queue on chain
1. operator manually checks (again) that the keys are in GCP
1. operator manually deletes the private key file
