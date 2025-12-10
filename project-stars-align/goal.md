# Project "Stars Align"

This is an overhaul of how Aztec Butler is going to be used. Instead of having the software run on node-host and reading its' configs and files it is instead going to have its' monitoring part (Scraper) running on an external server. And for the sensitive parts with proposing multisig calls and mapping privateKeys that is going to be in the CLI intended to be on an operators machine.

## Changes in butler

- complete removal of docker-compose parsed config

### CLI

- addKeysToProvider calldata
  - THROW if keys are already present in queue
  - inputs
    - eth-rpc-url
    - attester-private-keys
      - eth
      - bls
  - console.log (always)
  - multisig propose (if proposer config available, can opt-out with flag)
- fund publishers with ETH calldata
  - console.log (always)
  - multisig propose (if proposer config available, can opt-out with flag)
- generate scraper config, amongst other things:
  - based on public-keys exported from web3signer
    - eth
  - based on public-keys from publishers private keys
- scrape on-chain coinbases
  - inputs
    - start block
    - eth-rpc-url
    - attester-addresses
  - outputs
    - THROW for incorrect coinbases
    - mapping attester key -> coinbase key

### Scraper (rename from Server)

1. Will change format to run a single instance (per network) on monitoring-server. And not run on node-server.
2. Will only handle public-keys

- remove publisher load scraper
- scrape on-chain data (requires scrape-config)
  - publisher ETH balance
  - attester-keys state notes:
    - WAITING_FOR_MULTISIG_SIGN - remove entirely, this will not be tracked and instead encapsuled by NEW
    - IN_STAKING_QUEUE
      - when in this state, also export metric: ATTESTERS_MISSING_COINBASE
    - ACTIVE
      - when in this state, also export metric: ATTESTERS_MISSING_COINBASE_URGENT

## Ext-repo changes

- Aztec-CLI to generate priv-keys attesters
  - coinbase as 0x0...0 for now
  - publisher as 0x0...0 for now
- add secrets to GCP
- extract pub-keys from web3signer
- edit/update pub-keys (linked to web3signer) in ansible version-controlled file
- edit/update publisher priv-keys for publishers in ansible vault
  - how should this vault be shared?
- ansible-feature to distribute pub-keys + priv-keys in aztec-compliant JSON-format.
  - publisher keys should always be distributed XOR between multiple machines
- ansible-feature to run butler-scraper on monitoring-server
- ansible-feature to take coinbase-mappings and update aztec-compliant JSON-files on node-servers
