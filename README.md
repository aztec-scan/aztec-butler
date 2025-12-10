# Aztec Butler

A tool for helping out with chores on an aztec-node server.

## Requirements

- **Node.js v22.0.0 or higher**

## Running as a Service

To run aztec-butler as a systemd service, see the [daemon setup guide](./daemon/README.md). The daemon runs the butler in server mode, providing Prometheus metrics and automated monitoring for your Aztec nodes.

## TODO

[Currently the plan is documented in "Stars Align"](./project-stars-align/overview.md).

### Roadmap

1. replace need for aztecmonitor
   - P2P connection status
   - chain tips
1. scrape Aztec's OTEL-instance
