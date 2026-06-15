The problem
Operators run sequencers as a business. Their costs (ETH base fees, blob fees, signalling overhead, infrastructure) fluctuate over time, and their margin is the gap between protocol rewards and operating costs. When that gap shrinks or inverts, the operator needs to adjust commission to keep sequencing economically viable. This is the same lever any operating business uses to stay solvent through cost cycles.

In the Aztec staking protocol, provider commission rates are baked into each delegation’s 0xSplits PullSplit contract at the moment of staking. The split’s owner is address(0), so the rate is immutable for the life of that delegation. StakingRegistry.updateProviderTakeRate only affects new delegations, so there is no in-protocol lever to recover the gap on stake that is already in place. Operators either eat the loss or stop sequencing. Neither is good for the network or its delegators.

This is structurally a one-way ratchet on operator economics, and we should address it.

A socialised minimum commission of 25%
Before getting into mechanics, we want to set a shared baseline. We propose a socialised minimum commission of 25% starting next week (June 18th 2026).

This is not enforced in code. It is a community norm: the level the network recognises that an operator needs to take to run sustainably under current conditions. The 25% figure reflects current ETH gas costs, the operational overhead of running a sequencer, and headroom for future market changes that could squeeze operator profitability. Setting it socially (rather than per delegation, in private) gives operators cover to bring their effective commission up to a viable level, and gives delegators a clear, predictable expectation of what a reasonable commission looks like.

Operators whose baked-in rate already sits at or above this need to do nothing. Operators stuck below it on existing stake can use the tool in option 1 to bring their effective commission up to the baseline.

Your options
Option 1: Update your commission with a custom payout tool
Operators set their sequencer’s L2 coinbase to a wallet they control (Safe, multisig, EOA, cold-wallet flow). All rewards flow there. Once a week the operator runs a script that works out which attesters earned what, computes per-delegator amounts at the operator’s chosen commission, and emits a Multicall3 batch of ERC20 transfers ready to sign.

The tool holds no funds, deploys no contracts, and produces a per-run audit JSON that delegators can re-verify against on-chain data byte for byte. The trust model is off-chain. The operator commits publicly to a commission (the 25% baseline, or whatever rate they have agreed) and a cadence, and the audit artifacts make that commitment verifiable, though not enforced in bytecode.

Worth noting, setting coinbase to a wallet of the operator’s choosing is a lever every sequencer already has today. An operator who would route 100% of rewards to themselves can do so with or without this tool. What the tool adds is a structured way for honest operators to prove they did not.

Working POC, writeup and code: GitHub - AztecProtocol/aztec-staking-payout · GitHub. (<git@github.com>:AztecProtocol/aztec-staking-payout.git)

Publish your audit repo on the staking dashboard. The staking dashboard supports a link to your payout audits repo, displayed on your provider page. If you are going to use this script, please open a PR on the staking-dashboard repo to add this link to your provider information. The dashboard will then adapt how it presents claiming rewards to delegators for your provider, so they know to expect payouts via the audited off-chain flow rather than the default claim path.

Staking dashboard repo: GitHub - AztecProtocol/staking-dashboard · GitHub. (<git@github.com>:AztecProtocol/staking-dashboard.git)

Keep your onchain commission up to date. Even though the effective payout is handled off-chain, we ask operators to keep the take rate on the staking registry contract reflecting the commission they are actually charging. If you change your commission at any point, update it onchain so the registry, dashboard, and any tooling reading from it stay accurate.

The take rate is stored in basis points (BIPS), where 10000 is 100%. So 25% is 2500. The call must come from your provider admin address.

StakingRegistry addresses:

mainnet 0x042dF8f42790d6943F41C25C2132400fd727f452 testnet 0xC6EcC1832c8BF6a41c927BEb4E9ec610FBeDd1C2

Using cast (Foundry), mainnet example at 25%:

cast send 0x042dF8f42790d6943F41C25C2132400fd727f452 \\
"updateProviderTakeRate(uint256,uint16)" \\
<YOUR_PROVIDER_ID> \\
2500 \\
--rpc-url <L1_RPC_URL> \\
--account <your-provider-admin-account>

Swap in the testnet address above when updating on testnet. Replace <YOUR_PROVIDER_ID> with your providerIdentifier and 2500 with your new rate in BIPS. The contract rejects a value equal to your current rate and any value above 10000.

Using Etherscan instead: open the StakingRegistry contract (mainnet 0x042dF8f42790d6943F41C25C2132400fd727f452, testnet 0xC6EcC1832c8BF6a41c927BEb4E9ec610FBeDd1C2), go to Contract, then Write Contract, and connect your provider admin wallet. Find updateProviderTakeRate, enter your providerIdentifier in the first field and the new rate in BIPS (2500 for 25%) in the second, then write and confirm the transaction.

Option 2: Keep using the existing solution
If you are happy with your current commission rate for existing delegations, you do not need to do anything. Your existing delegations continue to work exactly as they do today. The immutable rate baked into each PullSplit stays in place, rewards flow through the existing path, and there is nothing to run or maintain. This is the right choice for any operator whose current margin is comfortable. Option 1 is purely opt-in and only matters when you actually need to adjust.

We would however like to ask that you consider updating your commission to 25% for any new delegations. See the instructions above for how to call the updateProviderTakeRate function on the StakingRegistry.

Longer term: fixing this in the L1 contracts
The payout tool is a tactical fix. The structural fix is at the protocol level. We plan to work on improvements to the L1 contracts that support mutable commissions natively, with future-rewards-only semantics, so operators can rotate their rate on existing stake without an off-chain script and without the divert-coinbase workaround that option 1 relies on. This would also let us resolve a number of the UX and DevEx problems we have heard from delegators and operators.

This is real engineering work tied to the rollup upgrade roadmap, and it is a few months out at minimum. Realistically no earlier than late Q4. The payout tool is meant to carry operators until then.
