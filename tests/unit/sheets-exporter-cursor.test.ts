import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  balancesFromRecord,
  balancesToRecord,
  loadCursor,
  saveCursor,
  type RewardsCursor,
} from "../../src/sheets-exporter/cursor.js";

// ── balances <-> record ─────────────────────────────────────────────────────

test("balancesToRecord — lowercases keys, stringifies bigints", () => {
  const record = balancesToRecord(new Map([["0xAA", 5n], ["0xBb", 10n]]));
  assert.deepEqual(record, { "0xaa": "5", "0xbb": "10" });
});

test("balances record round-trip", () => {
  const original = new Map([["0xaa", 123n], ["0xbb", 0n]]);
  const restored = balancesFromRecord(balancesToRecord(original));
  assert.deepEqual([...restored.entries()], [...original.entries()]);
});

// ── persistence ─────────────────────────────────────────────────────────────

test("loadCursor returns null when none exists", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rewards-cursor-"));
  assert.equal(await loadCursor("mainnet", dir), null);
});

test("saveCursor / loadCursor round-trip", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rewards-cursor-"));
  const cursor: RewardsCursor = {
    network: "mainnet",
    lastBlock: "23456789",
    lastDate: "2026-05-20",
    balances: { "0xaa": "1000", "0xbb": "2000" },
    updatedAt: new Date().toISOString(),
  };
  await saveCursor(cursor, dir);
  const loaded = await loadCursor("mainnet", dir);
  assert.deepEqual(loaded, cursor);
});

test("cursors are isolated per network", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rewards-cursor-"));
  await saveCursor(
    { network: "mainnet", lastBlock: "1", lastDate: "2026-01-01", balances: {}, updatedAt: "x" },
    dir,
  );
  assert.equal(await loadCursor("testnet", dir), null);
  assert.ok(await loadCursor("mainnet", dir));
});
