# Plan: Scrape Attester On-Chain Status

## Goal

Determine which state an attester is in by querying on-chain data from the Rollup contract.

## Current Behavior

- **RollupScraper**: Checks `getAttesterView()` for each attester from scraper config
- Returns attester status: NONE, VALIDATING, ZOMBIE, or EXITING

## On-Chain Attester States vs Butler States

### On-Chain States (AttesterOnChainStatus)

Based on the Rollup contract's `Status` enum (StakingLib.sol:33-38):

1. **NONE (0)**: Does not exist in the setup
2. **VALIDATING (1)**: Participating as validator (active)
3. **ZOMBIE (2)**: Not participating as validator, but have funds in setup (hit if slashed and going below the minimum)
4. **EXITING (3)**: In the process of exiting the system

The status determination logic (StakingLib.sol:535-547):

- If exit exists and is recipient → EXITING
- If exit exists but not recipient → ZOMBIE (created via slashing)
- If effective balance > 0 → VALIDATING
- Otherwise → NONE

### Butler States (AttesterState)

Butler-specific state tracking in `src/server/state/index.ts`:

1. **NEW**: Attester registered in config but not yet processed
2. **IN_STAKING_PROVIDER_QUEUE**: Attester is in staking registry provider queue
3. **COINBASE_NEEDED**: Attester needs coinbase address configured
4. **IN_STAKING_QUEUE**: Attester is in rollup entry queue waiting to be flushed
5. **ACTIVE**: Attester is actively validating (on-chain status: VALIDATING)
6. **NO_LONGER_ACTIVE**: Attester was active but is now in NONE, ZOMBIE, or EXITING state

## Key Contract Methods

### Getting Active Attesters

**From Rollup Contract (IStaking interface):**

1. `getActiveAttesterCount()` → Returns the number of currently active attesters
2. `getAttesterAtIndex(uint256 _index)` → Returns attester address at given index
   - Iterate from 0 to `getActiveAttesterCount() - 1` to get all active attesters
   - Implementation: `StakingLib.getAttesterAtIndex()` calls `gse.getAttesterFromIndexAtTime(address(this), _index, block.timestamp)`

3. `getAttesterView(address _attester)` → Returns full AttesterView struct containing:
   - `status`: Status enum (NONE, VALIDATING, ZOMBIE, EXITING)
   - `effectiveBalance`: bigint
   - `exit`: Exit struct (withdrawalId, amount, exitableAt, recipientOrWithdrawer, isRecipient, exists)
   - `config`: AttesterConfig (publicKey, withdrawer)

4. `getStatus(address _attester)` → Returns just the Status enum

### Getting Queued Attesters

**From Rollup Contract (IStaking interface):**

1. `getEntryQueueLength()` → Returns the number of attesters in the entry queue
2. `getEntryQueueAt(uint256 _index)` → Returns DepositArgs for attester at queue index
   - DepositArgs contains: attester, withdrawer, publicKeyInG1, publicKeyInG2, proofOfPossession, moveWithLatestRollup
   - Iterate from 0 to `getEntryQueueLength() - 1` to get all queued attesters

3. `getAvailableValidatorFlushes()` → How many validators can be flushed from queue to active
4. `getNextFlushableEpoch()` → When the next flush can occur
5. `getIsBootstrapped()` → Whether the bootstrap phase is complete

### Exit Information

**From Rollup Contract:**

1. `getExit(address _attester)` → Returns Exit struct if attester is exiting
2. `getExitDelay()` → The delay period before withdrawal can be finalized

## Implementation Notes

**Reference Contracts:**

- RollupAbi is imported in `src/core/components/EthereumClient.ts`
- StakingLib.sol: `/home/filip/c/olla/contracts/dependencies/aztec-contracts-2.1.4/src/core/libraries/rollup/StakingLib.sol`
- IStaking interface: `/home/filip/c/olla/contracts/dependencies/aztec-contracts-2.1.4/src/core/interfaces/IStaking.sol`

**Attester Status Enums:**

- `src/types/attester.ts` - AttesterOnChainStatus enum (matches on-chain Status enum)
- `src/server/state/index.ts` - AttesterState enum (butler's internal state tracking)
  - Includes NO_LONGER_ACTIVE for tracking attesters that have transitioned from active validation

**Already Implemented in EthereumClient.ts:**

- `getAttesterView(attesterAddress)` at line 597

**Need to Add to EthereumClient.ts:**

- `getActiveAttesterCount()` → Call `rollupContract.read.getActiveAttesterCount()`
- `getAttesterAtIndex(index)` → Call `rollupContract.read.getAttesterAtIndex([index])`
- `getEntryQueueLength()` → Call `rollupContract.read.getEntryQueueLength()`
- `getEntryQueueAt(index)` → Call `rollupContract.read.getEntryQueueAt([index])`

## Implementation Plan

**1. Add Missing Methods to EthereumClient:**

- `getActiveAttesterCount()`
- `getAttesterAtIndex(index)`
- `getEntryQueueLength()`
- `getEntryQueueAt(index)`
- `getAllActiveAttesters()` - convenience method to iterate and get all active attesters
- `getAllQueuedAttesters()` - convenience method to iterate and get all queued attesters

**2. Create CLI Command: `scrape-attester-status`**

- Input: Optional attester address(es), or scrape all if none provided
- Output: Current on-chain status for each attester
- Options:
  - `--all-active` - Scrape all active attesters
  - `--all-queued` - Scrape all queued attesters
  - `--address <addr>` - Scrape specific attester(s)
- No file cache needed for now (direct query only)

**3. Output Format:**

```
Active Attesters (X total):
- 0x123... Status: VALIDATING, Balance: 100000

Queued Attesters (Y total):
- 0x456... (at position 0)
- 0x789... (at position 1)

Specific Attester Status:
- 0xabc... Status: EXITING, Balance: 50000, Exitable At: 2025-01-15
```

## Use Cases

- Check attester status before operations
- Monitor attester state transitions
- Get full list of active validators
- Get full list of queued validators waiting to enter
- Validate attester is in expected state
- Debug attester issues
