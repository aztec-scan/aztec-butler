import assert from "node:assert/strict";
import test from "node:test";
import { spliceRows } from "../../src/sheets-exporter/sheet-writer.js";

/** A data row: [date, tag]. `spliceRows` only cares about column 0 (the date). */
const row = (date: string, tag = "x"): string[] => [date, tag];

test("spliceRows — replaces in-range rows, keeps out-of-range", () => {
  const existing = [row("2026-05-01", "old"), row("2026-05-10", "old"), row("2026-05-20", "old")];
  const merged = spliceRows(existing, [row("2026-05-10", "new")], "2026-05-08", "2026-05-12");
  assert.deepEqual(merged, [
    row("2026-05-01", "old"),
    row("2026-05-10", "new"),
    row("2026-05-20", "old"),
  ]);
});

test("spliceRows — drops every existing row inside the window", () => {
  // The recurring service lumped 05-05..05-07 into one fat row; the ranged
  // backfill replaces that window with three correct daily rows.
  const existing = [row("2026-05-05", "lumped")];
  const replacement = [row("2026-05-05", "a"), row("2026-05-06", "b"), row("2026-05-07", "c")];
  const merged = spliceRows(existing, replacement, "2026-05-05", "2026-05-07");
  assert.deepEqual(merged, replacement);
});

test("spliceRows — result is sorted ascending by date", () => {
  const existing = [row("2026-05-20"), row("2026-05-01")];
  const merged = spliceRows(existing, [row("2026-05-10")], "2026-05-09", "2026-05-11");
  assert.deepEqual(
    merged.map((r) => r[0]),
    ["2026-05-01", "2026-05-10", "2026-05-20"],
  );
});

test("spliceRows — multiple coinbases share a date and survive together", () => {
  const existing = [row("2026-05-01"), row("2026-05-09", "cbA"), row("2026-05-09", "cbB")];
  const replacement = [row("2026-05-05", "cbA"), row("2026-05-05", "cbB")];
  const merged = spliceRows(existing, replacement, "2026-05-04", "2026-05-06");
  // 3 existing rows (all outside the window) preserved + 2 replacement rows
  assert.equal(merged.length, 5);
  assert.equal(merged.filter((r) => r[0] === "2026-05-09").length, 2);
  assert.equal(merged.filter((r) => r[0] === "2026-05-05").length, 2);
});

test("spliceRows — empty existing yields just the replacement", () => {
  const replacement = [row("2026-05-05")];
  assert.deepEqual(spliceRows([], replacement, "2026-05-01", "2026-05-31"), replacement);
});

test("spliceRows — preserves rows the recurring service appended after the window", () => {
  const existing = [row("2026-05-10", "old"), row("2026-05-15", "recurring")];
  const merged = spliceRows(existing, [row("2026-05-10", "fixed")], "2026-05-08", "2026-05-12");
  assert.deepEqual(merged, [row("2026-05-10", "fixed"), row("2026-05-15", "recurring")]);
});

test("spliceRows — window boundaries are inclusive", () => {
  const existing = [row("2026-05-08", "old"), row("2026-05-12", "old")];
  const merged = spliceRows(existing, [row("2026-05-10", "new")], "2026-05-08", "2026-05-12");
  // both boundary rows fall inside [from, to] and are dropped
  assert.deepEqual(merged, [row("2026-05-10", "new")]);
});
