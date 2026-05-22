/**
 * Native staking-provider resolution policy.
 *
 * `EthereumClient` exposes the raw registry reads (`getStakingProviderById`,
 * `getStakingProvider`). This module owns the *decision* of which one to use:
 * prefer the stable provider id, fall back to admin-address resolution. Keeping
 * that decision in one place stops the agent and sheets-exporter from drifting.
 */

import type { EthereumClient } from "./EthereumClient.js";
import type { StakingProviderData } from "../../types/index.js";

/** How the native staking provider is identified in configuration. */
export interface NativeProviderSelector {
  /** Stable provider id — preferred when set (resolves in a single read). */
  providerId?: bigint;
  /** Provider admin address — fallback used when `providerId` is unset. */
  adminAddress?: string;
}

/** Human-readable description of a selector, for log and error messages. */
export const describeNativeProvider = (selector: NativeProviderSelector): string =>
  selector.providerId !== undefined
    ? `id=${selector.providerId}`
    : `admin ${selector.adminAddress}`;

/**
 * Resolve the native staking provider from configuration.
 *
 * Prefers the stable provider id (a single contract read, no iteration); falls
 * back to admin-address resolution when only the address is configured. Returns
 * `null` when no provider matches. Throws when the selector carries neither
 * field — that is a configuration error the caller's config builder is
 * expected to have already rejected.
 */
export const resolveNativeProvider = async (
  ethClient: EthereumClient,
  selector: NativeProviderSelector,
): Promise<StakingProviderData | null> => {
  if (selector.providerId !== undefined) {
    return ethClient.getStakingProviderById(selector.providerId);
  }
  if (selector.adminAddress) {
    return ethClient.getStakingProvider(selector.adminAddress, "native");
  }
  throw new Error(
    "resolveNativeProvider: neither a provider id nor an admin address was configured.",
  );
};
