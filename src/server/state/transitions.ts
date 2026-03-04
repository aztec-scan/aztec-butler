/**
 * Attester state transition logic
 *
 * This module handles all state transitions for attesters based PURELY on on-chain state:
 * - Provider queue membership (from staking contract)
 * - Rollup entry queue membership (from rollup contract)
 * - On-chain attester status (NONE, VALIDATING, ZOMBIE, EXITING)
 *
 * Coinbase configuration is tracked separately and does NOT affect state transitions.
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
  return stakingProviderData.queue.some(
    (addr) => addr.toLowerCase() === attesterAddress.toLowerCase(),
  );
}

/**
 * Handle state transitions for an attester based on on-chain state ONLY
 *
 * State machine (purely on-chain):
 * NEW → IN_STAKING_PROVIDER_QUEUE (when added to provider queue)
 * IN_STAKING_PROVIDER_QUEUE → ROLLUP_ENTRY_QUEUE (when moved to rollup entry queue)
 * ROLLUP_ENTRY_QUEUE → ACTIVE (when status becomes VALIDATING)
 * ROLLUP_ENTRY_QUEUE → NO_LONGER_ACTIVE (when status is NONE with zero balance, i.e. removed before activation)
 * ACTIVE → NO_LONGER_ACTIVE (when status becomes ZOMBIE, EXITING, or NONE)
 *
 * @param network - The network name
 * @param attesterAddress - The attester's Ethereum address
 * @param currentState - Current state of the attester
 */
export async function handleStateTransitions(
  network: string,
  attesterAddress: string,
  currentState: AttesterState,
): Promise<void> {
  const attesterState = getAttesterState(network, attesterAddress);
  const onChainView = attesterState?.onChainView;
  const isInProviderQueue = isAttesterInProviderQueue(network, attesterAddress);

  switch (currentState) {
    case AttesterState.NEW:
      // Check if attester joined the provider queue
      if (isInProviderQueue) {
        console.log(
          `[${network}] Attester ${attesterAddress} joined provider queue (NEW → IN_STAKING_PROVIDER_QUEUE)`,
        );
        updateAttesterState(
          network,
          attesterAddress,
          AttesterState.IN_STAKING_PROVIDER_QUEUE,
        );
      }
      // Check if attester went directly to rollup entry queue (has onChainView with balance but not VALIDATING)
      else if (
        onChainView &&
        onChainView.status === AttesterOnChainStatus.NONE &&
        onChainView.effectiveBalance > 0n
      ) {
        console.log(
          `[${network}] Attester ${attesterAddress} entered rollup entry queue directly (NEW → ROLLUP_ENTRY_QUEUE)`,
        );
        updateAttesterState(
          network,
          attesterAddress,
          AttesterState.ROLLUP_ENTRY_QUEUE,
        );
      }
      // Check if attester was registered but already exited (status NONE with zero balance)
      else if (
        onChainView &&
        onChainView.status === AttesterOnChainStatus.NONE &&
        onChainView.effectiveBalance === 0n
      ) {
        console.log(
          `[${network}] Attester ${attesterAddress} was registered but already exited (NEW → NO_LONGER_ACTIVE)`,
        );
        updateAttesterState(
          network,
          attesterAddress,
          AttesterState.NO_LONGER_ACTIVE,
        );
      }
      // Check if attester became active directly
      else if (
        onChainView &&
        onChainView.status === AttesterOnChainStatus.VALIDATING
      ) {
        console.log(
          `[${network}] Attester ${attesterAddress} became active directly (NEW → ACTIVE)`,
        );
        updateAttesterState(network, attesterAddress, AttesterState.ACTIVE);
      }
      break;

    case AttesterState.IN_STAKING_PROVIDER_QUEUE:
      // Check if attester left provider queue
      if (!isInProviderQueue) {
        // Check if they're now in rollup entry queue or became active
        if (
          onChainView &&
          onChainView.status === AttesterOnChainStatus.VALIDATING
        ) {
          console.log(
            `[${network}] Attester ${attesterAddress} left provider queue and became active (IN_STAKING_PROVIDER_QUEUE → ACTIVE)`,
          );
          updateAttesterState(network, attesterAddress, AttesterState.ACTIVE);
        } else if (
          onChainView &&
          onChainView.status === AttesterOnChainStatus.NONE &&
          onChainView.effectiveBalance > 0n
        ) {
          console.log(
            `[${network}] Attester ${attesterAddress} left provider queue, now in rollup entry queue (IN_STAKING_PROVIDER_QUEUE → ROLLUP_ENTRY_QUEUE)`,
          );
          updateAttesterState(
            network,
            attesterAddress,
            AttesterState.ROLLUP_ENTRY_QUEUE,
          );
        } else if (
          onChainView &&
          onChainView.status === AttesterOnChainStatus.NONE &&
          onChainView.effectiveBalance === 0n
        ) {
          console.log(
            `[${network}] Attester ${attesterAddress} left provider queue and was removed (zero balance) (IN_STAKING_PROVIDER_QUEUE → NO_LONGER_ACTIVE)`,
          );
          updateAttesterState(
            network,
            attesterAddress,
            AttesterState.NO_LONGER_ACTIVE,
          );
        } else {
          // No on-chain view but not in provider queue anymore
          // This could mean they left the queue without being registered yet
          // Wait for rollup scraper to update onChainView
          console.log(
            `[${network}] Attester ${attesterAddress} left provider queue, waiting for on-chain view update`,
          );
        }
      }
      break;

    case AttesterState.ROLLUP_ENTRY_QUEUE:
      // Check if attester became active
      if (
        onChainView &&
        onChainView.status === AttesterOnChainStatus.VALIDATING
      ) {
        console.log(
          `[${network}] Attester ${attesterAddress} became active (ROLLUP_ENTRY_QUEUE → ACTIVE)`,
        );
        updateAttesterState(network, attesterAddress, AttesterState.ACTIVE);
      }
      // Check if attester was removed before activation (status NONE with zero balance)
      else if (
        onChainView &&
        onChainView.status === AttesterOnChainStatus.NONE &&
        onChainView.effectiveBalance === 0n
      ) {
        console.log(
          `[${network}] Attester ${attesterAddress} removed from entry queue (zero balance) (ROLLUP_ENTRY_QUEUE → NO_LONGER_ACTIVE)`,
        );
        updateAttesterState(
          network,
          attesterAddress,
          AttesterState.NO_LONGER_ACTIVE,
        );
      }
      // Check for other unexpected states (ZOMBIE, EXITING)
      else if (
        onChainView &&
        (onChainView.status === AttesterOnChainStatus.ZOMBIE ||
          onChainView.status === AttesterOnChainStatus.EXITING)
      ) {
        console.log(
          `[${network}] Attester ${attesterAddress} exited from entry queue (status: ${AttesterOnChainStatus[onChainView.status]}) (ROLLUP_ENTRY_QUEUE → NO_LONGER_ACTIVE)`,
        );
        updateAttesterState(
          network,
          attesterAddress,
          AttesterState.NO_LONGER_ACTIVE,
        );
      }
      // No on-chain view at all (shouldn't happen)
      else if (!onChainView) {
        console.warn(
          `[${network}] Attester ${attesterAddress} in ROLLUP_ENTRY_QUEUE has no on-chain view`,
        );
      }
      break;

    case AttesterState.ACTIVE:
      // Check if attester is no longer active (ZOMBIE or EXITING)
      if (
        onChainView &&
        (onChainView.status === AttesterOnChainStatus.ZOMBIE ||
          onChainView.status === AttesterOnChainStatus.EXITING)
      ) {
        console.log(
          `[${network}] Attester ${attesterAddress} is no longer active (status: ${AttesterOnChainStatus[onChainView.status]}) (ACTIVE → NO_LONGER_ACTIVE)`,
        );
        updateAttesterState(
          network,
          attesterAddress,
          AttesterState.NO_LONGER_ACTIVE,
        );
      }
      // Check if attester fully exited (status reverted to NONE)
      else if (
        onChainView &&
        onChainView.status === AttesterOnChainStatus.NONE
      ) {
        console.log(
          `[${network}] Attester ${attesterAddress} fully exited (status: NONE) (ACTIVE → NO_LONGER_ACTIVE)`,
        );
        updateAttesterState(
          network,
          attesterAddress,
          AttesterState.NO_LONGER_ACTIVE,
        );
      }
      // No on-chain view at all
      else if (!onChainView) {
        console.error(
          `[${network}] CRITICAL: Active attester ${attesterAddress} has no on-chain view!`,
        );
      }
      break;

    case AttesterState.NO_LONGER_ACTIVE:
      // Terminal state - no transitions
      break;

    default:
      console.warn(
        `[${network}] Unknown state ${currentState} for attester ${attesterAddress}`,
      );
  }
}

/**
 * Process a single attester and handle its state transitions
 * State transitions are based PURELY on on-chain data.
 *
 * @param network - The network name
 * @param attesterAddress - The attester's Ethereum address
 * @param currentState - Current state entry (or undefined if new)
 */
export async function processAttesterState(
  network: string,
  attesterAddress: string,
  currentState: AttesterState | undefined,
): Promise<void> {
  const attesterState = getAttesterState(network, attesterAddress);
  const onChainView = attesterState?.onChainView;
  const isInProviderQueue = isAttesterInProviderQueue(network, attesterAddress);

  // If no current state, initialize the attester based on on-chain state
  if (!currentState) {
    // Determine initial state from on-chain data
    if (onChainView && onChainView.status === AttesterOnChainStatus.VALIDATING) {
      // Already active on-chain
      updateAttesterState(network, attesterAddress, AttesterState.ACTIVE);
    } else if (
      onChainView &&
      onChainView.status === AttesterOnChainStatus.NONE &&
      onChainView.effectiveBalance > 0n
    ) {
      // In rollup entry queue (has on-chain view with balance but not yet validating)
      updateAttesterState(
        network,
        attesterAddress,
        AttesterState.ROLLUP_ENTRY_QUEUE,
      );
    } else if (
      onChainView &&
      onChainView.status === AttesterOnChainStatus.NONE &&
      onChainView.effectiveBalance === 0n
    ) {
      // Was registered on-chain but has zero balance - already exited
      updateAttesterState(
        network,
        attesterAddress,
        AttesterState.NO_LONGER_ACTIVE,
      );
    } else if (isInProviderQueue) {
      // In provider queue
      updateAttesterState(
        network,
        attesterAddress,
        AttesterState.IN_STAKING_PROVIDER_QUEUE,
      );
    } else {
      // Not in any queue or on-chain
      updateAttesterState(network, attesterAddress, AttesterState.NEW);
    }
    return;
  }

  // Handle transitions for existing attesters
  await handleStateTransitions(network, attesterAddress, currentState);
}
