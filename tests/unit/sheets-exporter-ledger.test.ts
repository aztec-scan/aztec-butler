import assert from "node:assert/strict";
import test from "node:test";
import type { SplitAllocationData } from "../../src/core/components/EthereumClient.js";
import { buildLedgerRows, sumLedgerRows } from "../../src/core/components/rewards-ledger.js";

const DECIMALS = 18;
/** whole tokens -> raw base units */
const raw = (whole: number): bigint => BigInt(whole) * 10n ** 18n;
const map = (obj: Record<string, bigint>): Map<string, bigint> => new Map(Object.entries(obj));
const noSplit = () => null;

// ── accrued = Δbalance + claims ─────────────────────────────────────────────

test("buildLedgerRows — plain accrual (no claims)", () => {
  const rows = buildLedgerRows(
    ["0xaa"],
    map({ "0xaa": raw(100) }),
    map({ "0xaa": raw(150) }),
    map({}),
    noSplit,
    "0xus",
    DECIMALS,
  );
  assert.equal(rows[0]?.accruedAztec, 50);
});

test("buildLedgerRows — a claim day nets to zero accrual", () => {
  // balance dropped 100 -> 10, but 90 was claimed: accrued = 10-100+90 = 0
  const rows = buildLedgerRows(
    ["0xaa"],
    map({ "0xaa": raw(100) }),
    map({ "0xaa": raw(10) }),
    map({ "0xaa": raw(90) }),
    noSplit,
    "0xus",
    DECIMALS,
  );
  assert.equal(rows[0]?.accruedAztec, 0);
  assert.equal(rows[0]?.claimedAztec, 90);
});

test("buildLedgerRows — accrual and a claim in the same period", () => {
  // 100 -> 30, 90 claimed: accrued = 30-100+90 = 20
  const rows = buildLedgerRows(
    ["0xaa"],
    map({ "0xaa": raw(100) }),
    map({ "0xaa": raw(30) }),
    map({ "0xaa": raw(90) }),
    noSplit,
    "0xus",
    DECIMALS,
  );
  assert.equal(rows[0]?.accruedAztec, 20);
});

test("buildLedgerRows — a coinbase with no prior balance starts clean", () => {
  const rows = buildLedgerRows(
    ["0xnew"],
    map({}), // no prevBalance
    map({ "0xnew": raw(40) }),
    map({}),
    noSplit,
    "0xus",
    DECIMALS,
  );
  assert.equal(rows[0]?.accruedAztec, 40);
});

// ── split (our share vs other delegate) ─────────────────────────────────────

function split(recipients: string[], allocations: bigint[], total: bigint): SplitAllocationData {
  return { recipients, allocations, totalAllocation: total, distributorFee: 0 };
}

test("buildLedgerRows — no split → all accrued is ours", () => {
  const rows = buildLedgerRows(
    ["0xaa"],
    map({ "0xaa": 0n }),
    map({ "0xaa": raw(50) }),
    map({}),
    noSplit,
    "0xus",
    DECIMALS,
  );
  assert.equal(rows[0]?.ourShareAztec, 50);
  assert.equal(rows[0]?.otherShareAztec, 0);
});

test("buildLedgerRows — a 50/50 split halves accrued between us and the delegate", () => {
  const rows = buildLedgerRows(
    ["0xaa"],
    map({ "0xaa": 0n }),
    map({ "0xaa": raw(50) }),
    map({}),
    () => split(["0xus", "0xother"], [5000n, 5000n], 10_000n),
    "0xus",
    DECIMALS,
  );
  assert.equal(rows[0]?.accruedAztec, 50);
  assert.equal(rows[0]?.ourShareAztec, 25);
  assert.equal(rows[0]?.otherShareAztec, 25);
});

// ── sumLedgerRows ───────────────────────────────────────────────────────────

test("sumLedgerRows — totals across coinbases", () => {
  const rows = buildLedgerRows(
    ["0xaa", "0xbb"],
    map({ "0xaa": 0n, "0xbb": 0n }),
    map({ "0xaa": raw(30), "0xbb": raw(70) }),
    map({}),
    noSplit,
    "0xus",
    DECIMALS,
  );
  const total = sumLedgerRows(rows);
  assert.equal(total.accruedAztec, 100);
  assert.equal(total.ourShareAztec, 100);
});
