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
 * @param network - The network name
 * @param attesterAddress - The attester's Ethereum address
 * @returns true if the attester is in the provider's queue
 */
export function isAttesterInProviderQueue(
  network: string,
  attesterAddress: string,
): boolean {
  const stakingProviderData = getStakingProviderData(network);

  if (!stakingProviderData) {
    return false;
  }

  // Check if attester is in the queue array
  return stakingProviderData.queue.includes(attesterAddress);
}

/**
 * Handle state transitions for an attester based on current state and conditions
 *
 * @param network - The network name
 * @param attesterAddress - The attester's Ethereum address
 * @param currentState - Current state of the attester
 * @param hasCoinbase - Whether the attester has a coinbase address
 */
export async function handleStateTransitions(
  network: string,
  attesterAddress: string,
  currentState: AttesterState,
  hasCoinbase: boolean,
): Promise<void> {
  switch (currentState) {
    case AttesterState.ACTIVE:
      // If active attester loses coinbase, this is a fatal error
      if (!hasCoinbase) {
        console.error(
          `[${network}] FATAL: Active attester without coinbase detected! ${attesterAddress}`,
        );
      }
      break;

    case AttesterState.NEW:
      if (hasCoinbase) {
        // Attester got a coinbase while in NEW state
        updateAttesterState(
          network,
          attesterAddress,
          AttesterState.ROLLUP_ENTRY_QUEUE,
        );
      } else {
        // Check if attester is in provider queue
        const isInProviderQueue = isAttesterInProviderQueue(
          network,
          attesterAddress,
        );
        if (isInProviderQueue) {
          updateAttesterState(
            network,
            attesterAddress,
            AttesterState.IN_STAKING_PROVIDER_QUEUE,
          );
        }
      }
      break;

    case AttesterState.IN_STAKING_PROVIDER_QUEUE:
      // Check if attester is still in queue
      const stillInQueue = isAttesterInProviderQueue(network, attesterAddress);
      if (hasCoinbase) {
        // Got coinbase while in queue - moves to rollup entry queue
        updateAttesterState(
          network,
          attesterAddress,
          AttesterState.ROLLUP_ENTRY_QUEUE,
        );
      }
      // If no longer in queue and no coinbase, stay in this state
      // Entry queue scraper will track when coinbase is needed
      break;

    case AttesterState.ROLLUP_ENTRY_QUEUE:
      // Check if attester is now active on-chain
      const attesterState = getAttesterState(network, attesterAddress);
      if (
        attesterState?.onChainView &&
        attesterState.onChainView.status !== AttesterOnChainStatus.NONE
      ) {
        // Attester is now on-chain and active
        updateAttesterState(network, attesterAddress, AttesterState.ACTIVE);
      }
      // If coinbase removed, log warning but stay in this state
      // This shouldn't happen in normal operation
      if (!hasCoinbase) {
        console.warn(
          `[${network}] Warning: Attester ${attesterAddress} in ROLLUP_ENTRY_QUEUE lost its coinbase`,
        );
      }
      break;

    default:
      console.warn(
        `[${network}] Unknown state ${currentState} for attester ${attesterAddress}`,
      );
  }
}

/**
 * Process a single attester and handle its state transitions
 *
 * @param network - The network name
 * @param attesterAddress - The attester's Ethereum address
 * @param hasCoinbase - Whether the attester has a coinbase
 * @param currentState - Current state entry (or undefined if new)
 */
export async function processAttesterState(
  network: string,
  attesterAddress: string,
  hasCoinbase: boolean,
  currentState: AttesterState | undefined,
): Promise<void> {
  // If no current state, initialize the attester
  if (!currentState) {
    // New attester discovered
    // Initialize as ROLLUP_ENTRY_QUEUE if it has coinbase, otherwise NEW
    const initialState = hasCoinbase
      ? AttesterState.ROLLUP_ENTRY_QUEUE
      : AttesterState.NEW;
    updateAttesterState(network, attesterAddress, initialState);
    return;
  }

  // Handle transitions for existing attesters
  await handleStateTransitions(
    network,
    attesterAddress,
    currentState,
    hasCoinbase,
  );
}
