import assert from "node:assert/strict";
import test from "node:test";
import { resolveCatchUpStart } from "../../src/sheets-exporter/index.js";

const DAY = 86_400;
/** date string → day-aligned epoch seconds */
const day = (d: string): number => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000 / DAY) * DAY;

test("resolveCatchUpStart — no cursor → cold start at genesis", () => {
  const r = resolveCatchUpStart(null, day("2026-01-01"), day("2026-05-20"));
  assert.equal(r.fromDay, day("2026-01-01"));
  assert.equal(r.upToDate, false);
});

test("resolveCatchUpStart — no cursor, genesis after yesterday → up to date", () => {
  const r = resolveCatchUpStart(null, day("2026-05-25"), day("2026-05-20"));
  assert.equal(r.upToDate, true);
});

test("resolveCatchUpStart — cursor at yesterday → up to date", () => {
  const r = resolveCatchUpStart("2026-05-20", day("2026-01-01"), day("2026-05-20"));
  assert.equal(r.upToDate, true);
});

test("resolveCatchUpStart — cursor ahead of yesterday (same-day restart) → up to date", () => {
  // a tick already ran today; the cursor sits at yesterday — nothing new to do
  const r = resolveCatchUpStart("2026-05-21", day("2026-01-01"), day("2026-05-20"));
  assert.equal(r.upToDate, true);
});

test("resolveCatchUpStart — stale cursor → resume the day after the cursor", () => {
  const r = resolveCatchUpStart("2026-05-10", day("2026-01-01"), day("2026-05-20"));
  assert.equal(r.fromDay, day("2026-05-11"));
  assert.equal(r.upToDate, false);
});

test("resolveCatchUpStart — cursor one day behind → exactly one day to do", () => {
  const r = resolveCatchUpStart("2026-05-19", day("2026-01-01"), day("2026-05-20"));
  assert.equal(r.fromDay, day("2026-05-20"));
  assert.equal(r.upToDate, false);
  assert.equal((day("2026-05-20") - r.fromDay) / DAY + 1, 1);
});
