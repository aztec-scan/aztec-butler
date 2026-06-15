# Aztec v2 commission / off-chain payout summary

This summarizes Aztec's proposed workaround for changing effective provider commission on existing delegated stake. It is based on:

- `docs/v2-commission/forum-post.md`
- `/home/filip/c/z_EXT/aztec-staking-payout`
- `/home/filip/c/z_EXT/staking-dashboard`

## Short answer

Your guess is mostly right, but with two important corrections:

1. **Change sequencer coinbase to a wallet we control**, ideally the Aztlan/Aztecscan multisig/Safe.
2. **Run the payout tool weekly** to generate an audit JSON plus Safe Transaction Builder calldata, then execute that calldata from the distribution wallet.
3. **Publish the audit artifacts every week** to a public audit repo.
4. **Make a staking-dashboard PR once** to add `manualPayoutAuditUrl` to the Aztecscan provider metadata. This should not need to be weekly unless the audit repo URL changes.
5. **Keep the on-chain provider take rate updated** via `StakingRegistry.updateProviderTakeRate(providerId, bips)`, even though old delegations still use off-chain payouts for the effective rate.

The extra thing that is easy to miss: **before executing the weekly transfer batch, the distribution wallet must actually hold enough AZTEC**. That means the operator must claim accrued sequencer rewards from the rollup for the chosen coinbase/distribution wallet, or otherwise fund the multisig from the coinbase wallet. The payout tool does not claim rewards for us; it only computes and emits ERC20 transfer calldata.

## What Aztec changed

The v1/on-chain split setup bakes the provider commission into each delegation's 0xSplits PullSplit at stake time. Those split contracts are immutable. Calling `StakingRegistry.updateProviderTakeRate` only affects future delegations, not already-existing split contracts.

Aztec's tactical v2 workaround is not a new contract path. It is a social/off-chain payout flow:

- Set L2 `coinbase` to an operator-controlled wallet.
- All sequencer rewards accrue to that wallet rather than each immutable split.
- Periodically compute each delegator's share off-chain at the current desired commission.
- Pay delegators from the operator wallet.
- Publish an audit JSON so delegators can verify the math.

The post proposes a socialized minimum commission of **25% = 2500 bips** starting June 18 2026. This is a norm, not an enforced protocol rule.

## Repos cloned / inspected

Cloned under `/home/filip/c/z_EXT`:

- `/home/filip/c/z_EXT/aztec-staking-payout`
- `/home/filip/c/z_EXT/staking-dashboard`

### `aztec-staking-payout`

This is the payout runner. It is explicitly marked **not audited**.

Important behavior:

- It is a CLI run manually or by cron; it does not run itself.
- It requires an **archival Ethereum RPC**.
- It takes a YAML config with:
  - `tokenAddress`
  - `stakingRegistryAddress`
  - `rollupAddress`
  - `providerId`
  - `distributionWalletAddress`
  - `commissionBps`
  - `rpcUrl`
- It settles by **epoch range**, not block range.
- `--to-epoch` defaults to `latest-proven`, gated by L1 finality.
- `--from-epoch` must be tracked by us as `previous to-epoch + 1`.
- It discovers active delegators from StakingRegistry events and checks active attesters via the rollup/GSE path.
- Default attribution is proposal-weighted: delegators are paid according to how many checkpoints their attester actually proposed during the settlement window.
- It computes rewards from protocol parameters: `oursProposed * (checkpointReward * sequencerBps / 10000)`.
- It emits one Multicall3 batch of ERC20 `transfer` calls to delegators.
- With a Safe/multisig, the expected mode is `--emit-calldata`, producing:
  - `runs/epoch-<from>-<to>-<runId>.json` — canonical audit record
  - `runs/epoch-<from>-<to>-<runId>.safe.json` — Safe Transaction Builder import

Notable limitations / assumptions:

- It does **not** enforce commission on-chain.
- It does **not** deploy or hold funds.
- It does **not** claim rewards from the rollup as part of the Safe batch.
- It does **not** cron/schedule itself.
- It does **not** include variable per-checkpoint transaction fees in reward attribution; it uses the fixed protocol reward formula.
- If a checkpoint proposer cannot be resolved, the run hard-fails rather than producing a partial payout plan.

### `staking-dashboard`

The dashboard already has support for manual payouts.

Provider metadata can include:

```json
"manualPayoutAuditUrl": "https://github.com/<org>/<audit-repo>"
```

The indexer validates it as an `http`/`https` URL, includes it in provider/list/detail API responses, and the frontend surfaces a **Manual payouts** notice. The UI tells delegators that rewards are distributed manually and points them at the audit reports instead of treating normal split claiming as the only path.

For Aztecscan, the current provider metadata inspected is:

- `providers/4-aztecscan.json` — provider id `4`, name `Aztec-Scan`

There is also a separate `providers/84-aztecscan.json` named `Aztec Explorer`; do not assume this is ours without confirming provider id/admin context.

## Concrete operational checklist

### One-time setup

1. **Choose distribution wallet**
   - Recommended: Aztlan/Aztecscan Safe/multisig.
   - This wallet becomes the coinbase rewards recipient and the sender of delegator payouts.

2. **Change all sequencer coinbase config to the distribution wallet**
   - This is the actual switch from old immutable splits to the off-chain payout flow.
   - Verify every active sequencer/attester is using the same intended coinbase.
   - Existing aztec-butler coinbase scraping should be useful as verification, but no integration is required for the first version.

3. **Prepare payout-runner config**
   - Copy `config.example.yaml` from `aztec-staking-payout`.
   - Set Aztec mainnet values for `tokenAddress`, `stakingRegistryAddress`, `rollupAddress`.
   - Set our `providerId`.
   - Set `distributionWalletAddress` to the Safe/multisig.
   - Set `commissionBps: 2500` if following the proposed 25% norm.
   - Use an archival Ethereum mainnet RPC.
   - Pin `stakingRegistryDeployedAtBlock` and `rollupDeployedAtBlock` after the first successful run to save RPC calls.

4. **Create public audit repo**
   - Example shape:
     - `README.md` with operator name, provider id, distribution wallet, declared commission/cadence.
     - `config.public.yaml` without `rpcUrl` or secrets.
     - `runs/` with weekly output files.

5. **PR staking dashboard provider metadata**
   - Add `manualPayoutAuditUrl` to our provider JSON, likely `providers/4-aztecscan.json` after confirming provider id.
   - This is a one-time PR unless the audit URL changes.
   - The dashboard PR is not the weekly audit mechanism; the weekly mechanism is pushing new run artifacts to the audit repo.

6. **Update on-chain provider take rate for future delegations**
   - The forum post asks operators to keep on-chain registry commission in sync with the effective off-chain rate.
   - For 25%, call `updateProviderTakeRate(providerId, 2500)` from the provider admin.
   - Mainnet StakingRegistry from the post: `0x042dF8f42790d6943F41C25C2132400fd727f452`.
   - Testnet StakingRegistry from the post: `0xC6EcC1832c8BF6a41c927BEb4E9ec610FBeDd1C2`.

### Weekly payout run

1. Pick an epoch window:
   - `fromEpoch = previous run's toEpoch + 1`.
   - `toEpoch` can be pinned, or omitted to use `latest-proven`.

2. Run a dry-run first:

```bash
npm run settle -- --config ./config.yaml --from-epoch <from> --dry-run
```

3. Review:
   - discovered delegators
   - active attesters
   - checkpoints proposed by our attesters
   - commission bips
   - total forwarded vs operator retention
   - any warning that checkpoints used a coinbase different from `distributionWalletAddress`

4. Ensure the distribution wallet is funded:
   - Claim accrued rewards from the rollup for the distribution wallet coinbase before signing payout transfers.
   - The tool's live mode checks balance; `--emit-calldata` mode does not execute or preflight in Safe.

5. Emit Safe calldata:

```bash
npm run settle -- \
  --config ./config.yaml \
  --from-epoch <from> \
  --to-epoch <to> \
  --emit-calldata
```

6. Import the generated `.safe.json` in Safe Transaction Builder and execute.

7. Commit/push the generated audit artifacts to the public audit repo:
   - `epoch-<from>-<to>-<runId>.json`
   - `epoch-<from>-<to>-<runId>.safe.json`

8. Record the `toEpoch` so the next run starts at `toEpoch + 1`.

## What we are not missing / not needed initially

- No new on-chain split contracts are needed.
- No migration of existing PullSplits is needed.
- No aztec-butler integration is needed for a first operational process.
- No weekly staking-dashboard PR is needed; only weekly audit repo pushes.
- No private key should be loaded into the payout tool if we use a Safe; use `--emit-calldata`.

## Main risks

- **Trust shift:** Delegators can no longer self-claim the off-chain-routed rewards. They depend on us to publish and execute payouts.
- **Wallet compromise:** The distribution wallet can drain all pooled rewards. Use a Safe/multisig, not a hot EOA.
- **Operational gap/overlap:** Wrong epoch tracking can skip or double-count a period. Treat `fromEpoch = previous toEpoch + 1` as state that must be recorded carefully.
- **Wrong coinbase:** If some sequencers still use old or different coinbases, rewards accrue elsewhere. The runner will warn when proposals used a coinbase different from the configured distribution wallet, but the operator must fund the payout wallet from wherever funds landed.
- **RPC quality:** The runner does many historical calls and hard-fails on unresolved checkpoints. Use a good archival RPC and tune `rpcMaxRequestsPerSecond` / chunk sizes.
- **Un-audited tool:** The payout runner is a POC and explicitly unaudited. For mainnet payouts, run dry-runs, review audit files, and use multisig review before execution.

## Bottom line

The full steady-state process is:

1. Coinbase all Aztecscan sequencers to the multisig/distribution wallet.
2. Keep on-chain provider take rate set to the public intended commission for new delegations.
3. Weekly: run the payout tool over a non-overlapping finalized epoch window.
4. Claim/fund the distribution wallet.
5. Execute the emitted Safe transfer batch.
6. Publish the audit JSON/Safe JSON to a public audit repo.
7. Link that audit repo once from staking-dashboard via `manualPayoutAuditUrl`.
