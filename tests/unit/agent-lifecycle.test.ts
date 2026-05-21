import assert from "node:assert/strict";
import test from "node:test";
import { deriveLifecycleState } from "../../src/agent/lifecycle.js";
import { AttesterOnChainStatus, type AttesterView } from "../../src/types/index.js";

/** Build a minimal AttesterView for testing. */
function view(status: AttesterOnChainStatus, effectiveBalance: bigint): AttesterView {
  return {
    status,
    effectiveBalance,
    exit: {
      withdrawalId: 0n,
      amount: 0n,
      exitableAt: 0n,
      recipientOrWithdrawer: "0x0",
      isRecipient: false,
      exists: false,
    },
    config: { publicKey: { x: 0n, y: 0n }, withdrawer: "0x0" },
  };
}

test("NEW: no on-chain view and not in provider queue", () => {
  assert.equal(
    deriveLifecycleState({ onChainView: null, inProviderQueue: false }),
    "NEW",
  );
});

test("IN_STAKING_PROVIDER_QUEUE: no on-chain view but queued", () => {
  assert.equal(
    deriveLifecycleState({ onChainView: null, inProviderQueue: true }),
    "IN_STAKING_PROVIDER_QUEUE",
  );
});

test("ROLLUP_ENTRY_QUEUE: deposited (status NONE, balance > 0)", () => {
  assert.equal(
    deriveLifecycleState({
      onChainView: view(AttesterOnChainStatus.NONE, 100n),
      inProviderQueue: false,
    }),
    "ROLLUP_ENTRY_QUEUE",
  );
});

test("ACTIVE: status VALIDATING", () => {
  assert.equal(
    deriveLifecycleState({
      onChainView: view(AttesterOnChainStatus.VALIDATING, 100n),
      inProviderQueue: false,
    }),
    "ACTIVE",
  );
});

test("NO_LONGER_ACTIVE: status ZOMBIE", () => {
  assert.equal(
    deriveLifecycleState({
      onChainView: view(AttesterOnChainStatus.ZOMBIE, 0n),
      inProviderQueue: false,
    }),
    "NO_LONGER_ACTIVE",
  );
});

test("NO_LONGER_ACTIVE: status EXITING", () => {
  assert.equal(
    deriveLifecycleState({
      onChainView: view(AttesterOnChainStatus.EXITING, 50n),
      inProviderQueue: false,
    }),
    "NO_LONGER_ACTIVE",
  );
});

test("NO_LONGER_ACTIVE: on-chain NONE with zero balance, not re-queued", () => {
  assert.equal(
    deriveLifecycleState({
      onChainView: view(AttesterOnChainStatus.NONE, 0n),
      inProviderQueue: false,
    }),
    "NO_LONGER_ACTIVE",
  );
});

test("IN_STAKING_PROVIDER_QUEUE: on-chain NONE zero balance but re-queued", () => {
  assert.equal(
    deriveLifecycleState({
      onChainView: view(AttesterOnChainStatus.NONE, 0n),
      inProviderQueue: true,
    }),
    "IN_STAKING_PROVIDER_QUEUE",
  );
});

test("ACTIVE takes precedence over provider queue membership", () => {
  assert.equal(
    deriveLifecycleState({
      onChainView: view(AttesterOnChainStatus.VALIDATING, 100n),
      inProviderQueue: true,
    }),
    "ACTIVE",
  );
});
