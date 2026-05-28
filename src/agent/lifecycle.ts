/**
 * Attester lifecycle derivation.
 *
 * The lifecycle is common across registries (native and Olla). Registry is a
 * dimension of the key, NOT a separate lifecycle enum — see PLAN.md §3.
 *
 * {@link deriveLifecycleState} is a pure function so it can be exhaustively
 * unit tested against concrete on-chain inputs.
 */

import { AttesterOnChainStatus, type AttesterView } from "../types/index.js";

export const ATTESTER_LIFECYCLE_STATES = [
  "NEW",
  "IN_STAKING_PROVIDER_QUEUE",
  "ROLLUP_ENTRY_QUEUE",
  "ACTIVE",
  "NO_LONGER_ACTIVE",
] as const;

export type AttesterLifecycleState = (typeof ATTESTER_LIFECYCLE_STATES)[number];

/**
 * Stable numeric encoding used by the `aztec_butler_attester_lifecycle_state`
 * gauge. The metric uses value-as-state (one series per attester) rather than
 * label-as-state to sidestep the OpenTelemetry SDK's cumulative retention of
 * previously-observed `(attester, state)` attribute sets. Grafana panels map
 * these integers back to names via value mappings — keep them stable.
 */
export const LIFECYCLE_STATE_VALUES: Record<AttesterLifecycleState, number> = {
  NEW: 0,
  IN_STAKING_PROVIDER_QUEUE: 1,
  ROLLUP_ENTRY_QUEUE: 2,
  ACTIVE: 3,
  NO_LONGER_ACTIVE: 4,
};

export interface LifecycleInput {
  /** Result of rollup `getAttesterView`; `null`/`undefined` when not on the rollup. */
  onChainView: AttesterView | null | undefined;
  /** Whether the attester is currently in its registry's staking-provider queue. */
  inProviderQueue: boolean;
}

/**
 * Derive the lifecycle state purely from on-chain facts.
 *
 * Precedence:
 *   1. On-chain rollup view, if present:
 *      - VALIDATING                       -> ACTIVE
 *      - ZOMBIE / EXITING                 -> NO_LONGER_ACTIVE
 *      - NONE + effectiveBalance > 0      -> ROLLUP_ENTRY_QUEUE (deposited, awaiting flush)
 *      - NONE + effectiveBalance == 0     -> IN_STAKING_PROVIDER_QUEUE if still queued,
 *                                            else NO_LONGER_ACTIVE (was on-chain, now gone)
 *   2. No on-chain view:
 *      - in provider queue                -> IN_STAKING_PROVIDER_QUEUE
 *      - otherwise                        -> NEW
 */
export const deriveLifecycleState = (input: LifecycleInput): AttesterLifecycleState => {
  const { onChainView, inProviderQueue } = input;

  if (onChainView) {
    switch (onChainView.status) {
      case AttesterOnChainStatus.VALIDATING:
        return "ACTIVE";
      case AttesterOnChainStatus.ZOMBIE:
      case AttesterOnChainStatus.EXITING:
        return "NO_LONGER_ACTIVE";
      case AttesterOnChainStatus.NONE:
        if (onChainView.effectiveBalance > 0n) {
          return "ROLLUP_ENTRY_QUEUE";
        }
        return inProviderQueue ? "IN_STAKING_PROVIDER_QUEUE" : "NO_LONGER_ACTIVE";
      default:
        // Unknown numeric status — treat conservatively.
        return inProviderQueue ? "IN_STAKING_PROVIDER_QUEUE" : "NEW";
    }
  }

  return inProviderQueue ? "IN_STAKING_PROVIDER_QUEUE" : "NEW";
};
