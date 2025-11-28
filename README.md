# Aztec Butler

A tool for helping out with chores on an aztec-node server.

## Requirements

- **Node.js v22.0.0 or higher**

## Running as a Service

To run aztec-butler as a systemd service, see the [daemon setup guide](./daemon/README.md). The daemon runs the butler in server mode, providing Prometheus metrics and automated monitoring for your Aztec nodes.

## TODO

### features

1. push metrics to OTEL-collector
   1. disable exposing prom-server
1. Change behaviour of creating+proposing attester keys
   - should be part of CLI instead and run on operators machine (part of adding keys to web3signer flow)
   - only publisher-keys should be private in clear-text on the node
1. support for web3signer-schema

### gotchas

addresses and privkey should probably be forced to lower-case by zod

### potential bugs

IMPORTANT!!! Implement logic to avoid adding same attester-key multiple times!
