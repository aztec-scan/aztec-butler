import assert from "node:assert/strict";
import test from "node:test";
import { RateLimiter, backoffSchedule, isRetryableError } from "../../src/sheets-exporter/rpc.js";

// ── backoffSchedule ─────────────────────────────────────────────────────────

test("backoffSchedule — exponential delays", () => {
  assert.deepEqual(backoffSchedule(4, 100), [100, 200, 400, 800]);
  assert.deepEqual(backoffSchedule(0, 100), []);
});

// ── isRetryableError ────────────────────────────────────────────────────────

test("isRetryableError — true for throttle / transient failures", () => {
  assert.equal(isRetryableError(new Error("HTTP 429 Too Many Requests")), true);
  assert.equal(isRetryableError(new Error("rate limit exceeded")), true);
  assert.equal(isRetryableError(new Error("fetch failed")), true);
  assert.equal(isRetryableError(new Error("503 Service Unavailable")), true);
});

test("isRetryableError — false for a real contract/logic error", () => {
  assert.equal(isRetryableError(new Error("execution reverted")), false);
  assert.equal(isRetryableError(new Error("invalid address")), false);
});

// ── RateLimiter.run ─────────────────────────────────────────────────────────

const fastLimiter = () =>
  new RateLimiter({ maxRps: 1000, maxRetries: 4, baseBackoffMs: 1 });

test("RateLimiter — succeeds after retrying retryable failures", async () => {
  let calls = 0;
  const result = await fastLimiter().run(async () => {
    calls++;
    if (calls < 3) throw new Error("429 throttled");
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(calls, 3);
});

test("RateLimiter — throws after exhausting retries", async () => {
  let calls = 0;
  await assert.rejects(
    fastLimiter().run(async () => {
      calls++;
      throw new Error("429 throttled");
    }),
    /429/,
  );
  // 1 initial attempt + 4 retries
  assert.equal(calls, 5);
});

test("RateLimiter — a non-retryable error fails immediately", async () => {
  let calls = 0;
  await assert.rejects(
    fastLimiter().run(async () => {
      calls++;
      throw new Error("execution reverted");
    }),
    /reverted/,
  );
  assert.equal(calls, 1);
});
