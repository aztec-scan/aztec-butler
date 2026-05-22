import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReadOnlyEnv,
  optionalAddress,
  optionalNonNegativeBigint,
  parseBool,
  positiveInt,
  requiredNonNegativeBigint,
  requiredStr,
  requiredUrl,
} from "../../src/core/config/env.js";

const ADDR = `0x${"a".repeat(40)}`;

// ── parseBool ──────────────────────────────────────────────────────────────

test("parseBool — true for 'true' / '1', false otherwise", () => {
  assert.equal(parseBool("true", false), true);
  assert.equal(parseBool("1", false), true);
  assert.equal(parseBool("false", true), false);
  assert.equal(parseBool("0", true), false);
  assert.equal(parseBool("yes", false), false);
});

test("parseBool — unset/empty falls back to the default", () => {
  assert.equal(parseBool(undefined, true), true);
  assert.equal(parseBool("", false), false);
});

// ── optionalAddress ────────────────────────────────────────────────────────

test("optionalAddress — returns a trimmed valid address", () => {
  assert.equal(optionalAddress("X", ` ${ADDR} `), ADDR);
});

test("optionalAddress — unset/empty yields undefined", () => {
  assert.equal(optionalAddress("X", undefined), undefined);
  assert.equal(optionalAddress("X", "  "), undefined);
});

test("optionalAddress — rejects a malformed address", () => {
  assert.throws(() => optionalAddress("MY_ADDR", "0x1234"), /MY_ADDR/);
});

// ── requiredUrl ────────────────────────────────────────────────────────────

test("requiredUrl — accepts a valid URL, rejects junk and unset", () => {
  assert.equal(requiredUrl("X", "https://example.com"), "https://example.com");
  assert.throws(() => requiredUrl("MY_URL", "not-a-url"), /MY_URL/);
  assert.throws(() => requiredUrl("MY_URL", undefined), /MY_URL/);
});

// ── requiredStr ────────────────────────────────────────────────────────────

test("requiredStr — trims, rejects empty/unset", () => {
  assert.equal(requiredStr("X", "  hi  "), "hi");
  assert.throws(() => requiredStr("MY_STR", ""), /MY_STR is required/);
  assert.throws(() => requiredStr("MY_STR", undefined), /MY_STR is required/);
});

// ── positiveInt ────────────────────────────────────────────────────────────

test("positiveInt — parses, defaults when unset, rejects non-positive", () => {
  assert.equal(positiveInt("X", "30", 10), 30);
  assert.equal(positiveInt("X", undefined, 10), 10);
  assert.equal(positiveInt("X", "  ", 10), 10);
  assert.throws(() => positiveInt("MY_INT", "0", 10), /MY_INT/);
  assert.throws(() => positiveInt("MY_INT", "-5", 10), /MY_INT/);
  assert.throws(() => positiveInt("MY_INT", "abc", 10), /MY_INT/);
});

// ── optionalNonNegativeBigint ──────────────────────────────────────────────

test("optionalNonNegativeBigint — parses, accepts 0, undefined when unset", () => {
  assert.equal(optionalNonNegativeBigint("X", "4"), 4n);
  assert.equal(optionalNonNegativeBigint("X", "0"), 0n);
  assert.equal(optionalNonNegativeBigint("X", undefined), undefined);
  assert.equal(optionalNonNegativeBigint("X", "  "), undefined);
});

test("optionalNonNegativeBigint — rejects negative and non-integer", () => {
  assert.throws(() => optionalNonNegativeBigint("MY_BIG", "-1"), /MY_BIG/);
  assert.throws(() => optionalNonNegativeBigint("MY_BIG", "1.5"), /MY_BIG/);
  assert.throws(() => optionalNonNegativeBigint("MY_BIG", "abc"), /MY_BIG/);
});

// ── requiredNonNegativeBigint ──────────────────────────────────────────────

test("requiredNonNegativeBigint — parses, throws when unset", () => {
  assert.equal(requiredNonNegativeBigint("X", "23"), 23n);
  assert.equal(requiredNonNegativeBigint("X", "0"), 0n);
  assert.throws(() => requiredNonNegativeBigint("MY_BIG", undefined), /MY_BIG is required/);
  assert.throws(() => requiredNonNegativeBigint("MY_BIG", "-1"), /MY_BIG/);
});

// ── assertReadOnlyEnv ──────────────────────────────────────────────────────

test("assertReadOnlyEnv — passes for a clean env", () => {
  assert.doesNotThrow(() => assertReadOnlyEnv({ ETHEREUM_NODE_URL: "https://e.x" }));
});

test("assertReadOnlyEnv — fails closed on mutating/key-bearing config", () => {
  assert.throws(
    () => assertReadOnlyEnv({ SAFE_PROPOSALS_ENABLED: "true" }),
    /read-only/i,
  );
  assert.throws(
    () => assertReadOnlyEnv({ MULTISIG_PROPOSER_PRIVATE_KEY: "0xabc" }),
    /must not be given private keys/i,
  );
  assert.throws(
    () => assertReadOnlyEnv({ SAFE_API_KEY: "secret" }),
    /does not use the Safe API/i,
  );
});
