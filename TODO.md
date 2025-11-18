# revamp of attester-state handling

## NEW

When the attester is first detected in the DataDir it will be initially set to NEW. If it has a coinbase it will be set to IN_STAKING_QUEUE. These are the only two states an attester can be in when first detected.

Should maybe only be triggered from an attester-handler watching DataDir state?

## WAITING_FOR_MULTISIG_SIGN

This logic is still TODO, but once NEW is in init-state or detected in state, we will send a transaction proposing to add it to "addKeysToProvider". Once transaction is proposed, waiting for sign, we will set this state.

NOTE: at this point in time the attester still does not have a coinbase

! leave as TODO for now

## IN_STAKING_PROVIDER_QUEUE

Whether or not we were in NEW or WAITING_FOR_MULTISIG_SIGN, once the attester is added to the staking provider queue, we will set this state. This is set in coinbase-queue-scraper (but it should really just be part of the staking-provider-scraper)

NOTE: at this point in time the attester still does not have a coinbase

## NO_COINBASE

Whenever the above check in the queue detects that an attester is in the state IN_STAKING_PROVIDER_QUEUE but it is no longer in the queue, we will set it to NO_COINBASE. This indicates that the attester needs a coinbase to proceed.

## IN_STAKING_QUEUE

Once the attester in DataDir has a coinbase assigned to it, we will set it to IN_STAKING_QUEUE. This indicates that the attester is in the staking queue waiting to start attesting.

Should maybe only be triggered from an attester-handler watching DataDir state?

## ACTIVE

This scrape is still TODO
