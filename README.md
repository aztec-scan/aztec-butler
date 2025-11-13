# Aztec sequencer tool

A simple tool to create calldata for aztec deposits

## TODO

- default to localhost endpoints
- make scripts-dir with docker-commands

### implement below flow for adding delegated entries

- before this we have generated a keystore with aztec-tools in docker container

1. Read all keystore files
1. Print publishers ETH-funds (and if any has less than 0.1) (if 1 attester has multiple, reduce needed eth, if multiple attesters share, increase needed eth)
1. Generate attester JSON with BLS mumbo jumbo
1. Print calldata for stakingRegistry.addKeysToProvider, for the multisig to sign. (using mumbo jumbo)

- after this we use staking dashboard to delegate stake
- after that we set coinbase manually on server
