/**
 * Attester state transition logic
 *
 * This module handles all state transitions for attesters based on:
 * - Current state
 * - Coinbase presence in DataDir
 * - Provider queue membership (derived from metrics/state)
 */

import {
  AttesterState,
  updateAttesterState,
  getStakingProviderData,
  getAttesterState,
} from "./index.js";
import { AttesterOnChainStatus } from "../../types/index.js";

/**
 * Check if an attester is in the provider's queue
 * This is derived from the staking provider metrics/state
 *
 * @param attesterAddress - The attester's Ethereum address
 * @returns true if the attester is in the provider's queue
 */
export function isAttesterInProviderQueue(attesterAddress: string): boolean {
  const stakingProviderData = getStakingProviderData();

  if (!stakingProviderData) {
    return false;
  }

  // Check if attester is in the queue array
  return stakingProviderData.queue.includes(attesterAddress);
}

/**
 * Handle state transitions for an attester based on current state and conditions
 *
 * @param attesterAddress - The attester's Ethereum address
 * @param currentState - Current state of the attester
 * @param hasCoinbase - Whether the attester has a coinbase address
 */
export async function handleStateTransitions(
  attesterAddress: string,
  currentState: AttesterState,
  hasCoinbase: boolean,
): Promise<void> {
  switch (currentState) {
    case AttesterState.ACTIVE:
      // If active attester loses coinbase, this is a fatal error
      if (!hasCoinbase) {
        console.error(
          `FATAL: Active attester without coinbase detected! ${attesterAddress}`,
        );
      }
      break;

    case AttesterState.NEW:
      if (hasCoinbase) {
        // Attester got a coinbase while in NEW state
        updateAttesterState(attesterAddress, AttesterState.IN_STAKING_QUEUE);
      } else {
        // Check if attester is in provider queue
        const isInProviderQueue = isAttesterInProviderQueue(attesterAddress);
        if (isInProviderQueue) {
          updateAttesterState(
            attesterAddress,
            AttesterState.IN_STAKING_PROVIDER_QUEUE,
          );
        }
      }
      break;

    case AttesterState.IN_STAKING_PROVIDER_QUEUE:
      // Check if attester is still in queue
      const stillInQueue = isAttesterInProviderQueue(attesterAddress);
      if (!stillInQueue && !hasCoinbase) {
        // No longer in queue and no coinbase
        updateAttesterState(attesterAddress, AttesterState.COINBASE_NEEDED);
      } else if (hasCoinbase) {
        // Got coinbase while in queue
        updateAttesterState(attesterAddress, AttesterState.IN_STAKING_QUEUE);
      }
      break;

    case AttesterState.COINBASE_NEEDED:
      // Check if coinbase was added
      if (hasCoinbase) {
        updateAttesterState(attesterAddress, AttesterState.IN_STAKING_QUEUE);
      } else {
        const isInProviderQueue = isAttesterInProviderQueue(attesterAddress);
        if (isInProviderQueue) {
          updateAttesterState(
            attesterAddress,
            AttesterState.IN_STAKING_PROVIDER_QUEUE,
          );
        }
      }

      break;

    case AttesterState.IN_STAKING_QUEUE:
      // Check if attester is now active on-chain
      const attesterState = getAttesterState(attesterAddress);
      if (
        attesterState?.onChainView &&
        attesterState.onChainView.status !== AttesterOnChainStatus.NONE
      ) {
        // Attester is now on-chain and active
        updateAttesterState(attesterAddress, AttesterState.ACTIVE);
      } else if (!hasCoinbase) {
        // Check if coinbase was removed (shouldn't happen, but handle it)
        console.warn(
          `Warning: Attester ${attesterAddress} in IN_STAKING_QUEUE lost its coinbase`,
        );
        updateAttesterState(attesterAddress, AttesterState.COINBASE_NEEDED);
      }
      break;

    case AttesterState.WAITING_FOR_MULTISIG_SIGN:
      const isInProviderQueue = isAttesterInProviderQueue(attesterAddress);
      if (isInProviderQueue) {
        updateAttesterState(
          attesterAddress,
          AttesterState.IN_STAKING_PROVIDER_QUEUE,
        );
      }
      break;

    default:
      console.warn(
        `Unknown state ${currentState} for attester ${attesterAddress}`,
      );
  }
}

/**
 * Process a single attester and handle its state transitions
 *
 * @param attesterAddress - The attester's Ethereum address
 * @param hasCoinbase - Whether the attester has a coinbase
 * @param currentState - Current state entry (or undefined if new)
 */
export async function processAttesterState(
  attesterAddress: string,
  hasCoinbase: boolean,
  currentState: AttesterState | undefined,
): Promise<void> {
  // If no current state, initialize the attester
  if (!currentState) {
    // New attester discovered
    // Initialize as IN_STAKING_QUEUE if it has coinbase, otherwise NEW
    const initialState = hasCoinbase
      ? AttesterState.IN_STAKING_QUEUE
      : AttesterState.NEW;
    updateAttesterState(attesterAddress, initialState);
    return;
  }

  // Handle transitions for existing attesters
  await handleStateTransitions(attesterAddress, currentState, hasCoinbase);
}
