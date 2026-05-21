import assert from "node:assert/strict";
import test from "node:test";
import { selectNextMissingCoinbase } from "../../src/agent/metrics/agent-metrics.js";
import { computeTimePerAttester } from "../../src/agent/queue-timing.js";
import type { LocalAttesterRuntimeState } from "../../src/agent/state.js";

// ── computeTimePerAttester ─────────────────────────────────────────────────

test("computeTimePerAttester — epochDuration * blockTime / flushSize", () => {
  // 100 slots * 36s / 10 per flush = 360s per attester
  assert.equal(computeTimePerAttester(100n, 10n, 36), 360);
});

test("computeTimePerAttester — returns 0 when flushSize is 0 (not bootstrapped)", () => {
  assert.equal(computeTimePerAttester(100n, 0n, 36), 0);
});

test("computeTimePerAttester — ETA math: position * timePerAttester", () => {
  const timePerAttester = computeTimePerAttester(48n, 12n, 36); // (48*36)/12 = 144s
  assert.equal(timePerAttester, 144);
  // an attester at position 5 activates in 5 * 144 = 720s
  assert.equal(5 * timePerAttester, 720);
});

// ── selectNextMissingCoinbase ──────────────────────────────────────────────

function key(
  attesterAddress: string,
  opts: { coinbase?: string; entryQueueEtaTimestamp?: number } = {},
): LocalAttesterRuntimeState {
  const k: LocalAttesterRuntimeState = {
    attesterAddress,
    registry: "native",
    publishers: [],
    lifecycleState: "ROLLUP_ENTRY_QUEUE",
    inProviderQueue: false,
    lastUpdated: new Date(),
  };
  if (opts.coinbase !== undefined) k.coinbase = opts.coinbase;
  if (opts.entryQueueEtaTimestamp !== undefined) {
    k.entryQueueEtaTimestamp = opts.entryQueueEtaTimestamp;
  }
  return k;
}

test("selectNextMissingCoinbase — none when list is empty", () => {
  assert.equal(selectNextMissingCoinbase([]), undefined);
});

test("selectNextMissingCoinbase — picks the coinbase-less attester in the queue", () => {
  const result = selectNextMissingCoinbase([key("0xaa", { entryQueueEtaTimestamp: 1000 })]);
  assert.equal(result?.attesterAddress, "0xaa");
});

test("selectNextMissingCoinbase — ignores attesters that have a coinbase", () => {
  const result = selectNextMissingCoinbase([
    key("0xaa", { coinbase: "0xcc", entryQueueEtaTimestamp: 1000 }),
  ]);
  assert.equal(result, undefined);
});

test("selectNextMissingCoinbase — ignores attesters not in the entry queue (no ETA)", () => {
  const result = selectNextMissingCoinbase([key("0xaa")]);
  assert.equal(result, undefined);
});

test("selectNextMissingCoinbase — returns the SOONEST coinbase-less attester", () => {
  const result = selectNextMissingCoinbase([
    key("0xlate", { entryQueueEtaTimestamp: 9000 }),
    key("0xsoon", { entryQueueEtaTimestamp: 2000 }),
    key("0xmid", { entryQueueEtaTimestamp: 5000 }),
  ]);
  assert.equal(result?.attesterAddress, "0xsoon");
});

test("selectNextMissingCoinbase — a sooner attester WITH a coinbase does not win", () => {
  const result = selectNextMissingCoinbase([
    key("0xhascoinbase", { coinbase: "0xcc", entryQueueEtaTimestamp: 1000 }),
    key("0xneedscoinbase", { entryQueueEtaTimestamp: 8000 }),
  ]);
  assert.equal(result?.attesterAddress, "0xneedscoinbase");
});
