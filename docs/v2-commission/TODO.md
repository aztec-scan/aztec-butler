# v2 commission migration TODO

Operational checklist for moving Aztecscan from immutable on-chain split payouts to Aztec's off-chain payout flow.

## Now: start the transition boundary

- [ ] Confirm the multisig/Safe address to use as the distribution wallet.
- [ ] Change every active sequencer keystore `coinbase` to the multisig/Safe.
- [ ] Restart/reload sequencers as needed so the new coinbase is live.
- [ ] Record the current Aztec epoch number as `transitionEpoch`.
  - We prefer using the epoch containing the change as the first payout epoch, accepting possible overpayment rather than risking underpayment.
- [ ] Verify active sequencers/attesters are now using the multisig coinbase.
  - Use aztec-butler coinbase scraping / node logs / checkpoint data.
  - If any sequencer still uses the old coinbase, fix it and note the mixed transition window.

## One-time setup before first payout

- [ ] Clone/use `/home/filip/c/z_EXT/aztec-staking-payout` for the payout runner.
- [ ] Create `config.yaml` from `config.example.yaml`.
- [ ] Fill in:
  - [ ] `tokenAddress`
  - [ ] `stakingRegistryAddress`
  - [ ] `rollupAddress`
  - [ ] `providerId`
  - [ ] `distributionWalletAddress` = multisig/Safe
  - [ ] `commissionBps` = intended commission, e.g. `2500` for 25%
  - [ ] archival Ethereum mainnet `rpcUrl`
- [ ] Run one dry-run from `transitionEpoch` once there are finalized/proven epochs to inspect.
- [ ] Pin discovered deploy blocks in config after first successful run:
  - [ ] `stakingRegistryDeployedAtBlock`
  - [ ] `rollupDeployedAtBlock`
- [ ] Create a public payout audit repo.
  - [ ] Add README with operator name, provider id, distribution wallet, commission, cadence, and transition epoch.
  - [ ] Add `config.public.yaml` with no secrets / no RPC URL.
- [ ] Make one PR to `AztecProtocol/staking-dashboard` adding `manualPayoutAuditUrl` to the correct Aztecscan provider metadata.
  - Likely `providers/4-aztecscan.json`, but confirm provider id/admin before PR.
- [ ] Update on-chain provider take rate for future delegations via provider admin.
  - 25% = `2500` bips.
  - Mainnet StakingRegistry: `0x042dF8f42790d6943F41C25C2132400fd727f452`.

## First actual payout: in about one week

- [ ] Use `fromEpoch = transitionEpoch` for the first payout.
- [ ] Choose/pin `toEpoch`, or let the runner use `latest-proven`.
- [ ] Run dry-run first:

```bash
npm run settle -- \
  --config ./config.yaml \
  --from-epoch <transitionEpoch> \
  --dry-run
```

- [ ] Review dry-run output:
  - [ ] active delegators discovered
  - [ ] active attesters discovered
  - [ ] checkpoints proposed by our attesters
  - [ ] commission bips
  - [ ] total forwarded vs operator retention
  - [ ] any warning that attributed checkpoints used a coinbase different from the multisig
- [ ] If the first window includes old coinbase checkpoints, document this as the intentional transition behavior in the audit repo README.
- [ ] Claim/fund the multisig so it has enough AZTEC to execute payout transfers.
- [ ] Emit Safe Transaction Builder calldata:

```bash
npm run settle -- \
  --config ./config.yaml \
  --from-epoch <transitionEpoch> \
  --to-epoch <toEpoch> \
  --emit-calldata
```

- [ ] Review generated files:
  - [ ] `runs/epoch-<from>-<to>-<runId>.json`
  - [ ] `runs/epoch-<from>-<to>-<runId>.safe.json`
- [ ] Import `.safe.json` into Safe Transaction Builder.
- [ ] Multisig signers review and execute.
- [ ] Publish both generated files to the public audit repo.
- [ ] Record first payout `toEpoch`; next run starts at `toEpoch + 1`.

## Weekly steady-state payout

- [ ] Set `fromEpoch = previous toEpoch + 1`.
- [ ] Dry-run and review.
- [ ] Claim/fund multisig if needed.
- [ ] Emit Safe calldata.
- [ ] Execute via multisig.
- [ ] Publish audit JSON and Safe JSON to the public audit repo.
- [ ] Record `toEpoch` for the next week.

## Do not do

- [ ] Do not use `PRIVATE_KEY` live mode for the multisig flow; use `--emit-calldata`.
- [ ] Do not rely on a weekly staking-dashboard PR. The dashboard PR is one-time; weekly publishing happens in the audit repo.
- [ ] Do not skip epoch bookkeeping. Gaps underpay; overlaps can double-pay.
- [ ] Do not treat this as on-chain-enforced commission. This is an off-chain trust/audit process.
